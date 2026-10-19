import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../src/lib/server/domain';
import { termOptions } from '../src/lib/terms';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL job delivery and controls', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `jobs_test_${suffix}`;
  const bossSchema = `boss_test_${suffix}`;
  let root: pg.Pool;
  let pool: pg.Pool;
  let boss: PgBoss;
  let jobs: typeof import('../src/lib/server/jobs');
  let domain: typeof import('../src/lib/server/domain');
  let alerts: typeof import('../src/lib/server/admin-alerts');
  let admin: Actor;
  let student: Actor;
  const secret = 'one-time-reset-secret-not-for-job-ui';

  beforeAll(async () => {
    root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGBOSS_SCHEMA = bossSchema;
    ({ pool } = await import('../src/lib/server/db'));
    domain = await import('../src/lib/server/domain');
    jobs = await import('../src/lib/server/jobs');
    alerts = await import('../src/lib/server/admin-alerts');
    for (const name of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await pool.query(await readFile(`migrations/${name}`, 'utf8'));
    }
    for (const [email, isAdmin] of [
      ['zxjob01@student.uni-tuebingen.de', true],
      ['zxjob02@student.uni-tuebingen.de', false]
    ] as const) {
      const id = randomUUID();
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
        id,
        'Synthetic Queue Test',
        email
      ]);
      await domain.activateAccount(id);
      await pool.query('UPDATE ppi_user SET is_admin=$2 WHERE user_id=$1', [id, isAdmin]);
      const actor = await domain.getActor(id);
      expect(actor).not.toBe(null);
      if (isAdmin) admin = actor!;
      else student = actor!;
    }
    boss = await jobs.getBoss();
  }, 30000);

  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 5000 });
    await pool?.end();
    await root?.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`);
    await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root?.end();
  });

  it('rolls back the email record when its durable outbox insert fails', async () => {
    await pool.query(
      `CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced outbox failure'; END $$`
    );
    await pool.query(
      'CREATE TRIGGER reject_test_job BEFORE INSERT ON core_job FOR EACH ROW EXECUTE FUNCTION reject_test_job()'
    );
    await expect(
      jobs.enqueueEmail({ to: student.email, subject: 'Reset test', text: secret })
    ).rejects.toThrow('forced outbox failure');
    expect(
      (await pool.query('SELECT count(*)::integer AS count FROM email_outbox')).rows[0].count
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::integer AS count FROM core_job')).rows[0].count
    ).toBe(0);
    await pool.query('DROP TRIGGER reject_test_job ON core_job');
    await pool.query('DROP FUNCTION reject_test_job()');
  });

  it('rolls back queue publication with dispatch failure, then publishes exactly one job on retry', async () => {
    await jobs.enqueueEmail({
      to: student.email,
      subject: 'Reset test',
      text: `http://localhost/reset-password?token=${secret}`,
      expiresInSeconds: 1800
    });
    const expires = (
      await pool.query(
        'SELECT extract(epoch FROM expires_at-created_at)::integer AS seconds FROM email_outbox'
      )
    ).rows[0].seconds;
    expect(expires).toBe(1800);
    await pool.query(
      `CREATE FUNCTION reject_test_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced dispatch failure'; END $$`
    );
    await pool.query(
      'CREATE TRIGGER reject_test_dispatch BEFORE UPDATE ON core_job FOR EACH ROW WHEN (NEW.dispatched_at IS NOT NULL) EXECUTE FUNCTION reject_test_dispatch()'
    );
    await expect(jobs.dispatchOutbox()).rejects.toThrow('forced dispatch failure');
    expect(await boss.findJobs('notification')).toHaveLength(0);
    expect((await pool.query('SELECT dispatched_at FROM core_job')).rows[0].dispatched_at).toBe(
      null
    );
    await pool.query('DROP TRIGGER reject_test_dispatch ON core_job');
    await pool.query('DROP FUNCTION reject_test_dispatch()');
    expect(await jobs.dispatchOutbox()).toBe(1);
    expect(await jobs.dispatchOutbox()).toBe(0);
    const queued = await boss.findJobs<{ emailId: string; outboxId: string }>('notification');
    expect(queued).toHaveLength(1);
    expect(Object.keys(queued[0].data).sort()).toEqual(['emailId', 'outboxId']);
    expect(JSON.stringify(queued[0].data)).not.toContain(secret);
  });

  it('checks current admin authority and keeps email secrets out of the job website response', async () => {
    const forged = { ...student, isAdmin: true };
    await expect(jobs.getJobs(forged)).rejects.toMatchObject({ status: 403 });
    await expect(jobs.controlQueue(forged, 'notification', true)).rejects.toMatchObject({
      status: 403
    });
    await expect(jobs.runGrantNow(forged)).rejects.toMatchObject({ status: 403 });
    await expect(jobs.cancelJob(forged, randomUUID())).rejects.toMatchObject({ status: 403 });
    const response = await jobs.getJobs(admin);
    expect(response.jobs).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(response)).not.toContain(student.email);
    expect(response.jobs[0]).not.toHaveProperty('data');
    await jobs.controlQueue(admin, 'notification', true);
    expect(
      (await pool.query("SELECT paused FROM queue_control WHERE name='notification'")).rows[0]
        .paused
    ).toBe(true);
    await jobs.controlQueue(admin, 'notification', false);
  });

  it('rechecks queued state after waiting for a worker transition lock', async () => {
    const id = await boss.send('file_check', { fileId: randomUUID(), generation: 1 });
    const worker = await pool.connect();
    await worker.query('BEGIN');
    try {
      await worker.query(`SELECT id FROM "${bossSchema}".job WHERE id=$1 FOR UPDATE`, [id]);
      const cancellation = jobs.cancelJob(admin, id!).then(
        () => ({ success: true }),
        (error) => ({ error })
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await root.query(
          "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1",
          [`%${bossSchema}%`]
        );
        if (waiting.rows[0].count > 0) {
          blocked = true;
          break;
        }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await worker.query(`UPDATE "${bossSchema}".job SET state='active' WHERE id=$1`, [id]);
      await worker.query('COMMIT');
      expect(await cancellation).toMatchObject({ error: { status: 409 } });
      expect((await boss.findJobs('file_check', { id: id! }))[0].state).toBe('active');
    } finally {
      await worker.query('ROLLBACK');
      worker.release();
    }
  });

  it('resumes cancelled jobs and retries failed jobs without auditing an ineligible replay', async () => {
    for (const state of ['cancelled', 'failed']) {
      const id = (await boss.send('delete_files', { submissionId: randomUUID() }))!;
      await pool.query(`UPDATE "${bossSchema}".job SET state=$2,completed_on=now() WHERE id=$1`, [
        id,
        state
      ]);
      await jobs.retryJob(admin, id);
      expect((await jobs.getJob(admin, id)).state).toBe(
        state === 'cancelled' ? 'created' : 'retry'
      );
      await expect(jobs.retryJob(admin, id)).rejects.toMatchObject({ status: 409 });
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM audit_event WHERE action='job.retry' AND entity_id=$1",
              [id]
            )
          ).rows[0].count
        )
      ).toBe(1);
    }
  });

  it('rechecks retry eligibility after a competing transaction changes the job', async () => {
    const id = (await boss.send('delete_files', { submissionId: randomUUID() }))!;
    await pool.query(`UPDATE "${bossSchema}".job SET state='cancelled' WHERE id=$1`, [id]);
    const worker = await pool.connect();
    await worker.query('BEGIN');
    try {
      await worker.query(`SELECT id FROM "${bossSchema}".job WHERE id=$1 FOR UPDATE`, [id]);
      const retry = jobs.retryJob(admin, id).then(
        () => ({ success: true }),
        (error) => ({ error })
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await root.query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1",
          [`%${bossSchema}%`]
        );
        if (Number(waiting.rows[0].count) > 0) {
          blocked = true;
          break;
        }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await worker.query(`UPDATE "${bossSchema}".job SET state='active' WHERE id=$1`, [id]);
      await worker.query('COMMIT');
      expect(await retry).toMatchObject({ error: { status: 409 } });
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM audit_event WHERE action='job.retry' AND entity_id=$1",
              [id]
            )
          ).rows[0].count
        )
      ).toBe(0);
      await pool.query(`UPDATE "${bossSchema}".job SET state='completed' WHERE id=$1`, [id]);
    } finally {
      await worker.query('ROLLBACK');
      worker.release();
    }
  });

  it('finds older jobs directly and paginates filtered results without exposing payloads', async () => {
    const old = (await boss.send('delete_files', { secret }))!;
    await pool.query(
      `UPDATE "${bossSchema}".job SET created_on=now()-interval '1 day' WHERE id=$1`,
      [old]
    );
    for (let i = 0; i < 105; i++) await boss.send('delete_files', { secret });
    const first = await jobs.getJobs(admin, { search: 'delete_files' });
    expect(first.total).toBe(109);
    expect(first.jobs).toHaveLength(50);
    const complete = await jobs.getJobs(admin, { search: 'delete_files', paginate: false });
    expect(complete.jobs).toHaveLength(109);
    expect(complete.jobs.some((job) => job.id === old)).toBe(true);
    expect(JSON.stringify(complete.jobs)).not.toContain(secret);
    const last = await jobs.getJobs(admin, { search: 'delete_files', page: 3 });
    expect(last.jobs).toHaveLength(9);
    expect(last.jobs.some((job) => job.id === old)).toBe(true);
    expect(await jobs.getJob(admin, old)).toMatchObject({ id: old });
    expect(JSON.stringify(await jobs.getJob(admin, old))).not.toContain(secret);
    await expect(jobs.getJob({ ...student, isAdmin: true }, old)).rejects.toMatchObject({
      status: 403
    });
    const exact = await jobs.getJobs(admin, { search: old, state: 'created' });
    expect(exact.total).toBe(1);
    expect(exact.jobs[0].id).toBe(old);
  });

  it('bounds maintenance batches, preserves live credentials and throttles, and skips locked rows', async () => {
    await pool.query(`INSERT INTO email_outbox(recipient,subject,body,expires_at)
      SELECT 'expired@example.test','Expired','secret',now()-interval '1 second' FROM generate_series(1,501)`);
    await pool.query(`INSERT INTO auth_email_token(token_hash,expires_at)
      SELECT 'expired-'||n,now()-interval '1 second' FROM generate_series(1,501) n`);
    await pool.query(`INSERT INTO auth_email_token VALUES('live',now()+interval '1 hour')`);
    await pool.query(`INSERT INTO "rateLimit"(id,key,count,"lastRequest")
      SELECT 'expired-'||n,'expired-'||n,1,extract(epoch FROM now()-interval '2 days')*1000 FROM generate_series(1,501) n`);
    await pool.query(
      `INSERT INTO "rateLimit" VALUES('live','live',5,extract(epoch FROM now())*1000)`
    );
    const locked = await pool.connect();
    await locked.query('BEGIN');
    try {
      await locked.query(
        "SELECT token_hash FROM auth_email_token WHERE token_hash='expired-1' FOR UPDATE"
      );
      expect(await jobs.cleanupExpiredAuthData()).toEqual({
        mail: 500,
        tokens: 500,
        throttles: 500
      });
      expect(await jobs.cleanupExpiredAuthData()).toEqual({ mail: 1, tokens: 0, throttles: 1 });
    } finally {
      await locked.query('ROLLBACK');
      locked.release();
    }
    expect(await jobs.cleanupExpiredAuthData()).toEqual({ mail: 0, tokens: 1, throttles: 0 });
    expect((await pool.query('SELECT token_hash FROM auth_email_token')).rows).toEqual([
      { token_hash: 'live' }
    ]);
    expect((await pool.query('SELECT id FROM "rateLimit"')).rows).toEqual([{ id: 'live' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM email_outbox WHERE subject='Expired' AND body<>''"
        )
      ).rows[0].count
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT body FROM email_outbox WHERE body=$1', [
          `http://localhost/reset-password?token=${secret}`
        ])
      ).rowCount
    ).toBe(1);
  });

  it('admin alerts restrict configuration, allow outside addresses, and respect upload/report choices and replay', async () => {
    const preferences = {
      job_failed: false,
      system_error: false,
      content_reported: true,
      protocol_uploaded: true
    };
    await expect(
      alerts.saveAdminAlertRecipient(
        { ...student, isAdmin: true },
        { email: 'redaction@example.org', ...preferences }
      )
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(
      alerts.saveAdminAlertRecipient(admin, {
        email: 'bad\r\nBcc:other@example.org',
        ...preferences
      })
    ).rejects.toMatchObject({ code: 'invalid_alert_email' });
    const recipient = await alerts.saveAdminAlertRecipient(admin, {
      email: 'Redaction+PPI@Example.org',
      ...preferences
    });
    const secondRecipient = await alerts.saveAdminAlertRecipient(admin, {
      email: 'uploads@example.org',
      ...preferences,
      content_reported: false
    });
    await expect(
      alerts.saveAdminAlertRecipient(admin, { email: 'redaction+ppi@example.org', ...preferences })
    ).rejects.toMatchObject({ code: 'duplicate_alert_email' });
    const lecture = await domain.createLecture(admin, 'Admin alert fixture');
    const input = {
      file: {
        storageKey: randomUUID(),
        sha256: 'a'.repeat(64),
        byteCount: 12,
        mediaType: 'text/plain' as const,
        originalName: 'alert.txt'
      },
      lectureIds: [lecture.id],
      term: termOptions()[0].value,
      remarks: 'Fixture',
      collaboratorZx: [],
      attested: true,
      requestKey: randomUUID()
    };
    const submission = await domain.submitProtocol(student, input);
    await domain.submitProtocol(student, input);
    await domain.reviseProtocol(student, submission.submissionId, {
      ...input,
      file: { ...input.file, storageKey: randomUUID() },
      requestKey: randomUUID()
    });
    const report = {
      lectureId: lecture.id,
      category: 'metadata' as const,
      explanation: 'Fixture',
      requestKey: randomUUID()
    };
    await domain.reportContent(student, report);
    await domain.reportContent(student, report);
    const mail = (
      await pool.query(
        'SELECT recipient,body,admin_alert_type FROM email_outbox WHERE recipient=$1',
        ['redaction+ppi@example.org']
      )
    ).rows;
    expect(mail.map((row) => row.admin_alert_type).sort()).toEqual([
      'content_reported',
      'protocol_uploaded',
      'protocol_uploaded'
    ]);
    expect(
      (
        await pool.query(
          "SELECT admin_alert_type FROM email_outbox WHERE recipient='uploads@example.org'"
        )
      ).rows
    ).toEqual([
      { admin_alert_type: 'protocol_uploaded' },
      { admin_alert_type: 'protocol_uploaded' }
    ]);
    expect(
      mail
        .filter((row) => row.admin_alert_type === 'protocol_uploaded')
        .every((row) => row.body.includes(`/admin/review/${submission.submissionId}`))
    ).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::integer count FROM "user" WHERE email=$1', [
          'redaction+ppi@example.org'
        ])
      ).rows[0].count
    ).toBe(0);
    await alerts.saveAdminAlertRecipient(admin, {
      id: recipient.id,
      email: 'redaction+ppi@example.org',
      ...preferences,
      protocol_uploaded: false
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM email_outbox WHERE recipient=$1 AND admin_alert_type='protocol_uploaded' AND body<>''",
          ['redaction+ppi@example.org']
        )
      ).rows[0].count
    ).toBe(0);
    await alerts.removeAdminAlertRecipient(admin, recipient.id);
    await alerts.removeAdminAlertRecipient(admin, secondRecipient.id);
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM email_outbox WHERE recipient=$1 AND body<>''",
          ['redaction+ppi@example.org']
        )
      ).rows[0].count
    ).toBe(0);
  });

  it('admin alerts report terminal job failures once, skip retries and prevent alert-email loops', async () => {
    const recipient = await alerts.saveAdminAlertRecipient(admin, {
      email: 'jobs@example.org',
      job_failed: true,
      system_error: false,
      content_reported: false,
      protocol_uploaded: false
    });
    const failed = (await boss.send('file_check', {}))!;
    const retry = (await boss.send('file_check', {}))!;
    await pool.query(
      `UPDATE "${bossSchema}".job SET state='failed',completed_on=clock_timestamp() WHERE id=$1`,
      [failed]
    );
    await pool.query(
      `INSERT INTO core_job(id,type,business_key,payload,status,error,finished_at)
      VALUES($1,'file_check',$2,'{}','failed','canceling statement due to statement timeout',now())`,
      [failed, `failure:${failed}`]
    );
    const details = await jobs.getJob(admin, failed);
    expect(details.failure).toMatchObject({ code: 'timeout', message: 'jobs.failure.timeout' });
    expect(JSON.stringify(details)).not.toContain('canceling statement');
    await pool.query(`UPDATE "${bossSchema}".job SET state='retry' WHERE id=$1`, [retry]);
    await jobs.collectAdminJobAlerts();
    const mails = (
      await pool.query(
        "SELECT id,body FROM email_outbox WHERE recipient='jobs@example.org' AND admin_alert_type='job_failed'"
      )
    ).rows;
    expect(mails).toHaveLength(1);
    expect(mails[0].body).toContain(`/admin/jobs/${failed}`);
    const mailJob = (await boss.send('notification', { emailId: mails[0].id }))!;
    await pool.query(
      `UPDATE "${bossSchema}".job SET state='failed',completed_on=clock_timestamp() WHERE id=$1`,
      [mailJob]
    );
    await jobs.collectAdminJobAlerts();
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM email_outbox WHERE recipient='jobs@example.org'"
        )
      ).rows[0].count
    ).toBe(1);
    await alerts.removeAdminAlertRecipient(admin, recipient.id);
  });

  it('admin alerts group application failures without emailing exception details and detect stale workers once', async () => {
    const recipient = await alerts.saveAdminAlertRecipient(admin, {
      email: 'errors@example.org',
      job_failed: false,
      system_error: true,
      content_reported: false,
      protocol_uploaded: false
    });
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('password=private-test-secret');
    await alerts.recordSystemFailure('web', failure, 'GET /lectures/[id]');
    await alerts.recordSystemFailure('web', failure, 'GET /lectures/[id]');
    logging.mockRestore();
    const mail = (
      await pool.query("SELECT body FROM email_outbox WHERE recipient='errors@example.org'")
    ).rows;
    expect(mail).toHaveLength(1);
    expect(mail[0].body).toContain('GET /lectures/[id]');
    expect(mail[0].body).not.toContain('private-test-secret');
    await pool.query(
      "UPDATE admin_alert_recipient SET updated_at=now()-interval '10 minutes' WHERE id=$1",
      [recipient.id]
    );
    const worker = randomUUID();
    await pool.query(
      "INSERT INTO worker_heartbeat(id,last_seen) VALUES($1,now()-interval '3 minutes')",
      [worker]
    );
    await jobs.collectAdminJobAlerts();
    await jobs.collectAdminJobAlerts();
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM email_outbox WHERE recipient='errors@example.org'"
        )
      ).rows[0].count
    ).toBe(2);
    await alerts.removeAdminAlertRecipient(admin, recipient.id);
  });

  it('does not repeat grant credits after replay and rejects retrying or cancelling completed work', async () => {
    const id = await jobs.runGrantNow(admin);
    expect(id).toBeTruthy();
    const [job] = await boss.fetch<{ period: string }>('periodic_grant', { batchSize: 1 });
    expect(job.id).toBe(id);
    await expect(jobs.cancelJob(admin, job.id)).rejects.toMatchObject({ status: 409 });
    const first = await domain.processPeriodicGrant(job.data.period);
    expect(first.processed).toBe(2);
    expect((await domain.processPeriodicGrant(job.data.period)).processed).toBe(0);
    await boss.complete('periodic_grant', { id: job.id, retryCount: job.retryCount });
    await expect(jobs.retryJob(admin, job.id)).rejects.toMatchObject({ status: 409 });
    await expect(jobs.cancelJob(admin, job.id)).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM credit_entry WHERE kind='periodic_grant'"
        )
      ).rows[0].count
    ).toBe(2);
    const balances = (
      await pool.query('SELECT balance FROM credit_account ORDER BY user_id')
    ).rows.map((row) => row.balance);
    expect(balances).toEqual([7, 7]);
  });
});
