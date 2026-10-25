import { t } from '#lib/i18n.js';
import { redirect, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '#lib/server/auth/index.js';
import { requestAccountDeletion, DomainError } from '#lib/server/domain/index.js';
import { updatePreferences } from '#lib/server/preferences.js';
import { actor, field, actionResult, errorMessage } from '../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => ({
  current: actor(locals),
  preferences: locals.preferences
});
export const actions: Actions = {
  preferences: async ({ locals, request }) => {
    const current = actor(locals),
      form = await request.formData();
    try {
      locals.preferences = await updatePreferences(current, {
        language: field(form, 'language'),
        theme: field(form, 'theme')
      });
      return {
        message: t(locals.preferences.language, 'Einstellungen gespeichert.')
      };
    } catch (cause) {
      if (cause instanceof DomainError)
        return fail(cause.status, {
          error:
            cause.code === 'invalid_preferences'
              ? t(
                  locals.preferences.language,
                  'Bitte eine gültige Sprache und Darstellung auswählen.'
                )
              : errorMessage(cause)
        });
      throw cause;
    }
  },
  signout: async ({ request }) => {
    await auth.api.signOut({ headers: request.headers });
    redirect(303, '/login');
  },
  password: async ({ locals, request }) => {
    actor(locals);
    const form = await request.formData();
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: String(form.get('currentPassword') ?? ''),
          newPassword: String(form.get('newPassword') ?? ''),
          revokeOtherSessions: true
        },
        headers: request.headers
      });
      return { message: 'Das Passwort wurde geändert. Andere Sitzungen wurden abgemeldet.' };
    } catch (cause) {
      if (cause instanceof APIError) return fail(400, { error: cause.message });
      throw cause;
    }
  },
  deletion: async ({ locals, request }) => {
    const current = actor(locals),
      form = await request.formData();
    if (field(form, 'confirmation') !== 'LÖSCHEN')
      return fail(400, { error: 'Bitte zur Bestätigung LÖSCHEN eingeben.' });
    const result = await actionResult(
      () => requestAccountDeletion(current),
      'Das Konto wurde gelöscht.'
    );
    if ('message' in result) redirect(303, '/login');
    return result;
  }
};
