import { listAdminEntries } from '#lib/server/domain/admin-lists.js';
import { admin, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const result = await loadResult(() => listAdminEntries(current, 'audit', { paginate: false }));
  return {
    ...result,
    q,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  };
};
