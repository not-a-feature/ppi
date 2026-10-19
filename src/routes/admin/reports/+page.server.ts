import { resolveContentReport } from '$lib/server/domain';

import { listAdminEntries } from '$lib/server/domain/admin-lists';
import { admin, field, actionResult, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'pending';
  const result = await loadResult(() => listAdminEntries(current, 'reports', { paginate: false }));
  return {
    ...result,
    q,
    scope,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  };
};
export const actions: Actions = {
  report: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => resolveContentReport(current, field(form, 'id'), field(form, 'resolution')),
      'Die Meldung wurde abgeschlossen.'
    );
  }
};
