import { getPeriodicGrantPreview } from '#lib/server/domain/index.js';
import {
  getGrantSchedule,
  runGrantNow,
  updateGrantSchedule,
  getAccountCleanupSchedule,
  updateAccountCleanupSchedule
} from '#lib/server/jobs.js';

import { admin, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
  const current = admin(locals);
  const [schedule, grantPreview, cleanupSchedule] = await Promise.all([
    getGrantSchedule(current),
    getPeriodicGrantPreview(current),
    getAccountCleanupSchedule(current)
  ]);
  return { schedule, grantPreview, cleanupSchedule };
};
export const actions: Actions = {
  cleanupSchedule: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        updateAccountCleanupSchedule(current, {
          enabled: form.get('enabled') === 'on',
          cron: field(form, 'cron')
        }),
      'Der Zeitplan wurde gespeichert.'
    );
  },
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
