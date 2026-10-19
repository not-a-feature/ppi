import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { DomainError } from './domain/shared.js';

function limit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  assert(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

export async function checkUploadLimits(
  client: Pool | PoolClient,
  userId: string,
  byteCount: number
) {
  const quota = (
    await client.query(
      `WITH owned AS (
       SELECT f.* FROM stored_file f JOIN submission_revision r ON r.file_id=f.id
       JOIN submission s ON s.id=r.submission_id WHERE s.uploader_id=$1
     ) SELECT count(*) FILTER (WHERE created_at>now()-interval '1 hour')::integer recent,
       COALESCE(sum(byte_count) FILTER (WHERE deleted_at IS NULL),0)
         +COALESCE((SELECT sum(p.byte_count) FROM pdf_derivative p JOIN owned f ON f.id=p.file_id WHERE f.deleted_at IS NULL),0) bytes,
       count(*) FILTER (WHERE deleted_at IS NULL AND (safety_status='pending'
         OR (safety_status='clean' AND NOT EXISTS(SELECT 1 FROM file_content_check c WHERE c.file_id=owned.id AND c.generation=owned.safety_generation))
         OR EXISTS(SELECT 1 FROM pdf_derivative p WHERE p.file_id=owned.id AND p.generation=owned.safety_generation AND p.status='pending')))::integer pending
       FROM owned`,
      [userId]
    )
  ).rows[0];
  if (quota.recent >= limit('UPLOADS_PER_HOUR', 30))
    throw new DomainError(
      429,
      'upload_rate_limit',
      'Zu viele Uploads. Bitte in einer Stunde erneut versuchen.'
    );
  if (Number(quota.bytes) + byteCount > limit('UPLOAD_STORAGE_MIB', 256) * 1024 * 1024)
    throw new DomainError(
      429,
      'upload_storage_limit',
      'Dein Upload-Speicherlimit ist erreicht. Bitte die Redaktion kontaktieren.'
    );
  if (quota.pending >= limit('UPLOAD_PENDING_LIMIT', 10))
    throw new DomainError(
      429,
      'upload_pending_limit',
      'Bitte warten, bis deine bisherigen Dateien verarbeitet wurden.'
    );
}
