import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestWithClientAddress } from '../src/lib/server/auth/client-address';

const mail = vi.hoisted(() =>
  vi.fn(async (_message: { to: string; subject: string; text: string }) => {})
);
vi.mock('../src/lib/server/jobs', () => ({ enqueueEmail: mail }));

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL authentication', () => {
  const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
  let root: pg.Pool;
  let pool: pg.Pool;
  let auth: ReturnType<(typeof import('../src/lib/server/auth/config'))['createAuth']>;
  let activateAccount: (typeof import('../src/lib/server/domain'))['activateAccount'];
  let currentActor: (typeof import('../src/lib/server/auth/session'))['currentActor'];
  let allowAuthForm: (typeof import('../src/lib/server/auth/rate-limit'))['allowAuthForm'];
  let setAccountStatus: (typeof import('../src/lib/server/domain'))['setAccountStatus'];
  let userId: string;
  let verificationToken: string;
  const email = 'zxaut01@student.uni-tuebingen.de';
  const password = 'Test-password-only-2026!';

  beforeAll(async () => {
    root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.ORIGIN = 'http://localhost:5173';
    process.env.BETTER_AUTH_SECRET =
      'authentication-integration-test-secret-at-least-32-characters';
    ({ pool } = await import('../src/lib/server/db'));
    ({ activateAccount } = await import('../src/lib/server/domain'));
    ({ setAccountStatus } = await import('../src/lib/server/domain'));
    ({ currentActor } = await import('../src/lib/server/auth/session'));
    ({ allowAuthForm } = await import('../src/lib/server/auth/rate-limit'));
    for (const migration of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await pool.query(await readFile(`migrations/${migration}`, 'utf8'));
    }
    auth = (await import('../src/lib/server/auth/config')).createAuth();
  });

  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA ${schema} CASCADE`);
    await root?.end();
  });

  it('rejects invalid signup through the public auth endpoint before any user creation', async () => {
    const response = await auth.handler(
      new Request('http://localhost:5173/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({
          email: 'attacker@example.org',
          password,
          name: 'Direct API attempt',
          isAdmin: true,
          emailVerified: true
        })
      })
    );
    expect(response.status).toBe(400);
    expect((await pool.query('SELECT count(*)::integer AS count FROM "user"')).rows[0].count).toBe(
      0
    );
  });

  it('matches the installed Better Auth core schema', async () => {
    const { getMigrations } = await import('better-auth/db/migration');
    const pending = await getMigrations(auth.options);
    expect(pending.toBeCreated).toEqual([]);
    expect(pending.toBeAdded).toEqual([]);
  });

  it('creates an unverified account and prevents client admin or verification escalation', async () => {
    const response = await auth.handler(
      new Request('http://localhost:5173/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({
          email,
          password,
          name: 'Synthetic Auth Test',
          isAdmin: true,
          emailVerified: true
        })
      })
    );
    expect(response.status).toBe(200);
    const user = (await pool.query('SELECT id,"emailVerified" FROM "user" WHERE email=$1', [email]))
      .rows[0];
    userId = user.id;
    expect(user.emailVerified).toBe(false);
    expect(await currentActor(userId)).toBe(null);
    expect(
      (await pool.query('SELECT count(*)::integer AS count FROM credit_entry')).rows[0].count
    ).toBe(0);
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
      statusCode: 403
    });
    const message = mail.mock.calls[0][0].text;
    verificationToken = new URL(message.match(/http:\/\/[^\s]+/)![0]).searchParams.get('token')!;
  });

  it('consumes verification links once and grants starter credits exactly once', async () => {
    await auth.api.verifyEmail({ query: { token: verificationToken } });
    await expect(
      auth.api.verifyEmail({ query: { token: verificationToken } })
    ).rejects.toMatchObject({ statusCode: 302 });
    await Promise.all([activateAccount(userId), activateAccount(userId), activateAccount(userId)]);
    expect(await currentActor(userId)).toEqual({ id: userId, email, isAdmin: false });
    expect(
      (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [userId])).rows[0]
        .balance
    ).toBe(5);
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM credit_entry WHERE user_id=$1 AND kind='activation'",
          [userId]
        )
      ).rows[0].count
    ).toBe(1);
  });

  it('reads current account state for a previously issued session and rejects new suspended sessions', async () => {
    const adminId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
      adminId,
      'Synthetic Admin',
      'zxaut04@student.uni-tuebingen.de'
    ]);
    await activateAccount(adminId);
    await pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [adminId]);
    const admin = await currentActor(adminId);
    expect(admin?.isAdmin).toBe(true);
    const beforeLogins = (
      await pool.query(
        "SELECT count(*)::integer AS count FROM audit_event WHERE action='auth.login'"
      )
    ).rows[0].count;
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    expect(signedIn.response.token).toBeTruthy();
    const sessionHeaders = new Headers({
      cookie: signedIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ')
    });
    expect((await auth.api.getSession({ headers: sessionHeaders }))?.user.id).toBe(userId);
    expect((await auth.api.getSession({ headers: sessionHeaders }))?.user.id).toBe(userId);
    expect(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM audit_event WHERE action='auth.login'"
        )
      ).rows[0].count
    ).toBe(beforeLogins + 1);
    await setAccountStatus(admin!, userId, 'suspended');
    expect(await currentActor(userId)).toBe(null);
    expect(
      (
        await pool.query('SELECT count(*)::integer AS count FROM session WHERE "userId"=$1', [
          userId
        ])
      ).rows[0].count
    ).toBe(0);
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
      statusCode: 403
    });
    await setAccountStatus(admin!, userId, 'active');
  });

  it('does not let duplicate registration replace credentials or profile fields', async () => {
    await auth.api.signUpEmail({
      body: { email, password: 'Attacker-password-2026!', name: 'Replacement Name' }
    });
    expect((await pool.query('SELECT name FROM "user" WHERE id=$1', [userId])).rows[0].name).toBe(
      'Synthetic Auth Test'
    );
    await expect(
      auth.api.signInEmail({ body: { email, password: 'Attacker-password-2026!' } })
    ).rejects.toMatchObject({ statusCode: 401 });
    const signedIn = await auth.api.signInEmail({ body: { email, password } });
    expect(signedIn.user.id).toBe(userId);
  });

  it('recovers verified profile provisioning when the verification callback was interrupted', async () => {
    const id = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
      id,
      'Recovery Test',
      'zxaut02@student.uni-tuebingen.de'
    ]);
    expect(await currentActor(id)).toEqual({
      id,
      email: 'zxaut02@student.uni-tuebingen.de',
      isAdmin: false
    });
    expect(
      (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [id])).rows[0]
        .balance
    ).toBe(5);
  });

  it('rejects expired verification links without activating the account', async () => {
    const target = 'zxaut03@student.uni-tuebingen.de';
    await auth.api.signUpEmail({
      body: { email: target, password, name: 'Expired Verification Test' }
    });
    const message = mail.mock.calls.at(-1)![0].text;
    const token = new URL(message.match(/http:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    await pool.query("UPDATE auth_email_token SET expires_at=now()-interval '1 second'");
    await expect(auth.api.verifyEmail({ query: { token } })).rejects.toMatchObject({
      statusCode: 302
    });
    const response = await auth.handler(
      new Request(
        `http://localhost:5173/api/auth/verify-email?token=${token}&callbackURL=/lectures`
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/verify-email?error=invalid_verification_link');
    const account = (
      await pool.query('SELECT id,"emailVerified" FROM "user" WHERE email=$1', [target])
    ).rows[0];
    expect(account.emailVerified).toBe(false);
    expect(await currentActor(account.id)).toBe(null);
  });

  it('keeps duplicate unverified registration private and lets the owner request a working new link', async () => {
    const target = 'zxaut05@student.uni-tuebingen.de';
    await auth.api.signUpEmail({ body: { email: target, password, name: 'Original Name' } });
    const sent = mail.mock.calls.length;
    await auth.api.signUpEmail({
      body: { email: target, password: 'Replacement-password-2026!', name: 'Replacement Name' }
    });
    expect(mail.mock.calls).toHaveLength(sent);
    expect(
      (await pool.query('SELECT name FROM "user" WHERE email=$1', [target])).rows[0].name
    ).toBe('Original Name');
    const recovery = await auth.api.sendVerificationEmail({
      body: { email: target, callbackURL: '/lectures' }
    });
    expect(recovery).toEqual({ status: true });
    expect(
      await auth.api.sendVerificationEmail({
        body: { email: 'zxaut98@student.uni-tuebingen.de', callbackURL: '/lectures' }
      })
    ).toEqual(recovery);
    expect(mail.mock.calls).toHaveLength(sent + 1);
    const message = mail.mock.calls.at(-1)![0].text;
    const token = new URL(message.match(/http:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    await auth.api.verifyEmail({ query: { token } });
    await expect(
      auth.api.signInEmail({
        body: { email: target, password: 'Replacement-password-2026!' }
      })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect((await auth.api.signInEmail({ body: { email: target, password } })).user.email).toBe(
      target
    );
    const reused = await auth.handler(
      new Request(`http://localhost:5173/api/auth/verify-email?token=${token}`)
    );
    expect(reused.status).toBe(302);
    expect(reused.headers.get('location')).toBe('/verify-email?error=invalid_verification_link');
    const missing = await auth.handler(new Request('http://localhost:5173/api/auth/verify-email'));
    expect(missing.status).toBe(302);
    expect(missing.headers.get('location')).toBe('/verify-email?error=invalid_verification_link');
  });

  it('expires reset tokens, consumes successful resets once, and revokes old sessions', async () => {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
    const expiredMessage = mail.mock.calls.at(-1)![0].text;
    const expiredToken = new URL(expiredMessage.match(/http:\/\/[^\s]+/)![0]).pathname
      .split('/')
      .at(-1)!;
    const expired = await pool.query(
      'UPDATE verification SET "expiresAt"=\'2000-01-01T00:00:00Z\' WHERE identifier=$1',
      [`reset-password:${expiredToken}`]
    );
    expect(expired.rowCount).toBe(1);
    await expect(
      auth.api.resetPassword({
        body: { token: expiredToken, newPassword: 'Replacement-password-2026!' }
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
    const resetMessage = mail.mock.calls.at(-1)![0].text;
    const token = new URL(resetMessage.match(/http:\/\/[^\s]+/)![0]).pathname.split('/').at(-1)!;
    await auth.api.resetPassword({ body: { token, newPassword: 'Replacement-password-2026!' } });
    await expect(
      auth.api.resetPassword({ body: { token, newPassword: 'Another-password-2026!' } })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(
      (
        await pool.query('SELECT count(*)::integer AS count FROM session WHERE "userId"=$1', [
          userId
        ])
      ).rows[0].count
    ).toBe(0);
    const missing = await auth.api.requestPasswordReset({
      body: { email: 'zxaut99@student.uni-tuebingen.de', redirectTo: '/reset-password' }
    });
    expect(missing.status).toBe(true);
  });

  it('atomically limits parallel auth form submissions across the shared database', async () => {
    const allowed = await Promise.all(
      Array.from({ length: 11 }, () => allowAuthForm('/login', '192.0.2.1'))
    );
    expect(allowed.filter(Boolean)).toHaveLength(10);
  });

  it('limits the real raw login endpoint by adapter address even when attackers rotate supplied IP headers', async () => {
    const login = (address: string, forgedAddress: string) =>
      auth.handler(
        requestWithClientAddress(
          new Request('http://localhost:5173/api/auth/sign-in/email', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'http://localhost:5173',
              'x-forwarded-for': forgedAddress,
              'x-ppi-client-ip': forgedAddress
            },
            body: JSON.stringify({ email: 'zxaut97@student.uni-tuebingen.de', password })
          }),
          address
        )
      );
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await login('192.0.2.90', `203.0.113.${attempt + 1}`);
      expect(response.status).toBe(attempt < 10 ? 401 : 429);
    }
    expect((await login('192.0.2.91', '203.0.113.1')).status).toBe(401);
  });

  it('retains Better Auth cross-origin login and callback protections after normalizing headers', async () => {
    const crossOrigin = await auth.handler(
      requestWithClientAddress(
        new Request('http://localhost:5173/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate'
          },
          body: JSON.stringify({ email, password })
        }),
        '192.0.2.92'
      )
    );
    expect(crossOrigin.status).toBe(403);
    const maliciousCallback = await auth.handler(
      requestWithClientAddress(
        new Request('http://localhost:5173/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
          body: JSON.stringify({
            email: 'zxaut96@student.uni-tuebingen.de',
            password,
            name: 'Invalid callback',
            callbackURL: 'https://attacker.example'
          })
        }),
        '192.0.2.93'
      )
    );
    expect(maliciousCallback.status).toBe(403);
    expect(
      (
        await pool.query('SELECT id FROM "user" WHERE email=$1', [
          'zxaut96@student.uni-tuebingen.de'
        ])
      ).rowCount
    ).toBe(0);
  });
});
