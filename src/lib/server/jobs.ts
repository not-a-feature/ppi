import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import {
  databaseConnectionOptions,
  logDatabaseError,
  pool,
  transaction,
  type DatabaseMode
} from './db.js';
import { DomainError, getActor, type Actor } from './domain/index.js';
import { queueAdminAlert } from './admin-alerts.js';
import { classifyJobFailure, jobFailures, type JobFailureCode } from '../job-failures.js';

export const queueNames = [
  'file_check',
  'content_check',
  'pdf_ocr',
  'notification',
  'periodic_grant',
  'prepare_archive',
  'delete_files'
] as const;
let instance: Promise<PgBoss> | undefined;
export function getBoss(mode: DatabaseMode = 'runtime'): Promise<PgBoss> {
  return (instance ??= (async () => {
    const boss = new PgBoss({
      ...databaseConnectionOptions(mode),
      schema: process.env.PGBOSS_SCHEMA ?? 'pgboss',
      max: 4,
      application_name: 'ppi-jobs'
    });
    boss.on('error', logDatabaseError);
    await boss.start();
    for (const name of queueNames)
      await boss.createQueue(name, {
        retryLimit: 3,
        retryDelay: 15,
        retryBackoff: true,
        expireInSeconds: 300,
        retentionSeconds: 7 * 86400
      });
    return boss;
  })());
}
async function requireAdmin(actor: Actor) {
  const fresh = await getActor(actor.id);
  if (!fresh?.isAdmin)
    throw new DomainError(403, 'admin_required', 'Administratorrechte erforderlich.');
}
export async function enqueueEmail(input: {
  to: string;
  subject: string;
  text: string;
  expiresInSeconds?: number;
}) {
  await transaction(async (client) => {
    const id = randomUUID();
    await client.query(
      "INSERT INTO email_outbox(id,recipient,subject,body,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')",
      [id, input.to, input.subject, input.text, input.expiresInSeconds ?? 3600]
    );
    await client.query(
      `INSERT INTO core_job(type,business_key,payload) VALUES('notification',$1,$2)`,
      [`email:${id}`, JSON.stringify({ emailId: id })]
    );
  });
}
export async function cleanupExpiredAuthData() {
  return transaction(async (client) => {
    const mail = await client.query(
      `WITH expired AS (
        SELECT id FROM email_outbox WHERE expires_at<=now() AND body<>''
        ORDER BY expires_at,id LIMIT 500 FOR UPDATE SKIP LOCKED
      ) UPDATE email_outbox e SET body='' FROM expired WHERE e.id=expired.id`
    );
    const tokens = await client.query(
      `WITH expired AS (
        SELECT token_hash FROM auth_email_token WHERE expires_at<=now()
        ORDER BY expires_at,token_hash LIMIT 500 FOR UPDATE SKIP LOCKED
      ) DELETE FROM auth_email_token t USING expired WHERE t.token_hash=expired.token_hash`
    );
    // All configured authentication throttle windows are at most one hour.
    const throttles = await client.query(
      `WITH expired AS (
        SELECT id FROM "rateLimit" WHERE "lastRequest" < (extract(epoch FROM now()-interval '1 day')*1000)::bigint
        ORDER BY "lastRequest",id LIMIT 500 FOR UPDATE SKIP LOCKED
      ) DELETE FROM "rateLimit" t USING expired WHERE t.id=expired.id`
    );
    return { mail: mail.rowCount!, tokens: tokens.rowCount!, throttles: throttles.rowCount! };
  });
}
export async function dispatchOutbox() {
  const boss = await getBoss();
  return transaction(async (client) => {
    const pending = await client.query(
      'SELECT id,type,payload FROM core_job WHERE dispatched_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED'
    );
    for (const item of pending.rows) {
      await boss.send(
        item.type,
        { ...item.payload, outboxId: item.id },
        { id: item.id, db: { executeSql: (text, values) => client.query(text, values) } }
      );
      await client.query('UPDATE core_job SET dispatched_at=now() WHERE id=$1', [item.id]);
    }
    return pending.rowCount;
  });
}
export async function collectAdminJobAlerts() {
  return transaction(async (client) => {
    const failed = await client.query(
      `SELECT j.id,j.name,j.completed_on,j.id::text||':'||j.completed_on::text alert_key
      FROM "${queueSchema()}".job j WHERE j.state='failed' AND j.name=ANY($1::text[])
      AND j.completed_on >= (SELECT min(updated_at) FROM admin_alert_recipient WHERE job_failed)
      AND NOT EXISTS(SELECT 1 FROM admin_alert_event e WHERE e.event_key='job_failed:'||j.id::text||':'||j.completed_on::text)
      AND NOT (j.name='notification' AND EXISTS(SELECT 1 FROM email_outbox m WHERE m.id::text=j.data->>'emailId' AND m.admin_alert_type IS NOT NULL))
      ORDER BY j.completed_on,j.id LIMIT 50`,
      [queueNames]
    );
    for (const job of failed.rows)
      await queueAdminAlert(client, {
        type: 'job_failed',
        key: job.alert_key,
        occurredAt: job.completed_on,
        text: `Ein Job ist nach allen Wiederholungen fehlgeschlagen.\nTyp: ${job.name}\nKennung: ${job.id}`,
        path: `/admin/jobs/${job.id}`
      });
    const stopped = await client.query(
      "DELETE FROM worker_heartbeat WHERE last_seen<now()-interval '2 minutes' RETURNING id,last_seen"
    );
    for (const worker of stopped.rows)
      await queueAdminAlert(client, {
        type: 'system_error',
        key: `worker:${worker.id}`,
        occurredAt: worker.last_seen,
        text: `Ein Worker hat sich seit mindestens zwei Minuten nicht mehr gemeldet.\nKennung: ${worker.id}`,
        path: '/admin/jobs'
      });
    await client.query("DELETE FROM admin_alert_event WHERE created_at<now()-interval '8 days'");
    return failed.rowCount;
  });
}
const jobColumns = `id,name,state,created_on AS "createdOn",started_on AS "startedOn",
  completed_on AS "completedOn",output`;
