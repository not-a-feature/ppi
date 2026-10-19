import {
  type Actor,
  currentActor,
  requireId,
  bounded,
  requireCondition,
  receipt,
  audit,
  notify
} from './shared.js';
import { transaction } from '../db.js';
import { rewardSubmission } from './credits.js';

export async function listReviewQueuePage(
  actor: Actor,
  options: { search?: string; page?: number; includeAll?: boolean; pageSize?: number } = {}
) {
  const { search = '', page: requestedPage = 1, includeAll = false, pageSize = 30 } = options;
  requireCondition(
    Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      Number.isSafeInteger(pageSize) &&
      pageSize > 0 &&
      pageSize <= 30,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  requireCondition(search.length <= 200, 400, 'invalid_search', 'Search is too long.');
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await currentActor(client, actor, true);
    const from = `FROM submission s JOIN submission_revision r ON r.id=s.current_revision_id JOIN stored_file f ON f.id=r.file_id`;
    const filters = includeAll
      ? []
      : [
          `s.files_deleted_at IS NULL AND f.deleted_at IS NULL AND s.review_state IN ('processing','awaiting_review','changes_requested')`
        ];
    const values: unknown[] = [];
    if (search) {
      values.push(search);
      filters.push(
        `(${['s.id::text', 's.uploader_id', 's.current_revision_id::text', 's.published_revision_id::text', 's.review_state', 's.visibility', 'r.remarks', 'f.original_name', 'f.safety_status', 'f.safety_detail::text'].map((field) => `strpos(lower(${field}),lower($1))>0`).join(' OR ')}
          OR EXISTS(SELECT 1 FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id
            WHERE rl.revision_id=r.id AND strpos(lower(l.name),lower($1))>0))`
      );
    }
    const filter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total = Number(
      (await client.query(`SELECT count(*) ${from} ${filter}`, values)).rows[0].count
    );
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const entries = (
      await client.query(
        `SELECT s.*,r.revision_number,r.remarks,f.original_name,f.safety_status,f.safety_detail,
          ARRAY(SELECT l.name FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id
            WHERE rl.revision_id=r.id ORDER BY l.name,l.id) lecture_names ${from} ${filter}
      ORDER BY s.created_at,s.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize]
      )
    ).rows;
    return { entries, total, page, pageSize };
  });
}

export async function getNextReview(actor: Actor, submissionId: string) {
  requireId(submissionId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const result = await client.query<{ id: string; original_name: string }>(
      `SELECT s.id,f.original_name FROM submission s
       JOIN submission_revision r ON r.id=s.current_revision_id
       JOIN stored_file f ON f.id=r.file_id
       JOIN submission current ON current.id=$1
       WHERE s.id<>current.id AND s.review_state='awaiting_review'
         AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL AND f.safety_status='clean'
       ORDER BY (s.created_at,s.id)>(current.created_at,current.id) DESC,s.created_at,s.id
       LIMIT 1`,
      [submissionId]
    );
    return result.rows[0] ?? null;
  });
}

export type DecisionInput = {
  revisionId: string;
  expectedVersion: number;
  outcome: 'accepted' | 'rejected' | 'changes_requested';
  publicFeedback: string;
  internalNote?: string;
  reward: 'none' | 'base' | 'excellent';
  requestKey: string;
  rewardPolicyVersion?: number;
  rewardRecipientIds?: string[];
};

export async function decideSubmission(actor: Actor, input: DecisionInput) {
  requireId(input.revisionId);
  bounded(input.publicFeedback, 4000);
  bounded(input.internalNote ?? '', 4000, false);
  requireCondition(
    ['accepted', 'rejected', 'changes_requested'].includes(input.outcome) &&
      ['none', 'base', 'excellent'].includes(input.reward) &&
      Number.isInteger(input.expectedVersion),
    400,
    'invalid_decision',
    'Invalid review decision.'
  );
  requireCondition(
    input.outcome !== 'changes_requested' || input.reward === 'none',
    400,
    'invalid_reward',
    'Requesting changes cannot award tokens.'
  );
  requireCondition(
    input.reward === 'none' ||
      (Number.isInteger(input.rewardPolicyVersion) &&
        Array.isArray(input.rewardRecipientIds) &&
        input.rewardRecipientIds.length >= 1 &&
        input.rewardRecipientIds.length <= 51 &&
        input.rewardRecipientIds.every((id) => typeof id === 'string')),
    400,
    'reward_preview_required',
    'Confirm the current reward policy and recipient preview.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    return receipt(client, actor, 'decision', input.requestKey, input, async () => {
      const revision = (
        await client.query(
          `SELECT r.*,f.safety_status,f.deleted_at FROM submission_revision r JOIN stored_file f ON f.id=r.file_id WHERE r.id=$1 FOR SHARE OF f`,
          [input.revisionId]
        )
      ).rows[0];
      requireCondition(revision, 404, 'not_found', 'Revision not found.');
      const submission = (
        await client.query('SELECT * FROM submission WHERE id=$1 FOR UPDATE', [
          revision.submission_id
        ])
      ).rows[0];
      requireCondition(
        !submission.files_deleted_at && !revision.deleted_at,
        409,
        'files_deleted',
        'Files were removed from this submission.'
      );
      requireCondition(
        submission.current_revision_id === revision.id &&
          submission.version === input.expectedVersion,
        409,
        'stale_review',
        'The protocol changed. Reload before reviewing it.'
      );
      requireCondition(
        input.outcome !== 'accepted' || revision.safety_status === 'clean',
        409,
        'unsafe_file',
        'Acceptance requires successful technical safety checks.'
      );
      if (input.outcome === 'accepted') {
        const lectures = (
          await client.query(
            'SELECT l.approval_status FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id WHERE rl.revision_id=$1 FOR SHARE OF l',
            [revision.id]
          )
        ).rows;
        requireCondition(
          lectures.length > 0 &&
            lectures.every((lecture) => lecture.approval_status === 'approved'),
          409,
          'lecture_approval_required',
          'Approve all proposed lectures before publishing this protocol.'
        );
      }
      const decision = (
        await client.query(
          `INSERT INTO moderation_decision(revision_id,actor_id,outcome,public_feedback,internal_note) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [revision.id, actor.id, input.outcome, input.publicFeedback, input.internalNote ?? '']
        )
      ).rows[0];
      await client.query(
        `UPDATE submission SET review_state=$2,version=version+1,
        published_revision_id=CASE WHEN $2='accepted' THEN $3 ELSE published_revision_id END,
        visibility=CASE WHEN $2='accepted' THEN 'published' WHEN $2='rejected' AND published_revision_id=$3 THEN 'withdrawn' ELSE visibility END WHERE id=$1`,
        [submission.id, input.outcome, revision.id]
      );
      await client.query(
        `UPDATE reconsideration SET status='resolved',resolved_by=$2,resolution=$3,resolved_at=now() WHERE revision_id=$1 AND status='open'`,
        [revision.id, actor.id, input.publicFeedback]
      );
      if (input.reward !== 'none')
        await rewardSubmission(
          client,
          actor,
          submission,
          revision,
          input.reward,
          input.rewardPolicyVersion,
          input.rewardRecipientIds
        );
      await audit(client, actor.id, 'submission.reviewed', submission.id, {
        revisionId: revision.id,
        outcome: input.outcome,
        reward: input.reward
      });
      await notify(
        client,
        submission.uploader_id,
        `decision:${decision.id}`,
        'Protocol review',
        input.publicFeedback
      );
      return { submissionId: submission.id, revisionId: revision.id };
    });
  });
}

