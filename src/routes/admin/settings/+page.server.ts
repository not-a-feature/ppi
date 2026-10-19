import { getSettings, updateSettings, type PolicyInput } from '$lib/server/domain';

import { admin, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  return { policy: await getSettings(current) };
};
export const actions: Actions = {
  settings: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    const input: PolicyInput = {
      activation: Number(field(form, 'activation')),
      base_reward: Number(field(form, 'base_reward')),
      excellent_reward: Number(field(form, 'excellent_reward')),
      sharing: field(form, 'sharing') as PolicyInput['sharing'],
      lecture_cost: Number(field(form, 'lecture_cost')),
      access_weeks: Number(field(form, 'access_weeks')),
      periodic_grant: Number(field(form, 'periodic_grant'))
    };
    return actionResult(
      () => updateSettings(current, input),
      'Die Einstellungen wurden als neue Version gespeichert.'
    );
  }
};
