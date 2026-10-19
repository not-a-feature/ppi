import { listAdminEntries } from '$lib/server/domain/admin-lists';
import { admin, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const result = await loadResult(() =>
    listAdminEntries(current, 'audit', { search: q, page: requestedPage })
  );
  return { ...result, q };
};
