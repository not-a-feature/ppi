import { getPeriodicGrantPreview } from '$lib/server/domain';
import { getJobs, runGrantNow, updateGrantSchedule } from '$lib/server/jobs';

import { admin, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const [jobs, grantPreview] = await Promise.all([
    getJobs(current),
    getPeriodicGrantPreview(current)
  ]);
  return { jobs, grantPreview };
};
export const actions: Actions = {
  grant: async ({ locals }) => {
    const current = admin(locals);
    return actionResult(
      () => runGrantNow(current),
      'Der periodische Tokenlauf wurde angefordert. Wiederholungen erzeugen keine doppelten Gutschriften.'
    );
  },
  schedule: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        updateGrantSchedule(current, {
          enabled: form.get('enabled') === 'on',
          cron: field(form, 'cron')
        }),
      'Der Zeitplan wurde gespeichert.'
    );
  }
};