export async function withdrawPublication(
  actor: Actor,
  input: {
    submissionId: string;
    expectedVersion: number;
    expectedPublishedRevisionId: string;
    reason: string;
  }
) {
  requireId(input.submissionId);
  requireId(input.expectedPublishedRevisionId);
  bounded(input.reason, 4000);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const submission = (
      await client.query('SELECT * FROM submission WHERE id=$1 FOR UPDATE', [input.submissionId])
    ).rows[0];
    requireCondition(
      submission &&
        submission.version === input.expectedVersion &&
        submission.published_revision_id === input.expectedPublishedRevisionId &&
        submission.visibility === 'published',
      409,
      'stale_publication',
      'Publication changed. Reload before withdrawing it.'
    );
    const decision = (
      await client.query(
        `INSERT INTO moderation_decision(revision_id,actor_id,outcome,public_feedback) VALUES($1,$2,'withdrawn',$3) RETURNING id`,
        [input.expectedPublishedRevisionId, actor.id, input.reason]
      )
    ).rows[0];
    await client.query(
      "UPDATE submission SET visibility='withdrawn',version=version+1 WHERE id=$1",
      [input.submissionId]
    );
    await notify(
      client,
      submission.uploader_id,
      `withdrawal:${decision.id}`,
      'Protocol publication withdrawn',
      input.reason
    );
    await audit(client, actor.id, 'submission.withdrawn', input.submissionId, {
      revisionId: input.expectedPublishedRevisionId
    });
  });
}

export interface ModerationProvider {
  readonly id: string;
  evaluate(input: {
    revisionId: string;
    generation: number;
    sha256: string;
    policyVersion: number;
  }): Promise<
    | { state: 'unavailable' }
    | {
        state: 'completed';
        recommendation: 'accept' | 'reject' | 'review' | 'abstain';
        reasonCodes: string[];
        providerVersion: string;
      }
  >;
}

export const disabledModerationProvider: ModerationProvider = {
  id: 'disabled',
  async evaluate() {
    return { state: 'unavailable' };
  }
};
