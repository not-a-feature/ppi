import { rm } from 'node:fs/promises';
import { pool, transaction } from './db.js';
import {
  currentActor,
  requireId,
  requireCondition,
  bounded,
  audit,
  type Actor
} from './domain/shared.js';
import { filePath } from './storage.js';
import { evictDeliveredFile } from './download-delivery.js';

export async function requestProtocolFileDeletion(
  actor: Actor,
  input: { submissionId: string; expectedVersion: number; reason: string }
) {
  requireId(input.submissionId);
  const reason = bounded(input.reason, 2000);
  requireCondition(
    Number.isInteger(input.expectedVersion),
    400,
    'invalid_input',
    'A current protocol version is required.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await client.query(
      `SELECT f.id FROM stored_file f JOIN submission_revision r ON r.file_id=f.id WHERE r.submission_id=$1 ORDER BY f.id FOR UPDATE OF f`,
      [input.submissionId]
    );
    const submission = (
      await client.query('SELECT * FROM submission WHERE id=$1 FOR UPDATE', [input.submissionId])
    ).rows[0];
    requireCondition(submission, 404, 'not_found', 'Protocol not found.');
    if (!submission.files_deleted_at) {
      requireCondition(
        submission.version === input.expectedVersion,
        409,
        'stale_review',
        'The protocol changed. Reload before deleting its files.'
      );
      const fileIds = (
        await client.query('SELECT file_id FROM submission_revision WHERE submission_id=$1', [
          input.submissionId
        ])
      ).rows;
      for (const file of fileIds) evictDeliveredFile(file.file_id);
      await client.query(
        "UPDATE pdf_derivative SET status='failed',error='Original file deleted.' WHERE file_id IN (SELECT file_id FROM submission_revision WHERE submission_id=$1)",
        [input.submissionId]
      );
      await client.query(
        `UPDATE stored_file f SET deleted_at=now() FROM submission_revision r WHERE r.submission_id=$1 AND r.file_id=f.id AND f.deleted_at IS NULL`,
        [input.submissionId]
      );
      await client.query(
        `UPDATE submission SET files_deleted_at=now(),visibility='withdrawn',version=version+1 WHERE id=$1`,
        [input.submissionId]
      );
      await client.query(
        'DELETE FROM file_content_check WHERE file_id IN (SELECT file_id FROM submission_revision WHERE submission_id=$1)',
        [input.submissionId]
      );
      await client.query(
        `UPDATE lecture_archive SET status='invalidated',error='A protocol file in this archive was deleted.' WHERE revision_ids && ARRAY(SELECT id FROM submission_revision WHERE submission_id=$1)`,
        [input.submissionId]
      );
      await audit(client, actor.id, 'submission.files_deleted', input.submissionId, { reason });
    }
    await client.query(
      `INSERT INTO core_job(type,business_key,payload) VALUES('delete_files',$1,$2) ON CONFLICT(business_key) DO NOTHING`,
      [`delete_files:${input.submissionId}`, JSON.stringify({ submissionId: input.submissionId })]
    );
    return { submissionId: input.submissionId };
  });
}

export async function cleanupDeletedProtocolFiles(submissionId: string): Promise<void> {
  requireId(submissionId);
  const submission = (
    await pool.query('SELECT files_deleted_at FROM submission WHERE id=$1', [submissionId])
  ).rows[0];
  requireCondition(
    submission?.files_deleted_at,
    409,
    'files_not_deleted',
    'Protocol files have not been marked for deletion.'
  );
  const files = await pool.query<{ storage_key: string }>(
    `SELECT DISTINCT f.storage_key FROM stored_file f JOIN submission_revision r ON r.file_id=f.id WHERE r.submission_id=$1 AND f.deleted_at IS NOT NULL
     UNION SELECT storage_key FROM lecture_archive WHERE storage_key IS NOT NULL AND revision_ids && ARRAY(SELECT id FROM submission_revision WHERE submission_id=$1)
     UNION SELECT p.storage_key FROM pdf_derivative p JOIN submission_revision r ON r.file_id=p.file_id WHERE r.submission_id=$1 AND p.storage_key IS NOT NULL`,
    [submissionId]
  );
  for (const file of files.rows) await rm(filePath(file.storage_key), { force: true });
  await pool.query(
    'UPDATE pdf_derivative SET storage_key=NULL,sha256=NULL,byte_count=NULL WHERE file_id IN (SELECT file_id FROM submission_revision WHERE submission_id=$1)',
    [submissionId]
  );
}
