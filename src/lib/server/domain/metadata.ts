import { transaction } from '../db.js';
import type { PoolClient } from 'pg';
import { resolveExaminerName } from './catalogue.js';
import { audit, bounded, currentActor, requireCondition, requireId, type Actor } from './shared.js';
import { isValidTerm } from '../../terms.js';

export type ProtocolMetadataInput = {
  revisionId: string;
  expectedVersion: number;
  lectureIds: string[];
  examinerNames: string[];
  term: string;
  examDate: string | null;
  remarks: string;
};

function validDate(value: string | null): value is string | null {
  if (value === null || value === '') return true;
  if (value.startsWith('0000')) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function protocolFileName(
  client: PoolClient,
  term: string,
  examDate: string | null,
  oldName: string,
  mediaType: string
): Promise<string> {
  const suffix = /_(\d+)(\.(?:pdf|txt))$/i.exec(oldName);
  const extension = suffix?.[2] ?? (mediaType === 'application/pdf' ? '.pdf' : '.txt');
  const semester = term.replaceAll('/', '-') || 'unknown-term';
  const number =
    suffix?.[1] ??
    (await client.query("SELECT nextval('protocol_file_number')::text AS number")).rows[0].number;
  return `${semester}_${examDate ?? 'undated'}_${number}${extension}`;
}

export async function updateProtocolMetadata(
  actor: Actor,
  submissionId: string,
  input: ProtocolMetadataInput
) {
  requireId(submissionId);
  requireId(input.revisionId);
  requireCondition(
    Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0,
    400,
    'invalid_version',
    'Invalid protocol version.'
  );
  requireCondition(
    Array.isArray(input.lectureIds) && input.lectureIds.length > 0 && input.lectureIds.length <= 20,
    400,
    'invalid_lectures',
    'Choose between one and twenty lectures.'
  );
  input.lectureIds.forEach(requireId);
  requireCondition(
    new Set(input.lectureIds).size === input.lectureIds.length,
    400,
    'invalid_lectures',
    'A lecture may only be selected once.'
  );
  requireCondition(
    Array.isArray(input.examinerNames) && input.examinerNames.length <= 20,
    400,
    'invalid_examiners',
    'Choose no more than twenty examiners.'
  );
  const examinerNames = input.examinerNames.map((name) => bounded(name, 200));
  requireCondition(
    new Set(examinerNames.map((name) => name.normalize('NFKC').toLocaleLowerCase('de-DE'))).size ===
      examinerNames.length,
    400,
    'invalid_examiners',
    'An examiner may only be selected once.'
  );
  requireCondition(
    typeof input.term === 'string' &&
      input.term.length <= 100 &&
      isValidTerm(input.term, new Date(), input.term),
    400,
    'invalid_term',
    'Choose a canonical semester.'
  );
  requireCondition(validDate(input.examDate), 400, 'invalid_date', 'Use a valid exam date.');
  const examDate = input.examDate === '' ? null : input.examDate;
  const remarks = bounded(input.remarks, 2000, false);

  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const submission = (
      await client.query('SELECT * FROM submission WHERE id=$1 FOR UPDATE', [submissionId])
    ).rows[0];
    requireCondition(submission, 404, 'not_found', 'Protocol not found.');
    requireCondition(
      submission.version === input.expectedVersion,
      409,
      'stale_metadata',
      'The protocol changed. Reload before editing.'
    );
    const revision = (
      await client.query(
        'SELECT r.*,r.exam_date::text stored_exam_date FROM submission_revision r WHERE id=$1 AND submission_id=$2 FOR UPDATE',
        [input.revisionId, submissionId]
      )
    ).rows[0];
    requireCondition(revision, 404, 'not_found', 'Revision not found.');
    const file = (
      await client.query(
        'SELECT id,original_name,media_type,deleted_at FROM stored_file WHERE id=$1 FOR UPDATE',
        [revision.file_id]
      )
    ).rows[0];
    requireCondition(
      !file.deleted_at && !submission.files_deleted_at,
      409,
      'files_deleted',
      'Files were removed from this submission.'
    );

    const lectures = (
      await client.query(
        'SELECT id,approval_status FROM lecture WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [input.lectureIds]
      )
    ).rows;
    requireCondition(
      lectures.length === input.lectureIds.length,
      400,
      'invalid_lectures',
      'A selected lecture does not exist.'
    );
    requireCondition(
      submission.visibility !== 'published' ||
        submission.published_revision_id !== revision.id ||
        lectures.every((lecture) => lecture.approval_status === 'approved'),
      409,
      'lecture_approval_required',
      'Published protocols can only use approved lectures.'
    );

    const beforeLectures = (
      await client.query(
        'SELECT lecture_id FROM revision_lecture WHERE revision_id=$1 ORDER BY lecture_id',
        [revision.id]
      )
    ).rows.map((row) => row.lecture_id as string);
    const beforeExaminers = (
      await client.query(
        `SELECT e.name FROM revision_examiner re JOIN examiner e ON e.id=re.examiner_id
         WHERE re.revision_id=$1 ORDER BY re.position`,
        [revision.id]
      )
    ).rows.map((row) => row.name as string);
    const before = {
      lectureIds: beforeLectures,
      examinerNames: beforeExaminers,
      term: revision.term,
      examDate: revision.stored_exam_date,
      remarks: revision.remarks,
      originalName: file.original_name
    };

    const examiners = [];
    for (const name of examinerNames) examiners.push(await resolveExaminerName(client, name));
    await client.query(
      `UPDATE submission_revision SET examiner_id=$2,exam_date=$3,term=$4,remarks=$5 WHERE id=$1`,
      [revision.id, examiners[0]?.id ?? null, examDate, input.term, remarks]
    );
    await client.query('DELETE FROM revision_lecture WHERE revision_id=$1', [revision.id]);
    for (const lectureId of input.lectureIds)
      await client.query('INSERT INTO revision_lecture(revision_id,lecture_id) VALUES($1,$2)', [
        revision.id,
        lectureId
      ]);
    await client.query('DELETE FROM revision_examiner WHERE revision_id=$1', [revision.id]);
    for (const [index, examiner] of examiners.entries())
      await client.query(
        'INSERT INTO revision_examiner(revision_id,examiner_id,position) VALUES($1,$2,$3)',
        [revision.id, examiner.id, index + 1]
      );
    for (const examiner of examiners)
      await client.query(
        `INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by)
        SELECT unnest($1::uuid[]),$2,$3 ON CONFLICT DO NOTHING`,
        [input.lectureIds, examiner.id, actor.id]
      );

    const originalName = await protocolFileName(
      client,
      input.term,
      examDate,
      file.original_name,
      file.media_type
    );
    await client.query('UPDATE stored_file SET original_name=$2 WHERE id=$1', [
      file.id,
      originalName
    ]);
    await client.query(
      `UPDATE lecture_archive SET status='invalidated',error='Protocol metadata changed. Prepare a new archive.'
       WHERE status IN ('ready','queued') AND revision_ids @> ARRAY[$1::uuid]`,
      [revision.id]
    );
    await client.query('UPDATE submission SET version=version+1 WHERE id=$1', [submissionId]);
    const after = {
      lectureIds: input.lectureIds,
      examinerNames: examiners.map((examiner) => examiner.name),
      term: input.term,
      examDate,
      remarks,
      originalName
    };
    await audit(client, actor.id, 'submission.metadata_updated', submissionId, {
      revisionId: revision.id,
      before,
      after
    });
    return { submissionId, revisionId: revision.id, version: input.expectedVersion + 1 };
  });
}
