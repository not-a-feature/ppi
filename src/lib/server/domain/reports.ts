import {
  type Actor,
  currentActor,
  requireCondition,
  requireId,
  bounded,
  receipt,
  audit,
  notify
} from './shared.js';
import { transaction } from '../db.js';
import { queueAdminAlert } from '../admin-alerts.js';

export type ContentReportInput = {
  lectureId?: string;
  submissionId?: string;
  category: 'metadata' | 'inappropriate' | 'unavailable' | 'other';
  explanation: string;
  requestKey: string;
};

export async function reportContent(actor: Actor, input: ContentReportInput) {
  requireCondition(
    Boolean(input.lectureId) !== Boolean(input.submissionId),
    400,
    'invalid_report',
    'Choose one lecture or protocol to report.'
  );
  if (input.lectureId) requireId(input.lectureId);
  if (input.submissionId) requireId(input.submissionId);
  bounded(input.explanation, 2000);
  requireCondition(
    ['metadata', 'inappropriate', 'unavailable', 'other'].includes(input.category),
    400,
    'invalid_report',
    'Invalid report category.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor);
    return receipt(client, actor, 'content_report', input.requestKey, input, async () => {
      if (input.lectureId)
        requireCondition(
          (await client.query('SELECT id FROM lecture WHERE id=$1', [input.lectureId])).rowCount,
          404,
          'not_found',
          'Lecture not found.'
        );
      if (input.submissionId)
        requireCondition(
          (
            await client.query(
              `SELECT s.id FROM submission s JOIN submission_revision r ON r.id=s.published_revision_id
        JOIN stored_file f ON f.id=r.file_id WHERE s.id=$1 AND s.visibility='published' AND f.safety_status='clean'`,
              [input.submissionId]
            )
          ).rowCount,
          404,
          'not_found',
          'Protocol not found.'
        );
      const report = (
        await client.query(
          `INSERT INTO content_report(reporter_id,lecture_id,submission_id,category,explanation) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [
            actor.id,
            input.lectureId ?? null,
            input.submissionId ?? null,
            input.category,
            input.explanation
          ]
        )
      ).rows[0];
      await audit(client, actor.id, 'content.reported', report.id, {
        lectureId: input.lectureId,
        submissionId: input.submissionId,
        category: input.category
      });
      await queueAdminAlert(client, {
        type: 'content_reported',
        key: report.id,
        text: 'Ein Inhalt wurde gemeldet.',
        path: '/admin/reports'
      });
      return report;
    });
  });
}

export async function resolveContentReport(actor: Actor, id: string, resolution: string) {
  requireId(id);
  bounded(resolution, 2000);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const report = (
      await client.query(
        `UPDATE content_report SET status='resolved',resolved_by=$2,resolution=$3,resolved_at=now() WHERE id=$1 AND status='open' RETURNING reporter_id`,
        [id, actor.id, resolution]
      )
    ).rows[0];
    requireCondition(
      report,
      409,
      'report_resolved',
      'This report is unavailable or already resolved.'
    );
    await audit(client, actor.id, 'content.report_resolved', id, { resolution });
    await notify(client, report.reporter_id, `report:${id}`, 'Content report resolved', resolution);
  });
}

export async function requestReconsideration(
  actor: Actor,
  submissionId: string,
  explanation: string
) {
  requireId(submissionId);
  bounded(explanation, 2000);
  return transaction(async (client) => {
    await currentActor(client, actor);
    const submission = (
      await client.query('SELECT * FROM submission WHERE id=$1 FOR UPDATE', [submissionId])
    ).rows[0];
    requireCondition(
      submission && submission.uploader_id === actor.id,
      404,
      'not_found',
      'Protocol not found.'
    );
    requireCondition(
      ['rejected', 'changes_requested'].includes(submission.review_state),
      409,
      'reconsideration_unavailable',
      'Reconsideration is available after rejection or a request for changes.'
    );
    const decision = (
      await client.query(
        'SELECT id,outcome FROM moderation_decision WHERE revision_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [submission.current_revision_id]
      )
    ).rows[0];
    requireCondition(
      decision && ['rejected', 'changes_requested'].includes(decision.outcome),
      409,
      'reconsideration_unavailable',
      'No review decision is available for reconsideration.'
    );
    const request = (
      await client.query(
        `INSERT INTO reconsideration(submission_id,revision_id,decision_id,requester_id,explanation)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(decision_id) DO NOTHING RETURNING id`,
        [submissionId, submission.current_revision_id, decision.id, actor.id, explanation]
      )
    ).rows[0];
    requireCondition(
      request,
      409,
      'reconsideration_exists',
      'Reconsideration was already requested for this decision.'
    );
    await client.query(
      `UPDATE submission s SET review_state=CASE WHEN f.safety_status='clean' THEN 'awaiting_review' ELSE 'processing' END,version=s.version+1
      FROM submission_revision r JOIN stored_file f ON f.id=r.file_id WHERE s.id=$1 AND r.id=s.current_revision_id`,
      [submissionId]
    );
    await audit(client, actor.id, 'submission.reconsideration_requested', submissionId, {
      requestId: request.id
    });
    return request;
  });
}
