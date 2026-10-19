import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { audit } from './domain/shared.js';

export async function cleanupInactiveAccounts() {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ppi_admin_accounts',0))");
    const cutoff = (
      await client.query(`SELECT
      ((now() AT TIME ZONE 'Europe/Berlin')-interval '2 years') AT TIME ZONE 'Europe/Berlin' cutoff`)
    ).rows[0].cutoff as Date;
    const users = (
      await client.query<{ id: string; email: string; is_admin: boolean; status: string }>(
        `SELECT u.id,u.email,p.is_admin,p.status FROM "user" u JOIN ppi_user p ON p.user_id=u.id
       WHERE p.anonymized_at IS NULL AND coalesce(p.last_login_at,u."createdAt")<$1
         AND u.email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'
       ORDER BY p.user_id LIMIT 100 FOR UPDATE OF p,u`,
        [cutoff]
      )
    ).rows;
    let deleted = 0,
      protectedAdmins = 0;
    for (const user of users) {
      if (user.is_admin && user.status === 'active') {
        const admins = (
          await client.query(`SELECT count(*)::integer n FROM ppi_user p JOIN "user" u ON u.id=p.user_id
          WHERE p.is_admin AND p.status='active' AND u."emailVerified"`)
        ).rows[0].n;
        if (admins <= 1) {
          protectedAdmins++;
          continue;
        }
      }
      await client.query('DELETE FROM session WHERE "userId"=$1', [user.id]);
      await client.query('DELETE FROM account WHERE "userId"=$1', [user.id]);
      await client.query('DELETE FROM verification WHERE value=$1 OR identifier=$2', [
        user.id,
        user.email
      ]);
      await client.query('DELETE FROM user_preference WHERE user_id=$1', [user.id]);
      await client.query('DELETE FROM notification WHERE user_id=$1', [user.id]);
      await client.query('DELETE FROM email_outbox WHERE recipient=$1', [user.email]);
      await client.query('DELETE FROM admin_alert_recipient WHERE email=$1', [user.email]);
      await client.query('DELETE FROM lecture_access WHERE user_id=$1', [user.id]);
      await client.query('DELETE FROM mutation_receipt WHERE actor_id=$1', [user.id]);
      await client.query("DELETE FROM contributor_claim WHERE zx=split_part($1,'@',1)", [
        user.email
      ]);
      await client.query(
        `UPDATE ppi_user SET status='deleted',is_admin=false,anonymized_at=now(),
        admin_note='',note_version=note_version+1,note_updated_at=NULL,note_updated_by=NULL WHERE user_id=$1`,
        [user.id]
      );
      await client.query(
        `UPDATE "user" SET name='Deleted account',email=$2,"emailVerified"=false,image=NULL,"updatedAt"=now() WHERE id=$1`,
        [user.id, `deleted-${randomUUID()}@accounts.invalid`]
      );
      await audit(client, null, 'user.anonymized', user.id, {
        reason: 'inactive_two_years',
        cutoff: cutoff.toISOString()
      });
      deleted++;
    }
    return {
      deleted,
      protectedAdmins,
      cutoff: cutoff.toISOString(),
      more: users.length === 100 && deleted > 0
    };
  });
}
