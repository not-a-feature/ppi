import { pool } from '../db';
import { activateAccount } from '../domain';
import { zxEmail, type Actor } from '../domain/shared';
import type { Preferences } from '../preferences';

async function readAccount(userId: string) {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    emailVerified: boolean;
    status: string | null;
    is_admin: boolean;
    language: Preferences['language'];
    theme: Preferences['theme'];
  }>(
    `SELECT u.id,u.email,u."emailVerified",p.status,p.is_admin,
      coalesce(pref.language,'de') language,coalesce(pref.theme,'auto') theme
     FROM "user" u LEFT JOIN ppi_user p ON p.user_id=u.id
     LEFT JOIN user_preference pref ON pref.user_id=u.id WHERE u.id=$1`,
    [userId]
  );
  return rows[0];
}

export async function currentAccount(
  userId: string
): Promise<{ actor: Actor; preferences: Preferences } | null> {
  let account = await readAccount(userId);
  if (!account?.emailVerified || !zxEmail.test(account.email)) return null;
  if (account.status === null || account.status === 'unverified') {
    await activateAccount(userId);
    account = await readAccount(userId);
  }
  if (!account?.emailVerified || account.status !== 'active' || !zxEmail.test(account.email))
    return null;
  return {
    actor: { id: account.id, email: account.email, isAdmin: account.is_admin },
    preferences: { language: account.language, theme: account.theme }
  };
}

export async function currentActor(userId: string) {
  return (await currentAccount(userId))?.actor ?? null;
}
