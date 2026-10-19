import { randomUUID } from 'node:crypto';
import { getCreditsDashboard, requestTokens } from '$lib/server/domain';
import { actor, field, actionResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  return {
    requestKey: randomUUID(),
    dashboard: await getCreditsDashboard(
      actor(locals),
      Number.isSafeInteger(page) && page > 0 ? page : 1
    )
  };
};
export const actions: Actions = {
  request: async ({ locals, request }) => {
    const current = actor(locals),
      form = await request.formData();
    return actionResult(
      () => requestTokens(current, field(form, 'explanation'), field(form, 'requestKey')),
      'Deine Anfrage wurde zur Prüfung eingereicht.'
    );
  }
};
