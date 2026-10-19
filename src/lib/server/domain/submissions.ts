import {
  type Actor,
  currentActor,
  requireCondition,
  requireId,
  bounded,
  zxId,
  receipt,
  audit
} from './shared.js';
import { transaction } from '../db.js';
import { type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { isValidTerm } from '../../terms.js';
import { proposeLectures, resolveExaminerName } from './catalogue.js';
import { checkUploadLimits } from '../upload-limits.js';
import { MAX_FILE_BYTES } from '../../file-limits.js';
import { queueAdminAlert } from '../admin-alerts.js';

async function creditsDashboard(client: PoolClient, actor: Actor, requestedLedgerPage: number) {
  requireCondition(
    Number.isSafeInteger(requestedLedgerPage) && requestedLedgerPage > 0,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  const balance = (
    await client.query('SELECT balance FROM credit_account WHERE user_id=$1', [actor.id])
  ).rows[0].balance;
  const ledgerPageSize = 30;
  const ledgerTotal = Number(
    (await client.query('SELECT count(*) FROM credit_entry WHERE user_id=$1', [actor.id])).rows[0]
      .count
  );
  const ledgerPage = Math.min(
    requestedLedgerPage,
    Math.max(1, Math.ceil(ledgerTotal / ledgerPageSize))
  );
  const ledger = (
    await client.query(
      `SELECT e.id,e.amount,e.kind,e.reason,e.created_at,
          CASE WHEN e.kind='purchase' THEN CASE WHEN e.reason NOT IN ('','Lecture access','Veranstaltungszugang') THEN e.reason ELSE old_purchase.name END ELSE NULL END lecture_name
          FROM credit_entry e LEFT JOIN LATERAL (
            SELECT CASE WHEN count(*)=1 THEN min(l.name) END name FROM audit_event a JOIN lecture l ON l.id::text=a.entity_id
            WHERE e.kind='purchase' AND e.reason IN ('','Lecture access','Veranstaltungszugang')
              AND a.actor_id=e.user_id AND a.action='lecture.purchased' AND a.created_at=e.created_at
          ) old_purchase ON e.kind='purchase'
          WHERE e.user_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3`,
      [actor.id, ledgerPageSize, (ledgerPage - 1) * ledgerPageSize]
    )
  ).rows;
  const access = (
    await client.query(
      "SELECT a.*,l.name FROM lecture_access a JOIN lecture l ON l.id=a.lecture_id WHERE a.user_id=$1 AND a.expires_at>now() AND l.approval_status='approved' ORDER BY l.name",
      [actor.id]
    )
  ).rows;
  return {
    balance,
    ledger,
    access,
    ledgerPagination: { page: ledgerPage, total: ledgerTotal, pageSize: ledgerPageSize }
  };
}

export async function getCreditsDashboard(actor: Actor, requestedLedgerPage = 1) {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await currentActor(client, actor);
    return creditsDashboard(client, actor, requestedLedgerPage);
  });
}

export async function listOwnSubmissionsPage(actor: Actor, requestedPage = 1) {
  requireCondition(
    Number.isSafeInteger(requestedPage) && requestedPage > 0,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await currentActor(client, actor);
    const total = Number(
      (await client.query('SELECT count(*) FROM submission WHERE uploader_id=$1', [actor.id]))
        .rows[0].count
    );
    const pageSize = 30;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const submissions = (
      await client.query(
        `SELECT s.*,r.revision_number,f.original_name,f.safety_status,
         CASE WHEN s.visibility='published' AND s.files_deleted_at IS NULL AND pf.deleted_at IS NULL
           THEN p.revision_number END published_revision_number FROM submission s
         JOIN submission_revision r ON r.id=s.current_revision_id JOIN stored_file f ON f.id=r.file_id
         LEFT JOIN submission_revision p ON p.id=s.published_revision_id
         LEFT JOIN stored_file pf ON pf.id=p.file_id
         WHERE s.uploader_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT $2 OFFSET $3`,
        [actor.id, pageSize, (page - 1) * pageSize]
      )
    ).rows;
    return { submissions, pagination: { page, total, pageSize } };
  });
}

export type StoredFileInput = {
  storageKey: string;
  sha256: string;
  byteCount: number;
  mediaType: 'application/pdf' | 'text/plain';
  originalName: string;
};

