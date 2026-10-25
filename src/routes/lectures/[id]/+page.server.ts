import { t } from '#lib/i18n.js';
import { fail } from '@sveltejs/kit';
import { getLectureArchive, requestArchive } from '#lib/server/archives.js';
import {
  getLecture,
  purchaseLectureAccess,
  reportContent,
  DomainError
} from '#lib/server/domain/index.js';
import { actor, actionResult, field, loadResult, errorMessage } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000000
      ? requestedPage
      : 1;
  const current = actor(locals);
  const lecture = await loadResult(() => getLecture(current, params.id, page));
  return {
    lecture,
    archive:
      lecture.expires_at && new Date(lecture.expires_at) > new Date()
        ? await loadResult(() => getLectureArchive(current, params.id, lecture.protocolsPage.total))
        : null,
    requestKey: crypto.randomUUID()
  };
};
export const actions: Actions = {
  archive: async ({ locals, params }) => {
    const current = actor(locals);
    try {
      await requestArchive(current, params.id);
    } catch (cause) {
      if (cause instanceof DomainError) return fail(cause.status, { error: errorMessage(cause) });
      throw cause;
    }
    return {};
  },
  purchase: async ({ locals, params, request }) => {
    const current = actor(locals),
      form = await request.formData();
    const purchase = await actionResult(
      () => purchaseLectureAccess(current, params.id, field(form, 'requestKey')),
      t(locals.preferences.language, 'Zugang freigeschaltet.')
    );
    if ('status' in purchase) return purchase;
    try {
      await requestArchive(current, params.id);
    } catch (cause) {
      if (cause instanceof DomainError) return { ...purchase, error: errorMessage(cause) };
      throw cause;
    }
    return purchase;
  },
  report: async ({ locals, params, request }) => {
    const current = actor(locals),
      form = await request.formData();
    return actionResult(
      () =>
        reportContent(current, {
          ...(field(form, 'submissionId')
            ? { submissionId: field(form, 'submissionId') }
            : { lectureId: params.id }),
          category: field(form, 'category') as
            'metadata' | 'inappropriate' | 'unavailable' | 'other',
          explanation: field(form, 'explanation'),
          requestKey: field(form, 'requestKey')
        }),
      'Deine Meldung wurde zur Prüfung eingereicht.'
    );
  }
};