function queueSchema() {
  const schema = process.env.PGBOSS_SCHEMA ?? 'pgboss';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid queue schema');
  return schema;
}
function serializeJob(job: Record<string, any>) {
  return {
    id: job.id as string,
    name: job.name as string,
    state: job.state as string,
    createdOn: job.createdOn.toISOString() as string,
    startedOn: job.startedOn?.toISOString() ?? null,
    completedOn: job.completedOn?.toISOString() ?? null,
    output: job.output
  };
}
export async function getJob(actor: Actor, id: string) {
  await requireAdmin(actor);
  requireJobId(id);
  await getBoss();
  const result = await pool.query(
    `SELECT ${jobColumns},retry_count,retry_limit,
      (SELECT error FROM core_job c WHERE c.id=j.id) failure_detail,
      (SELECT finished_at FROM core_job c WHERE c.id=j.id) failure_time
      FROM "${queueSchema()}".job j WHERE id=$1 AND name=ANY($2::text[])`,
    [id, queueNames]
  );
  if (!result.rows[0]) throw new DomainError(404, 'not_found', 'Job nicht gefunden.');
  const row = result.rows[0];
  const code: JobFailureCode =
    typeof row.output?.code === 'string' && Object.hasOwn(jobFailures, row.output.code)
      ? row.output.code
      : classifyJobFailure(row.failure_detail || row.output?.message);
  return {
    ...serializeJob(row),
    retryCount: row.retry_count,
    retryLimit: row.retry_limit,
    failure: ['failed', 'retry'].includes(row.state)
      ? {
          code,
          ...jobFailures[code],
          failedAt: row.failure_time?.toISOString() ?? row.completedOn?.toISOString() ?? null
        }
      : null
  };
}
export async function getJobsSummary(actor: Actor) {
  await requireAdmin(actor);
  await getBoss();
  const result = (
    await pool.query(
      `SELECT count(*) FILTER(WHERE state='failed')::integer total,
        count(*) FILTER(WHERE state='failed' AND completed_on>=now()-interval '24 hours')::integer failed_recent,
        count(*) FILTER(WHERE state='created')::integer queued,
        count(*) FILTER(WHERE state='active')::integer running,
        count(*) FILTER(WHERE state='retry')::integer retrying,
        min(completed_on+deletion_seconds*interval '1 second') FILTER(WHERE state='failed' AND deletion_seconds>0) next_cleanup,
        (SELECT max(last_seen) FROM worker_heartbeat) last_seen,
        ARRAY(SELECT name FROM queue_control WHERE paused ORDER BY name) paused_queues
        FROM "${queueSchema()}".job WHERE name=ANY($1::text[])`,
      [queueNames]
    )
  ).rows[0];
  return {
    total: result.total as number,
    failedRecent: result.failed_recent as number,
    failedOlder: result.total - result.failed_recent,
    queued: result.queued as number,
    running: result.running as number,
    retrying: result.retrying as number,
    nextCleanup: result.next_cleanup?.toISOString() ?? null,
    pausedQueues: result.paused_queues as string[],
    worker: { lastSeen: result.last_seen?.toISOString() ?? null }
  };
}