export type SubmissionInput = {
  file: StoredFileInput;
  lectureIds: string[];
  newLectureNames?: string[];
  examinerId?: string;
  examinerName?: string;
  examDate?: string;
  term: string;
  remarks: string;
  collaboratorZx: string[];
  attested: boolean;
  requestKey: string;
};

function submissionFingerprint(input: SubmissionInput) {
  return {
    ...input,
    file: {
      sha256: input.file.sha256,
      byteCount: input.file.byteCount,
      mediaType: input.file.mediaType,
      originalName: input.file.originalName
    }
  };
}

function validateSubmission(input: SubmissionInput) {
  requireCondition(
    input.attested === true,
    400,
    'attestation_required',
    'Confirm that you may submit this protocol.'
  );
  requireCondition(
    Array.isArray(input.lectureIds) &&
      Array.isArray(input.newLectureNames ?? []) &&
      input.lectureIds.length + (input.newLectureNames ?? []).length >= 1 &&
      input.lectureIds.length + (input.newLectureNames ?? []).length <= 20,
    400,
    'lectures_required',
    'Choose between one and twenty lectures.'
  );
  input.lectureIds.forEach(requireId);
  (input.newLectureNames ?? []).forEach((name) => bounded(name, 200));
  if (input.examinerId) requireId(input.examinerId);
  if (input.examinerName) bounded(input.examinerName, 200);
  if (input.examDate)
    requireCondition(
      /^\d{4}-\d{2}-\d{2}$/.test(input.examDate),
      400,
      'invalid_date',
      'Use a valid exam date.'
    );
  requireCondition(
    typeof input.term === 'string' && isValidTerm(input.term),
    400,
    'invalid_term',
    'Choose a valid semester.'
  );
  bounded(input.remarks, 2000, false);
  requireCondition(
    Array.isArray(input.collaboratorZx) && input.collaboratorZx.length <= 50,
    400,
    'invalid_contributors',
    'Too many collaborators.'
  );
  input.collaboratorZx.forEach((zx) =>
    requireCondition(
      zxId.test(zx.trim().toLowerCase()),
      400,
      'invalid_contributor',
      'Collaborator identifiers must use the zx format.'
    )
  );
  requireCondition(
    /^[a-f0-9]{64}$/.test(input.file.sha256) &&
      Number.isInteger(input.file.byteCount) &&
      input.file.byteCount > 0 &&
      input.file.byteCount <= MAX_FILE_BYTES,
    400,
    'invalid_file',
    'Invalid file hash or size.'
  );
  requireCondition(
    ['application/pdf', 'text/plain'].includes(input.file.mediaType),
    400,
    'invalid_file',
    'Only PDF and plain text files are supported.'
  );
  requireCondition(
    /^[a-zA-Z0-9_-]{1,200}$/.test(input.file.storageKey),
    400,
    'invalid_file',
    'Invalid private storage key.'
  );
  bounded(input.file.originalName, 255);
}

