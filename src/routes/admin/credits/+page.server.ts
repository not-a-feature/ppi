import { resolveTokenRequest } from '$lib/server/domain';

import { listAdminEntries } from '$lib/server/domain/admin-lists';
import { admin, field, actionResult, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'pending';
  const result = await loadResult(() => listAdminEntries(current, 'credits', { paginate: false }));
  return {
    ...result,
    q,
    scope,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  };
};
export const actions: Actions = {
  resolve: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        resolveTokenRequest(current, field(form, 'id'), {
          amount: Number(field(form, 'amount')),
          reason: field(form, 'reason')
        }),
      'Die Tokenanfrage wurde entschieden.'
    );
  }
};
