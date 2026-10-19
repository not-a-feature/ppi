import { fail, redirect } from '@sveltejs/kit';
import {
  getSubmission,
  listUploadLectures,
  listExaminerSuggestions,
  reviseProtocol,
  requestReconsideration,
  DomainError,
  type StoredFileInput
} from '$lib/server/domain';
import { storeUpload, cleanupUnreferencedUpload } from '$lib/server/storage';
import {
  actor,
  field,
  uploadFile,
  loadResult,
  actionResult,
  errorMessage,
  protocolValues,
  validateProtocolDetails
} from '../../_helpers';
import type { Actions, PageServerLoad } from './$types';
import { isValidTerm } from '$lib/terms';
export const load: PageServerLoad = async ({ locals, params }) => {
  const current = actor(locals);
  const [submission, lectures, examiners] = await loadResult(() =>
    Promise.all([
      getSubmission(current, params.id),
      listUploadLectures(current),
      listExaminerSuggestions(current)
    ])
  );
  const revision = submission.revisions[0];
  return {
    submission,
    lectures,
    examiners,
    canImprove: submission.uploader_id === current.id && !submission.files_deleted_at,
    initialValues: {
      lectureIds: revision.lecture_ids,
      newLectureNames: [],
      examinerId: revision.examiner_id ?? '',
      examinerName: revision.examiner_name ?? '',
      examDate: revision.exam_date
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Berlin',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(revision.exam_date))
        : '',
      term: isValidTerm(revision.term ?? '') ? revision.term : '',
      remarks: revision.remarks,
      collaboratorZx: ''
    },
    requestKey: crypto.randomUUID()
  };
};
export const actions: Actions = {
  improve: async ({ locals, params, request }) => {
    const current = actor(locals),
      form = await request.formData();
    const values = protocolValues(form);
    if (form.get('attested') !== 'on')
      return fail(400, { error: 'Bitte die eigene Mitwirkung bestätigen.', values });
    let stored: StoredFileInput | undefined;
    try {
      validateProtocolDetails(values, false);
      stored = await storeUpload(uploadFile(form), current.id);
      await reviseProtocol(current, params.id, {
        file: stored,
        lectureIds: values.lectureIds,
        newLectureNames: values.newLectureNames.map((name) => name.trim()).filter(Boolean),
        examinerId: values.examinerId || undefined,
        examinerName: values.examinerName || undefined,
        term: values.term,
        remarks: values.remarks,
        collaboratorZx: [],
        attested: true,
        requestKey: field(form, 'requestKey')
      });
    } catch (cause) {
      if (cause instanceof DomainError)
        return fail(cause.status, { error: errorMessage(cause), values });
      throw cause;
    } finally {
      if (stored)
        await cleanupUnreferencedUpload(stored.storageKey).catch((cause) =>
          console.error('Upload cleanup failed:', cause)
        );
    }
    redirect(303, `/submissions/${params.id}`);
  },
  reconsider: async ({ locals, params, request }) => {
    const current = actor(locals),
      form = await request.formData();
    return actionResult(
      () => requestReconsideration(current, params.id, field(form, 'explanation')),
      'Die erneute Prüfung wurde angefordert.'
    );
  }
};
