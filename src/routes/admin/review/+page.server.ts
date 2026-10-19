import { listReviewQueuePage } from '$lib/server/domain';

import { admin } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'pending';
  const result = await listReviewQueuePage(current, {
    search: q,
    includeAll: scope === 'all',
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  });
  return {
    q,
    scope,
    ...result,
    requestKey: crypto.randomUUID()
  };
};
