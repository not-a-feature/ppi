import { error, fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '#lib/server/auth/index.js';
import { studentEmail, studentIdentifierPattern } from '#lib/server/auth/policy.js';
import { field } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
const flows = ['login', 'register', 'verify-email', 'forgot-password', 'reset-password'];
export const load: PageServerLoad = ({ params, url, locals }) => {
  if (!flows.includes(params.flow)) error(404, 'Seite nicht gefunden.');
  if (locals.actor && ['login', 'register'].includes(params.flow)) redirect(303, '/lectures');
  return {
    flow: params.flow,
    token: url.searchParams.get('token'),
    verificationError: url.searchParams.get('error')
  };
};
export const actions: Actions = {
  default: async ({ params, request }) => {
    const form = await request.formData();
    const zx = field(form, 'zx').toLowerCase();
    const password = String(form.get('password') ?? '');
    try {
      const requiresIdentifier = ['login', 'register', 'verify-email', 'forgot-password'].includes(
        params.flow
      );
      if (requiresIdentifier && !studentIdentifierPattern.test(zx))
        return fail(400, { error: 'Bitte eine gültige zx-Kennung eingeben (z. B. zxabc12).', zx });
      const email = requiresIdentifier ? studentEmail(zx) : '';
      if (params.flow === 'login') {
        await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
      } else if (params.flow === 'register') {
        if (password.length < 12 || password.length > 128)
          return fail(400, { error: 'Das Passwort muss 12 bis 128 Zeichen enthalten.', zx });
        await auth.api.signUpEmail({
          body: { email, password, name: zx, callbackURL: '/lectures' },
          headers: request.headers
        });
        return {
          message:
            'Für ein neues Konto wird eine Bestätigungs-E-Mail versendet. Bei einem bestehenden Konto kannst du einen neuen Link anfordern oder das Passwort zurücksetzen.',
          zx
        };
      } else if (params.flow === 'verify-email') {
        await auth.api.sendVerificationEmail({
          body: { email, callbackURL: '/lectures' },
          headers: request.headers
        });
        return {
          message:
            'Falls ein unbestätigtes Konto existiert, wurde eine neue Bestätigungs-E-Mail angefordert.',
          zx
        };
      } else if (params.flow === 'forgot-password') {
        await auth.api.requestPasswordReset({
          body: { email, redirectTo: '/reset-password' },
          headers: request.headers
        });
        return {
          message: 'Falls das Konto existiert, wurde eine E-Mail zum Zurücksetzen angefordert.',
          zx
        };
      } else if (params.flow === 'reset-password') {
        await auth.api.resetPassword({
          body: { newPassword: password, token: field(form, 'token') },
          headers: request.headers
        });
        return { message: 'Das Passwort wurde geändert. Du kannst dich jetzt anmelden.' };
      } else error(404, 'Seite nicht gefunden.');
    } catch (cause) {
      if (cause instanceof APIError)
        return fail(400, {
          error:
            params.flow === 'login'
              ? 'Anmeldung fehlgeschlagen. Zugangsdaten und E-Mail-Bestätigung prüfen.'
              : cause.message,
          zx
        });
      throw cause;
    }
    redirect(303, '/lectures');
  }
};