async function appendRevision(
  client: PoolClient,
  submissionId: string,
  revisionNumber: number,
  input: SubmissionInput,
  actor: Actor
) {
  const proposedIds = await proposeLectures(client, actor, input.newLectureNames ?? []);
  const lectureIds = [...new Set([...input.lectureIds, ...proposedIds])];
  const lectures = await client.query(
    `SELECT id FROM lecture l WHERE id=ANY($1::uuid[]) AND NOT archived
      AND (approval_status='approved' OR (approval_status='pending' AND ($3 OR EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$2)))) FOR SHARE`,
    [lectureIds, actor.id, actor.isAdmin]
  );
  requireCondition(
    lectures.rowCount === lectureIds.length,
    400,
    'invalid_lecture',
    'A selected lecture is unavailable.'
  );
  let examinerId = input.examinerId;
  if (input.examinerName) {
    examinerId = (await resolveExaminerName(client, input.examinerName)).id;
  }
  if (examinerId)
    requireCondition(
      (
        await client.query(
          `SELECT e.id FROM examiner e WHERE e.id=$1 AND NOT e.archived AND ($3 OR
          EXISTS(SELECT 1 FROM lecture_examiner le WHERE le.examiner_id=e.id AND le.lecture_id=ANY($2::uuid[]))) FOR SHARE`,
          [examinerId, lectureIds, Boolean(input.examinerName)]
        )
      ).rowCount,
      400,
      'invalid_examiner',
      'The examiner is unavailable.'
    );
  if (examinerId)
    for (const lectureId of [...lectureIds].sort())
      await client.query(
        'INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [lectureId, examinerId, actor.id]
      );
  const fileId = randomUUID(),
    revisionId = randomUUID();
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `upload:${actor.id}`
  ]);
  await checkUploadLimits(client, actor.id, input.file.byteCount);
  await client.query(
    `INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name)
     VALUES($1,$2,$3,$4,$5,concat(replace($6::text,'/','-'),'_',coalesce($7::date::text,'undated'),'_',
       nextval('protocol_file_number'),CASE WHEN $5='application/pdf' THEN '.pdf' ELSE '.txt' END))`,
    [
      fileId,
      input.file.storageKey,
      input.file.sha256,
      input.file.byteCount,
      input.file.mediaType,
      input.term,
      input.examDate ?? null
    ]
  );
  await client.query(
    `INSERT INTO submission_revision(id,submission_id,revision_number,file_id,examiner_id,exam_date,term,remarks,attested)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)`,
    [
      revisionId,
      submissionId,
      revisionNumber,
      fileId,
      examinerId ?? null,
      input.examDate ?? null,
      input.term ?? null,
      input.remarks
    ]
  );
  if (examinerId)
    await client.query(
      'INSERT INTO revision_examiner(revision_id,examiner_id,position) VALUES($1,$2,1)',
      [revisionId, examinerId]
    );
  for (const id of lectureIds)
    await client.query('INSERT INTO revision_lecture(revision_id,lecture_id) VALUES($1,$2)', [
      revisionId,
      id
    ]);
  for (const zx of [...new Set(input.collaboratorZx.map((value) => value.trim().toLowerCase()))])
    await client.query('INSERT INTO contributor_claim(revision_id,zx) VALUES($1,$2)', [
      revisionId,
      zx
    ]);
  await client.query(
    `UPDATE submission SET current_revision_id=$2,review_state='processing',version=version+1 WHERE id=$1`,
    [submissionId, revisionId]
  );
  await client.query(`INSERT INTO core_job(type,business_key,payload) VALUES('file_check',$1,$2)`, [
    `file_check:${fileId}:1`,
    JSON.stringify({ revisionId, fileId, generation: 1 })
  ]);
  return { submissionId, revisionId };
}

export async function submitProtocol(actor: Actor, input: SubmissionInput) {
  validateSubmission(input);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    return receipt(
      client,
      actor,
      'submit',
      input.requestKey,
      submissionFingerprint(input),
      async () => {
        const submissionId = randomUUID();
        await client.query('INSERT INTO submission(id,uploader_id) VALUES($1,$2)', [
          submissionId,
          actor.id
        ]);
        const result = await appendRevision(client, submissionId, 1, input, actual);
        await audit(client, actor.id, 'submission.created', submissionId);
        await queueAdminAlert(client, {
          type: 'protocol_uploaded',
          key: result.revisionId,
          text: 'Ein neues Protokoll wurde hochgeladen.',
          path: `/admin/review/${submissionId}`
        });
        return result;
      }
    );
  });
}

export async function reviseProtocol(actor: Actor, submissionId: string, input: SubmissionInput) {
  requireId(submissionId);
  input = { ...input, examDate: undefined };
  validateSubmission(input);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    return receipt(
      client,
      actor,
      'revise',
      input.requestKey,
      { submissionId, input: submissionFingerprint(input) },
      async () => {
        const submission = (
          await client.query(
            `SELECT s.*,r.revision_number,r.exam_date::text inherited_exam_date FROM submission s JOIN submission_revision r ON r.id=s.current_revision_id WHERE s.id=$1 FOR UPDATE OF s`,
            [submissionId]
          )
        ).rows[0];
        requireCondition(
          submission && submission.uploader_id === actor.id,
          403,
          'uploader_required',
          'Only the uploader may improve this protocol.'
        );
        requireCondition(
          !submission.files_deleted_at,
          409,
          'files_deleted',
          'Files were removed from this submission.'
        );
        const result = await appendRevision(
          client,
          submissionId,
          submission.revision_number + 1,
          { ...input, examDate: submission.inherited_exam_date ?? undefined },
          actual
        );
        await audit(client, actor.id, 'submission.revised', submissionId, {
          revisionId: result.revisionId
        });
        await queueAdminAlert(client, {
          type: 'protocol_uploaded',
          key: result.revisionId,
          text: 'Eine Verbesserung wurde hochgeladen.',
          path: `/admin/review/${submissionId}`
        });
        return result;
      }
    );
  });
}

