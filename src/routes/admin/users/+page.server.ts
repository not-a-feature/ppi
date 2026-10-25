import { t } from '#lib/i18n.js';
import { fail } from '@sveltejs/kit';
import {
  listAdminUsersPage,
  setUserNote,
  setAdmin,
  setAccountStatus,
  adjustCredits
} from '#lib/server/domain/index.js';

import { admin, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const result = await listAdminUsersPage(current, {
    paginate: false
  });
  return {
    q,
    filters: {
      role: url.searchParams.get('role') ?? '',
      status: url.searchParams.get('status') ?? ''
    },
    ...result,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    requestKey: crypto.randomUUID()
  };
};
export const actions: Actions = {
  note: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    const result = await actionResult(
      () =>
        setUserNote(
          current,
          field(form, 'id'),
          String(form.get('note') ?? ''),
          Number(field(form, 'version'))
        ),
      t(locals.preferences.language, 'Interne Notiz gespeichert.')
    );
    if ('data' in result)
      return fail(result.status, {
        ...result.data,
        noteDraft: { userId: field(form, 'id'), value: String(form.get('note') ?? '') }
      });
    return result;
  },
  admin: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => setAdmin(current, field(form, 'id'), field(form, 'isAdmin') === 'true'),
      'Administratorrechte wurden aktualisiert.'
    );
  },
  status: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        setAccountStatus(
          current,
          field(form, 'id'),
          field(form, 'status') as 'active' | 'suspended'
        ),
      'Der Kontostatus wurde aktualisiert.'
    );
  },
  adjust: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        adjustCredits(
          current,
          field(form, 'id'),
          Number(field(form, 'amount')),
          field(form, 'reason'),
          field(form, 'requestKey')
        ),
      'Die Tokenanpassung wurde gebucht.'
    );
  }
};
