import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  adminAlertEvents,
  type AdminAlertType,
  type AdminAlertPreferences
} from '../admin-alerts.js';
import { transaction } from './db.js';
import { audit, currentActor, requireCondition, requireId, type Actor } from './domain/shared.js';

export async function listAdminAlertRecipients(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    return (await client.query('SELECT * FROM admin_alert_recipient ORDER BY email,id')).rows;
  });
}

export async function saveAdminAlertRecipient(
  actor: Actor,
  input: { id?: string; email: string } & AdminAlertPreferences
) {
  if (input.id) requireId(input.id);
  const email = input.email.trim().toLowerCase();
  requireCondition(
    email.length <= 254 &&
      /^[^\s@<>,;:"\\\x00-\x1f\x7f]+@[^\s@<>,;:"\\\x00-\x1f\x7f]+$/u.test(email),
    400,
    'invalid_alert_email',
    'Bitte eine gültige E-Mail-Adresse eingeben.'
  );
  const types = Object.keys(adminAlertEvents) as AdminAlertType[];
  requireCondition(
    types.every((type) => typeof input[type] === 'boolean'),
    400,
    'invalid_input',
    'Invalid notification preferences.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('admin_alert_settings'))");
    requireCondition(
      !(
        await client.query(
          'SELECT id FROM admin_alert_recipient WHERE email=$1 AND ($2::uuid IS NULL OR id<>$2)',
          [email, input.id ?? null]
        )
      ).rowCount,
      409,
      'duplicate_alert_email',
      'Diese E-Mail-Adresse ist bereits eingetragen.'
    );
    const previous = input.id
      ? (await client.query('SELECT * FROM admin_alert_recipient WHERE id=$1', [input.id])).rows[0]
      : null;
    requireCondition(!input.id || previous, 404, 'not_found', 'Recipient not found.');
    const result = input.id
      ? await client.query(
          `UPDATE admin_alert_recipient SET email=$2,job_failed=$3,content_reported=$4,system_error=$5,protocol_uploaded=$6,updated_at=now() WHERE id=$1 RETURNING id`,
          [
            input.id,
            email,
            input.job_failed,
            input.content_reported,
            input.system_error,
            input.protocol_uploaded
          ]
        )
      : await client.query(
          `INSERT INTO admin_alert_recipient(email,job_failed,content_reported,system_error,protocol_uploaded) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [
            email,
            input.job_failed,
            input.content_reported,
            input.system_error,
            input.protocol_uploaded
          ]
        );
    if (previous)
      await client.query(
        `UPDATE email_outbox SET body='',expires_at=now() WHERE sent_at IS NULL AND recipient=$1 AND admin_alert_type=ANY($2::text[])`,
        [previous.email, types.filter((type) => email !== previous.email || !input[type])]
      );
    await audit(client, actor.id, 'admin_alert.recipient_saved', result.rows[0].id, {
      email,
      events: types.filter((type) => input[type])
    });
    return result.rows[0];
  });
}

export async function removeAdminAlertRecipient(actor: Actor, id: string) {
  requireId(id);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('admin_alert_settings'))");
    const removed = (
      await client.query('DELETE FROM admin_alert_recipient WHERE id=$1 RETURNING email', [id])
    ).rows[0];
    requireCondition(removed, 404, 'not_found', 'Recipient not found.');
    await client.query(
      `UPDATE email_outbox SET body='',expires_at=now() WHERE sent_at IS NULL AND recipient=$1 AND admin_alert_type IS NOT NULL`,
      [removed.email]
    );
    await audit(client, actor.id, 'admin_alert.recipient_removed', id, { email: removed.email });
  });
}

export async function queueAdminAlert(
  client: PoolClient,
  alert: {
    type: AdminAlertType;
    key: string;
    text: string;
    path: string;
    occurredAt?: Date;
  }
) {
  requireCondition(
    Object.hasOwn(adminAlertEvents, alert.type),
    400,
    'invalid_input',
    'Invalid alert type.'
  );
  const recipients = (
    await client.query(
      `SELECT email FROM admin_alert_recipient
    WHERE ${alert.type} AND ($1::timestamptz IS NULL OR updated_at<=$1) FOR SHARE`,
      [alert.occurredAt ?? null]
    )
  ).rows;
  if (!recipients.length) return;
  const inserted = await client.query(
    'INSERT INTO admin_alert_event(event_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_key',
    [`${alert.type}:${alert.key}`]
  );
  if (!inserted.rowCount) return;
  const link = new URL(alert.path, process.env.ORIGIN ?? 'http://localhost:5173').href;
  await client.query(
    `WITH mail AS (
    INSERT INTO email_outbox(recipient,subject,body,expires_at,admin_alert_type)
    SELECT recipient,$2,$3,now()+interval '24 hours',$4 FROM unnest($1::text[]) recipient RETURNING id
  ) INSERT INTO core_job(type,business_key,payload)
    SELECT 'notification','email:'||id,jsonb_build_object('emailId',id) FROM mail`,
    [
      recipients.map((recipient) => recipient.email),
      `PPI | ${adminAlertEvents[alert.type]}`,
      `${alert.text}\n\nIn PPI öffnen / Open in PPI:\n${link}`,
      alert.type
    ]
  );
}

export async function recordSystemFailure(
  component: 'web' | 'worker',
  error: unknown,
  context = '',
  eventKey?: string
) {
  const reference = randomUUID();
  console.error(`PPI ${component} error ${reference}`, error);
  const signature =
    error instanceof Error
      ? `${error.name}\n${error.stack?.split('\n').slice(1, 5).join('\n')}`
      : 'Unknown error';
  const hash = createHash('sha256').update(`${component}:${context}:${signature}`).digest('hex');
  await transaction(async (client) => {
    await queueAdminAlert(client, {
      type: 'system_error',
      key: eventKey ?? `${hash}:${Math.floor(Date.now() / 900000)}`,
      text: `${component === 'web' ? 'Anwendungsfehler' : 'Workerfehler'}\nReferenz: ${reference}${context ? `\nBereich: ${context}` : ''}\nDetails stehen im Serverlog.`,
      path: '/admin/jobs'
    });
  });
}
