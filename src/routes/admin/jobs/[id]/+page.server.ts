import { getJob, retryJob, cancelJob } from '$lib/server/jobs';
import { admin, actionResult, loadResult } from '../../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params }) => {
  const job = await loadResult(() => getJob(admin(locals), params.id));
  return { job };
};
export const actions: Actions = {
  retry: async ({ locals, params }) =>
    actionResult(() => retryJob(admin(locals), params.id), 'Die Aufgabe wurde erneut eingereiht.'),
  cancel: async ({ locals, params }) =>
    actionResult(() => cancelJob(admin(locals), params.id), 'Der Abbruch wurde angefordert.')
};
