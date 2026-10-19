import {
  listLecturesPage,
  getSubmission,
  getLecturesByIds,
  listAdminLectureExaminers,
  createLecture,
  updateLecture,
  decideLecture,
  addLectureExaminer,
  renameLectureExaminer,
  removeLectureExaminer,
  archiveLecture
} from '$lib/server/domain';

import { admin, field, actionResult, loadResult } from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const current = admin(locals);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const requestedStatus = url.searchParams.get('status');
  const approvalStatus =
    requestedStatus === 'pending' ||
    requestedStatus === 'approved' ||
    requestedStatus === 'rejected'
      ? requestedStatus
      : 'all';
  const requestedPage = Number(url.searchParams.get('page') ?? 1);
  const reviewId = url.searchParams.get('review');
  const submission = reviewId ? await loadResult(() => getSubmission(current, reviewId)) : null;
  const revision = submission?.revisions.find(
    (entry: { id: string }) => entry.id === submission.current_revision_id
  );
  const result = submission
    ? {
        items: await loadResult(() => getLecturesByIds(current, revision.lecture_ids)),
        page: 1,
        total: revision.lecture_ids.length,
        pageSize: 20
      }
    : await loadResult(() =>
        listLecturesPage(current, {
          search: q,
          page:
            Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000000
              ? requestedPage
              : 1,
          includeProposals: true,
          approvalStatus
        })
      );
  const examiners = await listAdminLectureExaminers(
    current,
    result.items.map((l) => l.id)
  );
  const lectureExaminers = Object.fromEntries(
    result.items.map((l) => [l.id, examiners.filter((e) => e.lecture_id === l.id)])
  );
  return {
    ...result,
    entries: result.items,
    lectureExaminers,
    q,
    approvalStatus,
    reviewHref: submission ? `/admin/review/${submission.id}` : null,
    reviewReady: submission
      ? result.items.every((lecture) => lecture.approval_status === 'approved')
      : false
  };
};
export const actions: Actions = {
  lecture: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => createLecture(current, field(form, 'name')),
      'Die Veranstaltung wurde angelegt.'
    );
  },
  editLecture: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        updateLecture(current, field(form, 'id'), Number(field(form, 'version')), {
          name: field(form, 'name'),
          aliases: field(form, 'aliases')
            .split(/\r?\n/)
            .map((alias) => alias.trim())
            .filter(Boolean)
        }),
      locals.preferences.language === 'en'
        ? 'Lecture updated.'
        : 'Die Veranstaltung wurde aktualisiert.'
    );
  },
  decideLecture: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        decideLecture(
          current,
          field(form, 'id'),
          Number(field(form, 'version')),
          field(form, 'outcome') as 'approved' | 'rejected'
        ),
      locals.preferences.language === 'en' ? 'Proposal reviewed.' : 'Der Vorschlag wurde geprüft.'
    );
  },
  addExaminer: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => addLectureExaminer(current, field(form, 'lectureId'), field(form, 'name')),
      locals.preferences.language === 'en'
        ? 'Examiner added to lecture.'
        : 'Die prüfende Person wurde der Veranstaltung zugeordnet.'
    );
  },
  renameExaminer: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        renameLectureExaminer(
          current,
          field(form, 'lectureId'),
          field(form, 'examinerId'),
          field(form, 'name')
        ),
      locals.preferences.language === 'en'
        ? 'Examiner updated for this lecture.'
        : 'Die prüfende Person wurde für diese Veranstaltung aktualisiert.'
    );
  },
  removeExaminer: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () => removeLectureExaminer(current, field(form, 'lectureId'), field(form, 'examinerId')),
      locals.preferences.language === 'en'
        ? 'Examiner link removed.'
        : 'Die Zuordnung wurde entfernt.'
    );
  },
  archive: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData();
    return actionResult(
      () =>
        archiveLecture(
          current,
          field(form, 'id'),
          Number(field(form, 'version')),
          field(form, 'archived') === 'true'
        ),
      'Der Archivstatus wurde aktualisiert.'
    );
  }
};