export async function completeFileCheck(input: {
  fileId: string;
  generation: number;
  status: 'clean' | 'blocked' | 'failed';
  detail: string;
}) {
  requireId(input.fileId);
  requireCondition(
    ['clean', 'blocked', 'failed'].includes(input.status) &&
      Number.isInteger(input.generation) &&
      input.generation > 0,
    400,
    'invalid_check',
    'Invalid safety-check result.'
  );
  return transaction(async (client) => {
    const updated = await client.query(
      `UPDATE stored_file f SET safety_status=$3,safety_detail=$4 WHERE id=$1 AND safety_generation=$2 AND safety_status='pending' AND deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM submission_revision r JOIN submission s ON s.id=r.submission_id WHERE r.file_id=f.id AND s.files_deleted_at IS NOT NULL) RETURNING id`,
      [input.fileId, input.generation, input.status, input.detail]
    );
    if (!updated.rowCount) return false;
    if (input.status === 'clean')
      await client.query(
        `INSERT INTO core_job(type,business_key,payload) VALUES('content_check',$1,$2) ON CONFLICT(business_key) DO NOTHING`,
        [
          `content_check:${input.fileId}:${input.generation}`,
          JSON.stringify({ fileId: input.fileId, generation: input.generation })
        ]
      );
    if (input.status === 'clean')
      await client.query(
        `UPDATE submission s SET review_state='awaiting_review',version=version+1 FROM submission_revision r
      WHERE s.current_revision_id=r.id AND r.file_id=$1 AND s.review_state='processing'`,
        [input.fileId]
      );
    await audit(client, null, 'file.checked', input.fileId, {
      generation: input.generation,
      status: input.status
    });
    return true;
  });
}

export async function getSubmission(actor: Actor, id: string) {
  requireId(id);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    const submission = (await client.query('SELECT * FROM submission WHERE id=$1', [id])).rows[0];
    requireCondition(
      submission && (actual.isAdmin || submission.uploader_id === actor.id),
      404,
      'not_found',
      'Protocol not found.'
    );
    const revisions = (
      await client.query(
        `SELECT r.*,f.original_name,f.safety_status,f.safety_detail,f.deleted_at file_deleted_at,
      (SELECT string_agg(e.name, ', ' ORDER BY re.position) FROM revision_examiner re JOIN examiner e ON e.id=re.examiner_id WHERE re.revision_id=r.id) examiner_name,
      ARRAY(SELECT lecture_id FROM revision_lecture WHERE revision_id=r.id) lecture_ids,
      ARRAY(SELECT zx FROM contributor_claim WHERE revision_id=r.id) collaborator_zx
      FROM submission_revision r JOIN stored_file f ON f.id=r.file_id WHERE r.submission_id=$1 ORDER BY r.revision_number DESC`,
        [id]
      )
    ).rows;
    const revisionIds = revisions.map((revision) => revision.id);
    const decisions = (
      await client.query(
        `SELECT revision_id,id,outcome,public_feedback,created_at${actual.isAdmin ? ',internal_note' : ''}
         FROM moderation_decision WHERE revision_id=ANY($1::uuid[]) ORDER BY revision_id,created_at,id`,
        [revisionIds]
      )
    ).rows;
    const reconsiderations = (
      await client.query(
        `SELECT revision_id,id,explanation,status,resolution,created_at,resolved_at
         FROM reconsideration WHERE revision_id=ANY($1::uuid[]) ORDER BY revision_id,created_at,id`,
        [revisionIds]
      )
    ).rows;
    const history = Object.fromEntries(revisions.map((revision) => [revision.id, revision]));
    for (const revision of revisions) {
      revision.decisions = [];
      revision.reconsiderations = [];
    }
    for (const { revision_id, ...decision } of decisions)
      history[revision_id].decisions.push(decision);
    for (const { revision_id, ...reconsideration } of reconsiderations)
      history[revision_id].reconsiderations.push(reconsideration);
    if (actual.isAdmin) {
      const rewardAllocation =
        (await client.query('SELECT * FROM reward_allocation WHERE submission_id=$1', [id]))
          .rows[0] ?? null;
      const rewardRecipients = (
        await client.query(
          'SELECT r.*,u.email FROM reward_recipient r JOIN "user" u ON u.id=r.user_id WHERE r.submission_id=$1',
          [id]
        )
      ).rows;
      return { ...submission, revisions, rewardAllocation, rewardRecipients };
    }
    return { ...submission, revisions };
  });
}

