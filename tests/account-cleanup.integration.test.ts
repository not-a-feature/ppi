import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/server/domain';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Inactive account cleanup', () => {
  const schema = 'cleanup_test_' + randomUUID().replaceAll('-', '');
  let root: pg.Pool, pool: pg.Pool, domain: typeof import('../src/lib/server/domain');
  let cleanup: typeof import('../src/lib/server/account-cleanup').cleanupInactiveAccounts;
  let transaction: typeof import('../src/lib/server/db').transaction;
  let number = 0;
  async function user(age: string, loginAge: string | null, isAdmin = false): Promise<Actor> {
    const id = randomUUID(),
      email = `zxcln${String(++number).padStart(2, '0')}@student.uni-tuebingen.de`;
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt") VALUES($1,'Cleanup fixture',$2,true,now()-$3::interval)`,
      [id, email, age]
    );
    await domain.activateAccount(id);
    await pool.query(
      `UPDATE ppi_user SET is_admin=$2,last_login_at=CASE WHEN $3::text IS NULL THEN NULL ELSE now()-$3::interval END WHERE user_id=$1`,
      [id, isAdmin, loginAge]
    );
    return { id, email, isAdmin };
  }
  beforeAll(async () => {
    root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ pool, transaction } = await import('../src/lib/server/db'));
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await pool.query(await readFile('migrations/' + name, 'utf8'));
    domain = await import('../src/lib/server/domain');
    ({ cleanupInactiveAccounts: cleanup } = await import('../src/lib/server/account-cleanup'));
  });
  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA ${schema} CASCADE`);
    await root?.end();
  });

  it('removes old credentials and profile data while preserving protocol files and the ledger', async () => {
    const admin = await user('3 years', '1 day', true),
      old = await user('4 years', '3 years');
    const reader = await user('1 year', '1 day');
    const lecture = await domain.createLecture(admin, 'Cleanup lecture');
    await domain.purchaseLectureAccess(reader, lecture.id, randomUUID());
    const fileId = randomUUID(),
      submissionId = randomUUID(),
      revisionId = randomUUID(),
      storageKey = randomUUID();
    await pool.query(
      `INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name,safety_status) VALUES($1,$2,$3,12,'text/plain','SS2024_2024-06-01_1.txt','clean')`,
      [fileId, storageKey, 'a'.repeat(64)]
    );
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO submission(id,uploader_id,current_revision_id,published_revision_id,review_state,visibility) VALUES($1,$2,$3,$3,'accepted','published')`,
        [submissionId, old.id, revisionId]
      );
      await client.query(
        `INSERT INTO submission_revision(id,submission_id,revision_number,file_id,remarks,attested) VALUES($1,$2,1,$3,'Cleanup fixture',true)`,
        [revisionId, submissionId, fileId]
      );
      await client.query('INSERT INTO revision_lecture VALUES($1,$2)', [revisionId, lecture.id]);
    });
    await pool.query(
      `INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,'old-password-hash')`,
      [randomUUID(), old.id]
    );
    await pool.query(
      `INSERT INTO session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 day')`,
      [randomUUID(), randomUUID(), old.id]
    );
    await pool.query(
      `INSERT INTO verification(id,identifier,value,"expiresAt") VALUES($1,'reset-password:test',$2,now()+interval '1 hour')`,
      [randomUUID(), old.id]
    );
    await pool.query(
      `INSERT INTO email_outbox(recipient,subject,body) VALUES($1,'reset','private token')`,
      [old.email]
    );
    await pool.query('INSERT INTO user_preference(user_id) VALUES($1)', [old.id]);
    await pool.query("UPDATE ppi_user SET admin_note='private note' WHERE user_id=$1", [old.id]);
    const credits = await pool.query('SELECT * FROM credit_entry WHERE user_id=$1', [old.id]);
    await pool.query(
      "INSERT INTO grant_run(period,policy_version,amount) VALUES('frozen-cleanup',1,2)"
    );
    await pool.query("INSERT INTO grant_recipient(period,user_id) VALUES('frozen-cleanup',$1)", [
      old.id
    ]);
    expect((await cleanup()).deleted).toBe(1);
    const profile = (
      await pool.query(
        `SELECT u.*,p.status,p.admin_note,p.anonymized_at FROM "user" u JOIN ppi_user p ON p.user_id=u.id WHERE u.id=$1`,
        [old.id]
      )
    ).rows[0];
    expect(profile).toMatchObject({
      name: 'Deleted account',
      emailVerified: false,
      status: 'deleted',
      admin_note: ''
    });
    expect(profile.email).toMatch(/^deleted-.*@accounts\.invalid$/);
    expect(profile.anonymized_at).toBeInstanceOf(Date);
    for (const table of ['session', 'account'])
      expect(
        (await pool.query(`SELECT * FROM ${table} WHERE "userId"=$1`, [old.id])).rowCount
      ).toBe(0);
    expect(
      (await pool.query('SELECT * FROM email_outbox WHERE recipient=$1', [old.email])).rowCount
    ).toBe(0);
    expect((await pool.query('SELECT * FROM verification WHERE value=$1', [old.id])).rowCount).toBe(
      0
    );
    expect(
      (await pool.query('SELECT * FROM credit_entry WHERE user_id=$1', [old.id])).rows
    ).toEqual(credits.rows);
    expect(
      (await pool.query('SELECT uploader_id FROM submission WHERE id=$1', [submissionId])).rows[0]
        .uploader_id
    ).toBe(old.id);
    expect(
      (await pool.query('SELECT storage_key,deleted_at FROM stored_file WHERE id=$1', [fileId]))
        .rows[0]
    ).toEqual({ storage_key: storageKey, deleted_at: null });
    expect(await domain.getActor(old.id)).toBeNull();
    await expect(domain.getDownload(old, revisionId)).rejects.toMatchObject({ status: 403 });
    expect((await domain.getDownload(reader, revisionId)).fileId).toBe(fileId);
    await domain.processPeriodicGrant('frozen-cleanup');
    await domain.processPeriodicGrant('cleanup-test');
    expect(
      (await pool.query('SELECT * FROM credit_entry WHERE user_id=$1', [old.id])).rows
    ).toEqual(credits.rows);
    expect((await cleanup()).deleted).toBe(0);
  });

  it('rechecks activity after waiting for an in-flight login update', async () => {
    const account = await user('3 years', '3 years');
    const connection = await pool.connect();
    await connection.query('BEGIN');
    await connection.query('UPDATE ppi_user SET last_login_at=now() WHERE user_id=$1', [
      account.id
    ]);
    const pending = cleanup();
    await delay(30);
    await connection.query('COMMIT');
    connection.release();
    expect((await pending).deleted).toBe(0);
    expect(await domain.getActor(account.id)).not.toBeNull();
  });

  it('uses login age, registration fallback, and protects the last active admin', async () => {
    const neverOld = await user('3 years', null),
      neverNew = await user('1 year', null),
      recent = await user('5 years', '1 day');
    const near = await user('3 years', '2 years - 1 day'),
      expired = await user('3 years', '2 years 1 day');
    await user('3 years', '3 years', true);
    await pool.query("UPDATE ppi_user SET last_login_at=now()-interval '3 years' WHERE is_admin");
    const result = await cleanup();
    expect(result.deleted).toBe(3);
    expect(result.protectedAdmins).toBe(1);
    for (const kept of [neverNew, recent, near])
      expect(await domain.getActor(kept.id)).not.toBeNull();
    for (const removed of [neverOld, expired]) expect(await domain.getActor(removed.id)).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer n FROM ppi_user WHERE is_admin AND status='active'"
        )
      ).rows[0].n
    ).toBe(1);
    expect((await cleanup()).deleted).toBe(0);
  });
});
