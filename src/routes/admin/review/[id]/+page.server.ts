import { t } from '$lib/i18n';
import { fail } from '@sveltejs/kit';
import {
  getSubmission,
  getSettings,
  getRewardPreview,
  getNextReview,
  getLecturesByIds,
  listExaminers,
  decideSubmission,
  withdrawPublication,
  reprocessFile,
  type DecisionInput
} from '$lib/server/domain';
import { admin, field, actionResult, loadResult } from '../../../_helpers';
import { requestProtocolFileDeletion } from '$lib/server/deletion';
import { getContentChecks, requestContentCheck } from '$lib/server/content-checks';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const current = admin(locals);
  const lectureId = url.searchParams.get('lecture') ?? undefined;
  const [submission, policy, examiners] = await loadResult(() =>
    Promise.all([getSubmission(current, params.id), getSettings(current), listExaminers(current)])
  );
  const lectures = await loadResult(() =>
    getLecturesByIds(
      current,
      submission.revisions.flatMap((r: { lecture_ids: string[] }) => r.lecture_ids)
    )
  );
  const revision = submission.revisions.find(
    (r: { id: string }) => r.id === submission.current_revision_id
  );
  const [basePreview, excellentPreview, nextReview, contentChecks] = await loadResult(() =>
    Promise.all([
      getRewardPreview(current, revision.id, 'base'),
      getRewardPreview(current, revision.id, 'excellent'),
      getNextReview(current, params.id, lectureId),
      submission.files_deleted_at ? null : getContentChecks(current, params.id)
    ])
  );
  return {
    submission,
    revision,
    policy,
    basePreview,
    excellentPreview,
    nextReview,
    reviewListHref: lectureId ? `/admin/review?lecture=${lectureId}&scope=all` : '/admin/review',
    reviewContext: lectureId ? `?lecture=${lectureId}` : '',
    contentChecks,
    lectures,
    examiners,
    requestKey: crypto.randomUUID()
  };
};
export const actions: Actions = {
  contentCheck: async ({ locals, params }) =>
    actionResult(
      () => requestContentCheck(admin(locals), params.id),
      t(locals.preferences.language, 'Automatische Prüfungen wurden eingereiht.')
    ),
  deleteFiles: async ({ locals, params, request }) => {
    const current = admin(locals),
      form = await request.formData();
    if (form.get('confirmed') !== 'on' || field(form, 'confirmation') !== 'DELETE')
      return fail(400, {
        error: t(locals.preferences.language, 'Bitte die Dateilöschung mit DELETE bestätigen.')
      });
    return actionResult(
      () =>
        requestProtocolFileDeletion(current, {
          submissionId: params.id,
          expectedVersion: Number(field(form, 'version')),
          reason: field(form, 'reason')
        }),
      t(
        locals.preferences.language,
        'Die Protokolldateien wurden gesperrt und zur Löschung eingereiht. Metadaten und Verlauf bleiben erhalten.'
      )
    );
  },
  reprocess: async ({ locals, params, request }) => {
    const form = await request.formData();
    return actionResult(
      () => reprocessFile(admin(locals), params.id, field(form, 'revisionId')),
      'Die Dateiprüfung wurde erneut eingereiht.'
    );
  },
  refreshDecision: async ({ locals, params, request }) => {
    const current = admin(locals),
      form = await request.formData();
    const submission = await loadResult(() => getSubmission(current, params.id));
    const values = decisionValues(form);
    const preview = await loadResult(() =>
      getRewardPreview(
        current,
        submission.current_revision_id,
        values.reward === 'excellent' ? 'excellent' : 'base'
      )
    );
    return {
      values: {
        ...values,
        revisionId: submission.current_revision_id,
        version: String(submission.version),
        requestKey: crypto.randomUUID(),
        rewardPolicyVersion: String(preview.policyVersion),
        rewardRecipientIds: preview.recipientIds
      },
      requiresRefresh: false,
      message:
        'Der aktuelle Stand wurde geladen. Bitte Datei, Entscheidung und Tokenvergabe erneut prüfen und bestätigen.'
    };
  },
  decide: async ({ locals, request }) => {
    const current = admin(locals),
      form = await request.formData(),
      values = decisionValues(form);
    if (form.get('confirmed') !== 'on')
      return fail(400, {
        error: 'Bitte die Entscheidung und Tokenvergabe bestätigen.',
        values,
        requiresRefresh: true
      });
    const result = await actionResult(
      () =>
        decideSubmission(current, {
          revisionId: values.revisionId,
          expectedVersion: Number(values.version),
          outcome: values.outcome as DecisionInput['outcome'],
          publicFeedback: values.publicFeedback,
          internalNote: values.internalNote,
          reward: values.reward as DecisionInput['reward'],
          requestKey: values.requestKey,
          rewardPolicyVersion: Number(values.rewardPolicyVersion),
          rewardRecipientIds: values.rewardRecipientIds
        }),
      'Die Entscheidung wurde gespeichert.'
    );
    return 'status' in result
      ? fail(result.status, {
          ...result.data,
          values,
          requiresRefresh: true
        })
      : { ...result, reviewSaved: true };
  },
  withdraw: async ({ locals, params, request }) => {
    const current = admin(locals),
      form = await request.formData();
    if (form.get('confirmed') !== 'on')
      return fail(400, { error: 'Bitte das Zurückziehen bestätigen.' });
    return actionResult(
      () =>
        withdrawPublication(current, {
          submissionId: params.id,
          expectedVersion: Number(field(form, 'version')),
          expectedPublishedRevisionId: field(form, 'publishedRevisionId'),
          reason: field(form, 'reason')
        }),
      'Das veröffentlichte Protokoll wurde zurückgezogen.'
    );
  }
};
function decisionValues(form: FormData) {
  return {
    revisionId: field(form, 'revisionId'),
    version: field(form, 'version'),
    requestKey: field(form, 'requestKey'),
    outcome: field(form, 'outcome'),
    publicFeedback: String(form.get('publicFeedback') ?? ''),
    internalNote: String(form.get('internalNote') ?? ''),
    reward: field(form, 'reward'),
    rewardPolicyVersion: field(form, 'rewardPolicyVersion'),
    rewardRecipientIds: form.getAll('rewardRecipientIds').map(String)
  };
}