export async function getJobs(
  actor: Actor,
  options: { page?: number; state?: string; search?: string; paginate?: boolean } = {}
) {
  await requireAdmin(actor);
  await getBoss();
  const pageSize = 50;
  const requestedPage = options.page ?? 1;
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1)
    throw new DomainError(400, 'invalid_page', 'Ungültige Seitennummer.');
  const state = options.state ?? '';
  if (state && !['created', 'retry', 'active', 'completed', 'cancelled', 'failed'].includes(state))
    throw new DomainError(400, 'invalid_state', 'Ungültiger Jobstatus.');
  const search = (options.search ?? '').trim().slice(0, 200);
  const schema = queueSchema();
  const filter = `name=ANY($1::text[]) AND ($2='' OR state::text=$2)
    AND ($3='' OR strpos(id::text,$3)>0 OR strpos(name,$3)>0)`;
  const values = [queueNames, state, search];
  const result = await transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const total =
      options.paginate === false
        ? 0
        : Number(
            (await client.query(`SELECT count(*) FROM "${schema}".job WHERE ${filter}`, values))
              .rows[0].count
          );
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const latest = await client.query(
      `SELECT ${jobColumns} FROM "${schema}".job WHERE ${filter}
       ORDER BY created_on DESC,id DESC ${options.paginate === false ? '' : 'LIMIT $4 OFFSET $5'}`,
      options.paginate === false ? values : [...values, pageSize, (page - 1) * pageSize]
    );
    return {
      total: options.paginate === false ? latest.rows.length : total,
      page,
      pageSize,
      jobs: latest.rows.map(serializeJob)
    };
  });
  const {
    rows: [controls]
  } = await pool.query<{
    queues: Array<{ name: string; paused: boolean }>;
    last_seen: Date | null;
  }>(`SELECT coalesce((SELECT json_agg(q ORDER BY q.name) FROM
      (SELECT name,paused FROM queue_control) q),'[]'::json) queues,
      max(last_seen) last_seen FROM worker_heartbeat`);
  return {
    queues: controls.queues,
    ...result,
    worker: { lastSeen: controls.last_seen?.toISOString() ?? null }
  };
}
export async function getGrantSchedule(actor: Actor) {
  await requireAdmin(actor);
  const schedule = await (await getBoss()).getSchedule('periodic_grant');
  return { enabled: !!schedule, cron: schedule?.cron ?? '0 0 1 1,7 *' };
}
async function audit(actor: Actor, action: string, id: string, detail: object = {}) {
  await pool.query(
    'INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)',
    [actor.id, action, id, JSON.stringify(detail)]
  );
}
export async function controlQueue(actor: Actor, name: string, paused: boolean) {
  await requireAdmin(actor);
  if (!(queueNames as readonly string[]).includes(name))
    throw new DomainError(400, 'invalid_queue', 'Unbekannte Warteschlange.');
  await transaction(async (client) => {
    await client.query('UPDATE queue_control SET paused=$2 WHERE name=$1', [name, paused]);
    await client.query(
      'INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)',
      [actor.id, 'queue.pause', name, JSON.stringify({ paused })]
    );
  });
}
function requireJobId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new DomainError(400, 'invalid_id', 'Ungültige Job-ID.');
}
export async function retryJob(actor: Actor, id: string) {
  await requireAdmin(actor);
  requireJobId(id);
  const boss = await getBoss();
  await transaction(async (client) => {
    const job = (
      await client.query(
        `SELECT id,name,state FROM "${queueSchema()}".job WHERE id=$1 AND name=ANY($2::text[]) FOR UPDATE`,
        [id, queueNames]
      )
    ).rows[0];
    if (!job) throw new DomainError(404, 'not_found', 'Job nicht gefunden.');
    if (!['failed', 'cancelled'].includes(job.state))
      throw new DomainError(
        409,
        'job_state',
        'Nur fehlgeschlagene oder abgebrochene Jobs können wiederholt werden.'
      );
    const options = {
      db: { executeSql: (text: string, values: unknown[]) => client.query(text, values) }
    };
    const result = (
      job.state === 'cancelled'
        ? await boss.resume(job.name, id, options)
        : await boss.retry(job.name, id, options)
    ) as { affected: number };
    if (result.affected !== 1)
      throw new DomainError(409, 'job_state', 'Der Jobstatus hat sich geändert.');
    await client.query('INSERT INTO audit_event(actor_id,action,entity_id) VALUES($1,$2,$3)', [
      actor.id,
      'job.retry',
      id
    ]);
  });
}
export async function cancelJob(actor: Actor, id: string) {
  await requireAdmin(actor);
  requireJobId(id);
  const boss = await getBoss();
  const schema = queueSchema();
  await transaction(async (client) => {
    const job = (
      await client.query(
        `SELECT id,name,state FROM "${schema}".job WHERE id=$1 AND name=ANY($2::text[]) FOR UPDATE`,
        [id, queueNames]
      )
    ).rows[0];
    if (!job) throw new DomainError(404, 'not_found', 'Job nicht gefunden.');
    if (!['created', 'retry'].includes(job.state))
      throw new DomainError(409, 'job_state', 'Dieser Job läuft bereits oder ist abgeschlossen.');
    await boss.cancel(job.name, id, {
      db: { executeSql: (text, values) => client.query(text, values) }
    });
    await client.query('INSERT INTO audit_event(actor_id,action,entity_id) VALUES($1,$2,$3)', [
      actor.id,
      'job.cancel',
      id
    ]);
  });
}
export function currentGrantPeriod(date = new Date()) {
  const month = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Berlin',
    month: 'numeric'
  }).format(date);
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(
    date
  );
  return `${year}-H${Number(month) <= 6 ? 1 : 2}`;
}
export async function runGrantNow(actor: Actor) {
  await requireAdmin(actor);
  const period = currentGrantPeriod();
  const id = await (await getBoss()).send('periodic_grant', { period }, { singletonKey: period });
  await audit(actor, 'grant.enqueue', period);
  return id;
}
export async function updateGrantSchedule(actor: Actor, input: { enabled: boolean; cron: string }) {
  await requireAdmin(actor);
  const boss = await getBoss();
  if (input.cron.length > 100) throw new DomainError(400, 'invalid_cron', 'Zeitplan zu lang.');
  try {
    boss.previewSchedule(input.cron, { tz: 'Europe/Berlin', count: 1 });
  } catch {
    throw new DomainError(400, 'invalid_cron', 'Ungültiger Cron-Zeitplan.');
  }
  if (input.enabled) await boss.schedule('periodic_grant', input.cron, {}, { tz: 'Europe/Berlin' });
  else await boss.unschedule('periodic_grant');
  await audit(actor, 'schedule.update', 'periodic_grant', input);
}
