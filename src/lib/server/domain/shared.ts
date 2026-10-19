import { type PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { studentEmailPattern as zxEmail } from '../auth/policy.js';

export {
  studentEmailPattern as zxEmail,
  studentIdentifierPattern as zxId
} from '../auth/policy.js';

export type Actor = { id: string; email: string; isAdmin: boolean };

export const uploadNumberSql = `(SELECT substring(first_file.original_name FROM '_([0-9]+)[.](?:pdf|txt)$')::bigint
  FROM submission_revision first_revision JOIN stored_file first_file ON first_file.id=first_revision.file_id
  WHERE first_revision.submission_id=s.id ORDER BY first_revision.revision_number LIMIT 1)`;

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function requireCondition(
  condition: unknown,
  status: number,
  code: string,
  message: string
): asserts condition {
  if (!condition) throw new DomainError(status, code, message);
}

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireId(value: string) {
  requireCondition(uuid.test(value), 400, 'invalid_id', 'Invalid identifier.');
}

export function bounded(value: string, max: number, required = true) {
  requireCondition(
    typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0),
    400,
    'invalid_input',
    'Invalid text length.'
  );
  return value.trim();
}

export async function currentActor(
  client: PoolClient,
  actor: Actor,
  admin = false
): Promise<Actor> {
  const { rows } = await client.query(
    `SELECT u.id,u.email,p.is_admin FROM "user" u JOIN ppi_user p ON p.user_id=u.id
    WHERE u.id=$1 AND u."emailVerified" AND p.status='active' FOR SHARE OF u,p`,
    [actor.id]
  );
  requireCondition(
    rows.length && zxEmail.test(rows[0].email),
    403,
    'account_ineligible',
    'An active verified student account is required.'
  );
  requireCondition(
    !admin || rows[0].is_admin,
    403,
    'admin_required',
    'Administrator permission is required.'
  );
  return { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin };
}

export async function latestPolicy(client: PoolClient) {
  return (await client.query('SELECT * FROM policy ORDER BY version DESC LIMIT 1')).rows[0];
}

export async function audit(
  client: PoolClient,
  actorId: string | null,
  action: string,
  entityId: string,
  detail: unknown = {}
) {
  await client.query(
    'INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)',
    [actorId, action, entityId, JSON.stringify(detail)]
  );
}

export async function notify(
  client: PoolClient,
  userId: string,
  event: string,
  subject: string,
  message: string
) {
  const inserted = await client.query(
    `INSERT INTO notification(user_id,event_key,subject,message) VALUES($1,$2,$3,$4)
    ON CONFLICT(event_key) DO NOTHING RETURNING id`,
    [userId, event, subject, message]
  );
  if (inserted.rowCount)
    await client.query(
      `INSERT INTO core_job(type,business_key,payload) VALUES('notification',$1,$2)
    ON CONFLICT(business_key) DO NOTHING`,
      [event, JSON.stringify({ notificationId: inserted.rows[0].id })]
    );
}

export async function credit(
  client: PoolClient,
  userId: string,
  amount: number,
  kind: string,
  businessKey: string,
  policyVersion: number,
  actorId: string | null,
  reason = ''
) {
  await client.query('INSERT INTO credit_account(user_id) VALUES($1) ON CONFLICT DO NOTHING', [
    userId
  ]);
  await client.query('SELECT user_id FROM credit_account WHERE user_id=$1 FOR UPDATE', [userId]);
  const inserted = await client.query(
    `INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,actor_id,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(business_key) DO NOTHING RETURNING id`,
    [userId, amount, kind, businessKey, policyVersion, actorId, reason]
  );
  if (!inserted.rowCount) return false;
  const updated = await client.query(
    'UPDATE credit_account SET balance=balance+$2 WHERE user_id=$1 AND balance+$2>=0 RETURNING balance',
    [userId, amount]
  );
  requireCondition(updated.rowCount, 409, 'insufficient_credits', 'Insufficient tokens.');
  return true;
}

export async function receipt<T>(
  client: PoolClient,
  actor: Actor,
  operation: string,
  key: string,
  input: unknown,
  run: () => Promise<T>
): Promise<T> {
  bounded(key, 200);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${actor.id}:${operation}:${key}`
  ]);
  const old = await client.query(
    'SELECT fingerprint,result FROM mutation_receipt WHERE actor_id=$1 AND operation=$2 AND request_key=$3',
    [actor.id, operation, key]
  );
  if (old.rowCount) {
    requireCondition(
      old.rows[0].fingerprint === fingerprint,
      409,
      'request_key_reused',
      'This request key was already used for different input.'
    );
    return old.rows[0].result as T;
  }
  const result = await run();
  await client.query(
    'INSERT INTO mutation_receipt(actor_id,operation,request_key,fingerprint,result) VALUES($1,$2,$3,$4,$5)',
    [actor.id, operation, key, fingerprint, JSON.stringify(result)]
  );
  return result;
}
