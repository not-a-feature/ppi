import { getSettings, updateSettings, type PolicyInput } from '#lib/server/domain/index.js';
import {
  listAdminAlertRecipients,
  saveAdminAlertRecipient,
  removeAdminAlertRecipient
} from '#lib/server/admin-alerts.js';
import { adminAlertEvents, type AdminAlertPreferences } from '#lib/admin-alerts.js';

import { admin, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
  const current = admin(locals);
  const [policy, recipients] = await Promise.all([
    getSettings(current),
    listAdminAlertRecipients(current)
  ]);
  return { policy, recipients };
};
export const actions: Actions = {
  recipient: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        saveAdminAlertRecipient(current, {
          id: field(form, 'id') || undefined,
          email: field(form, 'email'),
          ...(Object.fromEntries(
            Object.keys(adminAlertEvents).map((type) => [type, form.get(type) === 'on'])
          ) as AdminAlertPreferences)
        }),
      'Benachrichtigungen gespeichert.'
    );
  },
  removeRecipient: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => removeAdminAlertRecipient(current, field(form, 'id')),
      'Empfänger entfernt.'
    );
  },
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
