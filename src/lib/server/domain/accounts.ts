import {
  type Actor,
  zxEmail,
  requireCondition,
  latestPolicy,
  credit,
  currentActor,
  audit,
  bounded
} from './shared.js';
import { pool, transaction } from '../db.js';
import { type PoolClient } from 'pg';

export async function getActor(userId: string): Promise<Actor | null> {
  const { rows } = await pool.query(
    `SELECT u.id,u.email,p.is_admin FROM "user" u JOIN ppi_user p ON p.user_id=u.id
    WHERE u.id=$1 AND u."emailVerified" AND p.status='active'`,
    [userId]
  );
  if (!rows.length || !zxEmail.test(rows[0].email)) return null;
  return { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin };
}

export async function activateAccount(userId: string) {
  return transaction(async (client) => {
    const user = (
      await client.query('SELECT id,email,"emailVerified" FROM "user" WHERE id=$1 FOR UPDATE', [
        userId
      ])
    ).rows[0];
    requireCondition(
      user && user.emailVerified && zxEmail.test(user.email),
      403,
      'account_ineligible',
      'Verify a valid student email before activation.'
    );
    await client.query(
      `INSERT INTO ppi_user(user_id,status) VALUES($1,'active') ON CONFLICT(user_id)
      DO UPDATE SET status=CASE WHEN ppi_user.status='unverified' THEN 'active' ELSE ppi_user.status END`,
      [userId]
    );
    const profile = (await client.query('SELECT status FROM ppi_user WHERE user_id=$1', [userId]))
      .rows[0];
    requireCondition(
      profile.status === 'active',
      403,
      'account_ineligible',
      'This account is unavailable.'
    );
    const policy = await latestPolicy(client);
    await credit(
      client,
      userId,
      policy.activation,
      'activation',
      `activation:${userId}`,
      policy.version,
      null
    );
  });
}

export async function listAdminUsersPage(
  actor: Actor,
  options: { search?: string; page?: number; paginate?: boolean } = {}
) {
  const { search = '', page: requestedPage = 1 } = options;
  requireCondition(
    Number.isSafeInteger(requestedPage) && requestedPage > 0,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  requireCondition(search.length <= 200, 400, 'invalid_search', 'Search is too long.');
  const pageSize = 30;
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await currentActor(client, actor, true);
    const from = `FROM "user" u JOIN ppi_user p ON p.user_id=u.id LEFT JOIN credit_account c ON c.user_id=u.id`;
    const values = search ? [search] : [];
    const filter = search
      ? `WHERE strpos(lower(u.email),lower($1))>0 OR strpos(lower(u.id),lower($1))>0
      OR strpos(lower(p.status),lower($1))>0 OR strpos(COALESCE(c.balance,0)::text,$1)>0`
      : '';
    const total =
      options.paginate === false
        ? 0
        : Number((await client.query(`SELECT count(*) ${from} ${filter}`, values)).rows[0].count);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const entries = (
      await client.query(
        `SELECT u.id,u.email,u."emailVerified" email_verified,p.is_admin,p.status,p.admin_note,p.note_version,p.note_updated_at,COALESCE(c.balance,0) balance ${from} ${filter}
      ORDER BY u.email,u.id ${options.paginate === false ? '' : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`}`,
        options.paginate === false ? values : [...values, pageSize, (page - 1) * pageSize]
      )
    ).rows;
    return { entries, total: options.paginate === false ? entries.length : total, page, pageSize };
  });
}

export async function setUserNote(
  actor: Actor,
  userId: string,
  note: string,
  expectedVersion: number
) {
  bounded(note, 4000, false);
  requireCondition(
    Number.isInteger(expectedVersion) && expectedVersion > 0,
    400,
    'invalid_input',
    'A current note version is required.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const updated = await client.query(
      `UPDATE ppi_user SET admin_note=$2,note_version=note_version+1,note_updated_at=now(),note_updated_by=$3
       WHERE user_id=$1 AND note_version=$4 RETURNING user_id`,
      [userId, note, actor.id, expectedVersion]
    );
    requireCondition(
      updated.rowCount,
      409,
      'stale_note',
      'Die Notiz wurde inzwischen geändert. Bitte neu laden.'
    );
    await audit(client, actor.id, 'user.note_updated', userId);
  });
}

async function guardLastAdmin(client: PoolClient, userId: string) {
  const target = (
    await client.query('SELECT is_admin,status FROM ppi_user WHERE user_id=$1 FOR UPDATE', [userId])
  ).rows[0];
  requireCondition(target, 404, 'not_found', 'User not found.');
  if (target.is_admin && target.status === 'active') {
    const count = (
      await client.query(
        `SELECT count(*)::integer n FROM ppi_user p JOIN "user" u ON u.id=p.user_id WHERE p.is_admin AND p.status='active' AND u."emailVerified"`
      )
    ).rows[0].n;
    requireCondition(
      count > 1,
      409,
      'last_admin',
      'The last active administrator cannot be removed.'
    );
  }
}

export async function setAdmin(actor: Actor, userId: string, isAdmin: boolean) {
  requireCondition(
    typeof isAdmin === 'boolean',
    400,
    'invalid_input',
    'An administrator flag is required.'
  );
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ppi_admin_accounts',0))");
    await currentActor(client, actor, true);
    if (!isAdmin) await guardLastAdmin(client, userId);
    if (isAdmin) {
      const user = (
        await client.query(
          'SELECT u.email,u."emailVerified",p.status FROM "user" u JOIN ppi_user p ON p.user_id=u.id WHERE u.id=$1 FOR UPDATE OF p',
          [userId]
        )
      ).rows[0];
      requireCondition(
        user && user.emailVerified && zxEmail.test(user.email) && user.status === 'active',
        409,
        'account_ineligible',
        'Administrators need an active verified student account.'
      );
    }
    const updated = await client.query(
      'UPDATE ppi_user SET is_admin=$2 WHERE user_id=$1 RETURNING user_id',
      [userId, isAdmin]
    );
    requireCondition(updated.rowCount, 404, 'not_found', 'User not found.');
    await audit(client, actor.id, 'user.admin_changed', userId, { isAdmin });
  });
}

export async function setAccountStatus(
  actor: Actor,
  userId: string,
  status: 'active' | 'suspended'
) {
  requireCondition(
    ['active', 'suspended'].includes(status),
    400,
    'invalid_status',
    'Invalid account status.'
  );
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ppi_admin_accounts',0))");
    await currentActor(client, actor, true);
    if (status === 'suspended') await guardLastAdmin(client, userId);
    const result = await client.query(
      `UPDATE ppi_user SET status=$2 WHERE user_id=$1 AND status IN ('active','suspended') RETURNING user_id`,
      [userId, status]
    );
    requireCondition(
      result.rowCount,
      409,
      'invalid_status',
      'This account cannot be changed through this action.'
    );
    if (status === 'suspended')
      await client.query('DELETE FROM session WHERE "userId"=$1', [userId]);
    await audit(client, actor.id, 'user.status_changed', userId, { status });
  });
}

export async function requestAccountDeletion(actor: Actor) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ppi_admin_accounts',0))");
    await currentActor(client, actor);
    await guardLastAdmin(client, actor.id);
    await client.query("UPDATE ppi_user SET status='deletion_pending' WHERE user_id=$1", [
      actor.id
    ]);
    await client.query('DELETE FROM session WHERE "userId"=$1', [actor.id]);
    await audit(client, actor.id, 'user.deletion_requested', actor.id);
  });
}
