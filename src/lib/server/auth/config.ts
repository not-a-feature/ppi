import { createHash } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { pool } from '../db';
import { activateAccount } from '../domain';
import { enqueueEmail } from '../jobs';
import { studentEmailPattern } from './policy';
import { currentActor } from './session';
import { clientAddressHeader } from './client-address';

const verificationTokenLifetime = 60 * 60;
const resetPasswordTokenLifetime = 30 * 60;

export function createAuth(plugins: BetterAuthOptions['plugins'] = [], building = false) {
  return betterAuth({
    appName: 'PPI',
    baseURL: process.env.ORIGIN ?? 'http://localhost:5173',
    secret: building
      ? 'build-time-placeholder-only-never-runtime-2a75e948bfc039df'
      : process.env.BETTER_AUTH_SECRET,
    database: pool,
    advanced: {
      database: { validateSchema: !building, joins: true },
      ipAddress: { ipAddressHeaders: [clientAddressHeader] },
      disableOriginCheck: false,
      disableCSRFCheck: false
    },
    disabledPaths: ['/change-email', '/delete-user', '/delete-user/callback'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: resetPasswordTokenLifetime,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await enqueueEmail({
          to: user.email,
          subject: 'PPI | Passwort zurücksetzen / Reset your password',
          expiresInSeconds: resetPasswordTokenLifetime,
          text: `Hallo,\n\nwir haben eine Anfrage zum Zurücksetzen des Passworts für dein PPI-Konto erhalten. Mit diesem Link legst du ein neues Passwort fest. / We received a request to reset the password for your PPI account. Use this link to set a new password.\n\nPasswort zurücksetzen / Reset password:\n${url}\n\nDer Link ist 30 Minuten gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. / This link expires in 30 minutes. If you didn't request it, you can ignore this email.`
        });
      }
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: verificationTokenLifetime,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url, token }) {
        await pool.query(
          `INSERT INTO auth_email_token(token_hash,expires_at) VALUES($1,now()+($2 * interval '1 second')) ON CONFLICT DO NOTHING`,
          [createHash('sha256').update(token).digest('hex'), verificationTokenLifetime]
        );
        await enqueueEmail({
          to: user.email,
          subject: 'PPI | E-Mail-Adresse bestätigen / Verify your email',
          expiresInSeconds: verificationTokenLifetime,
          text: `Hallo,\n\nbestätige deine studentische E-Mail-Adresse, um dein PPI-Konto zu aktivieren. / Verify your student email address to activate your PPI account.\n\nE-Mail-Adresse bestätigen / Verify email:\n${url}\n\nDer Link ist eine Stunde gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. / This link expires in one hour. If you didn't request it, you can ignore this email.`
        });
      },
      async afterEmailVerification(user) {
        await activateAccount(user.id);
      }
    },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: 60 * 60,
      cookieCache: { enabled: false }
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60, max: 2 },
        '/request-password-reset': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 }
      }
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            if (!studentEmailPattern.test(user.email)) {
              throw new APIError('BAD_REQUEST', {
                message: 'A valid zx student email is required.'
              });
            }
            return { data: user };
          }
        },
        update: {
          async before(user) {
            if (user.email !== undefined && !studentEmailPattern.test(user.email)) {
              throw new APIError('BAD_REQUEST', {
                message: 'A valid zx student email is required.'
              });
            }
            return { data: user };
          }
        }
      },
      session: {
        create: {
          async before(session) {
            if (!(await currentActor(session.userId))) {
              throw new APIError('FORBIDDEN', { message: 'This account is not active.' });
            }
            const active = await pool.query(
              `UPDATE ppi_user SET last_login_at=now()
              WHERE user_id=$1 AND status='active' AND anonymized_at IS NULL RETURNING user_id`,
              [session.userId]
            );
            if (!active.rowCount)
              throw new APIError('FORBIDDEN', { message: 'This account is not active.' });
            return { data: session };
          },
          async after(session) {
            await pool.query(
              `INSERT INTO audit_event(actor_id,action,entity_id) VALUES($1,'auth.login',$2)`,
              [session.userId, session.id]
            );
          }
        }
      }
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === '/verify-email') {
          const token = context.query?.token;
          if (typeof token !== 'string')
            throw context.redirect('/verify-email?error=invalid_verification_link');
          const consumed = await pool.query(
            'DELETE FROM auth_email_token WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash',
            [createHash('sha256').update(token).digest('hex')]
          );
          if (!consumed.rowCount)
            throw context.redirect('/verify-email?error=invalid_verification_link');
        }
      })
    },
    plugins
  });
}
