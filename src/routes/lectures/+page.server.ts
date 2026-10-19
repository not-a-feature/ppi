import { listLecturesPage } from '$lib/server/domain';
import { actor } from '../_helpers';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const onlyWithProtocols = url.searchParams.get('files') !== 'all';
  const view = url.searchParams.get('view') === 'list' ? ('list' as const) : ('cards' as const);
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const lecturesPage = await listLecturesPage(actor(locals), {
    paginate: false
  });
  return {
    lectures: lecturesPage.items,
    lecturesPage,
    q,
    onlyWithProtocols,
    view,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  };
};
