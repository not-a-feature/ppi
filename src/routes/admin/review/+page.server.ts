import { error } from '@sveltejs/kit';
import { getLecturesByIds, listReviewQueuePage } from '#lib/server/domain/index.js';

import { admin, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const scope = ['all', 'ready'].includes(url.searchParams.get('scope') ?? '')
    ? url.searchParams.get('scope')!
    : 'pending';
  const lectureId = url.searchParams.get('lecture');
  const lecture = lectureId
    ? (await loadResult(() => getLecturesByIds(current, [lectureId])))[0]
    : null;
  if (lectureId && !lecture) error(404, 'Veranstaltung nicht gefunden.');
  const result = await listReviewQueuePage(current, {
    includeAll: true,
    paginate: false
  });
  return {
    q,
    scope,
    lecture,
    ...result,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    requestKey: crypto.randomUUID()
  };
};
