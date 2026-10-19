import { redirect, fail } from '@sveltejs/kit';
import {
  listUploadLectures,
  listExaminerSuggestions,
  submitProtocol,
  DomainError,
  type StoredFileInput
} from '$lib/server/domain';
import { storeUpload, cleanupUnreferencedUpload } from '$lib/server/storage';
import {
  actor,
  field,
  uploadFile,
  protocolValues,
  validateProtocolDetails,
  errorMessage
} from '../_helpers';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
  const current = actor(locals);
  const [lectures, examiners] = await Promise.all([
    listUploadLectures(current),
    listExaminerSuggestions(current)
  ]);
  return { lectures, examiners, requestKey: crypto.randomUUID() };
};
export const actions: Actions = {
  default: async ({ locals, request }) => {
    const current = actor(locals);
    const form = await request.formData();
    const values = protocolValues(form);
    if (form.get('attested') !== 'on')
      return fail(400, { error: 'Bitte die eigene Mitwirkung bestätigen.', values });
    let result;
    let stored: StoredFileInput | undefined;
    try {
      validateProtocolDetails(values);
      stored = await storeUpload(uploadFile(form), current.id);
      result = await submitProtocol(current, {
        file: stored,
        lectureIds: form.getAll('lectureIds').map(String),
        newLectureNames: form
          .getAll('newLectureNames')
          .map((value) => String(value).trim())
          .filter(Boolean),
        examinerId: field(form, 'examinerId') || undefined,
        examinerName: field(form, 'examinerName') || undefined,
        examDate: field(form, 'examDate') || undefined,
        term: field(form, 'term'),
        remarks: field(form, 'remarks'),
        collaboratorZx: field(form, 'collaboratorZx')
          .split(/[\s,;]+/)
          .filter(Boolean),
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
    redirect(303, `/submissions/${result.submissionId}`);
  }
};