export async function getDownload(actor: Actor, revisionId: string) {
  requireId(revisionId);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    const file = (
      await client.query(
        `SELECT f.*,s.uploader_id,s.visibility,s.published_revision_id,s.files_deleted_at,
      NOT EXISTS(SELECT 1 FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id WHERE rl.revision_id=r.id AND l.approval_status<>'approved') approved_lectures,
      EXISTS(SELECT 1 FROM revision_lecture rl JOIN lecture_access a ON a.lecture_id=rl.lecture_id WHERE rl.revision_id=r.id AND a.user_id=$2 AND a.expires_at>now()) has_access
      FROM submission_revision r JOIN submission s ON s.id=r.submission_id JOIN stored_file f ON f.id=r.file_id WHERE r.id=$1`,
        [revisionId, actor.id]
      )
    ).rows[0];
    requireCondition(
      file &&
        !file.deleted_at &&
        !file.files_deleted_at &&
        file.safety_status === 'clean' &&
        (actual.isAdmin ||
          file.uploader_id === actor.id ||
          (file.visibility === 'published' &&
            file.approved_lectures &&
            file.published_revision_id === revisionId &&
            file.has_access)),
      404,
      'not_found',
      'File unavailable.'
    );
    return {
      fileId: file.id,
      generation: file.safety_generation,
      storageKey: file.storage_key,
      originalName: file.original_name,
      mediaType: file.media_type,
      byteCount: file.byte_count,
      sha256: file.sha256
    };
  });
}

export async function reprocessFile(actor: Actor, submissionId: string, revisionId?: string) {
  requireId(submissionId);
  if (revisionId !== undefined) requireId(revisionId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const submission = (
      await client.query(
        `SELECT s.current_revision_id,r.id revision_id,r.file_id FROM submission s
         JOIN submission_revision r ON r.submission_id=s.id AND r.id=COALESCE($2::uuid,s.current_revision_id)
         JOIN stored_file f ON f.id=r.file_id
         WHERE s.id=$1 AND s.files_deleted_at IS NULL FOR UPDATE OF f`,
        [submissionId, revisionId ?? null]
      )
    ).rows[0];
    requireCondition(submission, 404, 'not_found', 'Protocol revision not found.');
    const file = (
      await client.query(
        `UPDATE stored_file SET safety_generation=safety_generation+1,safety_status='pending',safety_detail='' WHERE id=$1 AND deleted_at IS NULL RETURNING safety_generation`,
        [submission.file_id]
      )
    ).rows[0];
    requireCondition(file, 409, 'files_deleted', 'Files were removed from this submission.');
    await client.query(
      `INSERT INTO core_job(type,business_key,payload) VALUES('file_check',$1,$2)`,
      [
        `file_check:${submission.file_id}:${file.safety_generation}`,
        JSON.stringify({
          revisionId: submission.revision_id,
          fileId: submission.file_id,
          generation: file.safety_generation
        })
      ]
    );
    const updated = await client.query(
      `UPDATE submission SET version=version+1 WHERE id=$1 AND files_deleted_at IS NULL
       AND ($3 OR current_revision_id=$2) RETURNING id`,
      [submissionId, submission.revision_id, revisionId !== undefined]
    );
    requireCondition(
      updated.rowCount,
      409,
      'stale_revision',
      'The protocol changed. Reload before reprocessing it.'
    );
    await audit(client, actor.id, 'file.reprocess_requested', submission.file_id, {
      revisionId: submission.revision_id,
      generation: file.safety_generation
    });
    return { fileId: submission.file_id, generation: file.safety_generation };
  });
}
