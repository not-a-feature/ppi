import { getJobs, controlQueue, retryJob, cancelJob } from '$lib/server/jobs';

import { admin, field, actionResult, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const state = url.searchParams.get('state') ?? '';
  const jobs = await loadResult(() => getJobs(current, { page: requestedPage, state, search: q }));
  return { jobs, q, state, page: jobs.page, pageSize: jobs.pageSize, total: jobs.total };
};
export const actions: Actions = {
  queue: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => controlQueue(current, field(form, 'name'), field(form, 'paused') === 'true'),
      'Der Warteschlangenstatus wurde geändert.'
    );
  },
  retry: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => retryJob(current, field(form, 'id')),
      'Die Aufgabe wurde erneut eingereiht.'
    );
  },
  cancel: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => cancelJob(current, field(form, 'id')),
      'Der Abbruch wurde angefordert.'
    );
  }
};
