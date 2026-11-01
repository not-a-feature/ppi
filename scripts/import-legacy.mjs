import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { hash, id, normalize, validatePrepared } from './legacy-data.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { apply: { type: 'boolean' }, 'add-only': { type: 'boolean' } }
});
assert.equal(
  positionals.length,
  1,
  'Usage: node scripts/import-legacy.mjs <snapshot> [--apply] [--add-only]'
);
const root = resolve(positionals[0]);
const apply = values.apply ?? false;
const addOnly = values['add-only'] ?? false;
const changes = [];
assert(process.env.DATABASE_URL, 'Set DATABASE_URL for the destination system');
const text = await readFile(resolve(root, 'prepared.json'), 'utf8');
assert.equal(hash(text), (await readFile(resolve(root, 'prepared.sha256'), 'utf8')).trim());
const data = validatePrepared(JSON.parse(text));
const storage = resolve(process.env.UPLOAD_DIR ?? '.data/files');
for (const p of data.protocols) {
  assert(/^files\/\d+\.(pdf|txt)$/.test(p.file.path), 'Unsafe file path');
  const content = await readFile(resolve(root, p.file.path));
  assert.equal(hash(content), p.file.sha256, `File changed: ${p.sourceId}`);
  assert.equal(content.length, p.file.bytes);
  assert(content.length > 0 && content.length <= 30 * 1024 * 1024);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const counts = { users: 0, admins: 0, protocols: 0, unchanged: 0, archivalOwnership: 0 };
try {
  await client.query('BEGIN');
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('ppi-legacy-import-v1:' || current_schema()))"
  );
  await client.query('SELECT 1 FROM legacy_import_map LIMIT 0');
  const policy = (
    await client.query('SELECT version,sharing FROM policy ORDER BY version DESC LIMIT 1')
  ).rows[0];
  assert(policy, 'Run schema migrations before importing');
  async function previous(kind, row) {
    const old = (
      await client.query('SELECT * FROM legacy_import_map WHERE kind=$1 AND source_id=$2', [
        kind,
        row.sourceId
      ])
    ).rows[0];
    if (old) {
      if (addOnly && old.fingerprint !== hash(JSON.stringify(row))) {
        changes.push({
          kind,
          sourceId: row.sourceId,
          action: 'preserved existing destination record'
        });
        return old;
      }
      assert.equal(
        old.fingerprint,
        hash(JSON.stringify(row)),
        `Changed legacy ${kind} ${row.sourceId}: reconcile explicitly; existing live data was preserved`
      );
      counts.unchanged++;
    }
    return old;
  }
  async function record(kind, row, target) {
    await client.query(
      'INSERT INTO legacy_import_map(kind,source_id,target_id,fingerprint) VALUES($1,$2,$3,$4)',
      [kind, row.sourceId, target, hash(JSON.stringify(row))]
    );
  }
  const users = new Map();
  for (const u of data.users) {
    const old = await previous('user', u);
    const target = old?.target_id ?? id('user', u.sourceId);
    users.set(u.sourceId, target);
    if (old) continue;
    const duplicate = await client.query('SELECT id FROM "user" WHERE email=$1 OR id=$2', [
      u.email,
      target
    ]);
    assert.equal(
      duplicate.rowCount,
      0,
      `Account already exists: source ${u.sourceId}; explicit reconciliation required`
    );
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,$4)', [
      target,
      u.name,
      u.email,
      u.verified
    ]);
    await client.query(
      'INSERT INTO ppi_user(user_id,is_admin,status,admin_note) VALUES($1,$2,$3,$4)',
      [target, u.isAdmin, u.status, u.note]
    );
    // Generate and immediately discard a high-entropy password. Users recover via email.
    const password = await hashPassword(randomBytes(48).toString('base64url'));
    await client.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$1,\'credential\',$1,$2)',
      [target, password]
    );
    await client.query('INSERT INTO credit_account(user_id,balance) VALUES($1,$2)', [
      target,
      u.balance
    ]);
    await client.query(
      `INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,reason)
      VALUES($1,$2,'legacy_opening',$3,$4,'Legacy scraped opening balance')`,
      [target, u.balance, `activation:${target}`, policy.version]
    );
    await record('user', u, target);
    counts.users++;
    if (u.isAdmin) counts.admins++;
    if (counts.users % 250 === 0)
      console.log(`Prepared ${counts.users}/${data.users.length} accounts`);
  }
  const archival = id('archive', 'owner');
  if (data.protocols.some((p) => !users.has(p.owner))) {
    const email = `deleted-${archival}@accounts.invalid`;
    await client.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'Legacy archive',$2) ON CONFLICT(id) DO NOTHING`,
      [archival, email]
    );
    await client.query(
      `INSERT INTO ppi_user(user_id,status,admin_note) VALUES($1,'deleted','Archival identity; no credentials') ON CONFLICT DO NOTHING`,
      [archival]
    );
  }
  const lectures = new Map();
  for (const l of data.lectures) {
    const old = await previous('lecture', l);
    if (old) {
      lectures.set(l.sourceId, old.target_id);
      continue;
    }
    const existing = (
      await client.query('SELECT id FROM lecture WHERE normalized_name=$1', [normalize(l.name)])
    ).rows[0];
    const target = existing?.id ?? id('lecture', l.sourceId);
    if (!existing)
      await client.query(
        'INSERT INTO lecture(id,name,normalized_name,archived) VALUES($1,$2,$3,$4)',
        [target, l.name, normalize(l.name), l.archived]
      );
    await record('lecture', l, target);
    lectures.set(l.sourceId, target);
  }
  const actor = (
    await client.query(`SELECT u.id FROM "user" u JOIN ppi_user p ON p.user_id=u.id
    WHERE p.is_admin AND p.status='active' AND u."emailVerified" ORDER BY u.id LIMIT 1`)
  ).rows[0];
  assert(actor, 'An active verified administrator is required');
  for (const p of data.protocols) {
    if (await previous('protocol', p)) continue;
    const submission = id('submission', p.sourceId),
      revision = id('revision', p.sourceId),
      file = id('file', p.sourceId);
    const content = await readFile(resolve(root, p.file.path));
    assert.equal(hash(content), p.file.sha256, `File changed during import: ${p.sourceId}`);
    const pdf = p.file.path.endsWith('.pdf');
    let valid = pdf ? content.subarray(0, 5).toString() === '%PDF-' : !content.includes(0);
    if (!pdf) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        valid = false;
      }
    }
    const accepted = p.status === 'ACCEPTED';
    const state = accepted ? 'accepted' : p.status === 'UNCHECKED' ? 'processing' : 'rejected';
    const visibility =
      p.status === 'TO_BE_DELETED' ? 'withdrawn' : accepted ? 'published' : 'unpublished';
    await client.query(
      `INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name,safety_status,safety_detail)
      VALUES($1::uuid,$1::text,$2,$3,$4,$5,$6,$7)`,
      [
        file,
        p.file.sha256,
        content.length,
        pdf ? 'application/pdf' : 'text/plain',
        p.originalName.slice(0, 255),
        valid ? 'pending' : 'blocked',
        valid ? '' : 'Legacy content/extension mismatch'
      ]
    );
    await client.query(
      `INSERT INTO submission(id,uploader_id,review_state,visibility,created_at)
      VALUES($1,$2,$3,$4,$5::timestamp AT TIME ZONE 'Europe/Berlin')`,
      [submission, users.get(p.owner) ?? archival, state, visibility, p.uploadedDate]
    );
    const examiners = [];
    for (const name of p.metadata.examiners) {
      const examiner = (
        await client.query(
          `INSERT INTO examiner(name,normalized_name) VALUES($1,$2)
        ON CONFLICT(normalized_name) DO UPDATE SET normalized_name=EXCLUDED.normalized_name RETURNING id`,
          [name, normalize(name)]
        )
      ).rows[0];
      if (!examiners.includes(examiner.id)) examiners.push(examiner.id);
    }
    await client.query(
      `INSERT INTO submission_revision(id,submission_id,revision_number,file_id,examiner_id,exam_date,term,remarks,attested,created_at)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,true,$8::timestamp AT TIME ZONE 'Europe/Berlin')`,
      [
        revision,
        submission,
        file,
        examiners[0] ?? null,
        p.metadata.exam_date,
        p.metadata.term,
        p.remarks,
        p.uploadedDate
      ]
    );
    for (const [index, e] of examiners.entries())
      await client.query('INSERT INTO revision_examiner VALUES($1,$2,$3)', [
        revision,
        e,
        index + 1
      ]);
    for (const source of p.lectures) {
      const lecture = lectures.get(source);
      assert(lecture);
      await client.query('INSERT INTO revision_lecture VALUES($1,$2)', [revision, lecture]);
      for (const e of examiners)
        await client.query(
          'INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [lecture, e, actor.id]
        );
    }
    await client.query(
      'UPDATE submission SET current_revision_id=$2,published_revision_id=$3 WHERE id=$1',
      [submission, revision, accepted ? revision : null]
    );
    // Pending work receives the normal first-decision reward; historical decisions receive none.
    if (p.status !== 'UNCHECKED')
      await client.query(
        `INSERT INTO reward_allocation(submission_id,revision_id,policy_version,nominal_amount,sharing,approved_by)
      VALUES($1,$2,$3,0,$4,$5)`,
        [submission, revision, policy.version, policy.sharing, actor.id]
      );
    if (valid)
      await client.query(
        `INSERT INTO core_job(type,business_key,payload) VALUES('file_check',$1,$2)`,
        [
          `file_check:${file}:1`,
          JSON.stringify({ revisionId: revision, fileId: file, generation: 1 })
        ]
      );
    if (apply) {
      await mkdir(storage, { recursive: true });
      try {
        await writeFile(resolve(storage, file), content, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert.equal(hash(await readFile(resolve(storage, file))), p.file.sha256);
      }
    }
    await record('protocol', p, submission);
    counts.protocols++;
    if (!users.has(p.owner)) counts.archivalOwnership++;
  }
  // A refresh never silently restores deleted protocols or overwrites live account activity.
  const absent = (await client.query('SELECT kind,source_id FROM legacy_import_map')).rows.filter(
    (m) =>
      !({ user: data.users, lecture: data.lectures, protocol: data.protocols }[m.kind] ?? []).some(
        (row) => row.sourceId === m.source_id
      )
  );
  if (!addOnly)
    assert.equal(
      absent.length,
      0,
      `Previously imported records absent from snapshot; reconcile withdrawals/deletions: ${JSON.stringify(absent)}`
    );
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const report = {
    mode: apply ? 'applied' : 'dry-run (rolled back)',
    addOnly,
    ...counts,
    changes,
    absent
  };
  try {
    await writeFile(
      resolve(root, `import-report-${Date.now()}.json`),
      JSON.stringify(report, null, 2)
    );
  } catch (error) {
    console.error(
      `Import ${report.mode}; report could not be written: ${error.code ?? 'unknown error'}`
    );
  }
  console.log(JSON.stringify(report));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
