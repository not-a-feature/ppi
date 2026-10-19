import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DomainError, uuid } from './domain/shared.js';
import type { StoredFileInput } from './domain/submissions.js';
import { pool } from './db.js';
import { checkUploadLimits } from './upload-limits.js';
import { MAX_FILE_BYTES } from '../file-limits.js';

export { MAX_FILE_BYTES };
export function filePath(storageKey: string) {
  if (!uuid.test(storageKey)) throw new Error('Invalid internal storage key');
  return resolve(process.env.UPLOAD_DIR ?? '.data/files', storageKey);
}
export function detectFile(bytes: Uint8Array, name: string): StoredFileInput['mediaType'] {
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES)
    throw new DomainError(
      400,
      'file_size',
      'Die Datei darf höchstens 30 MiB groß sein und muss Inhalt haben.'
    );
  if (/\.pdf$/i.test(name) && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-')
    return 'application/pdf';
  if (/\.txt$/i.test(name) && !bytes.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof TypeError)
        throw new DomainError(400, 'file_type', 'Textdateien müssen UTF-8 verwenden.');
      throw error;
    }
    return 'text/plain';
  }
  throw new DomainError(400, 'file_type', 'Nur PDF- und TXT-Dateien sind erlaubt.');
}
export async function storeUpload(file: File, userId?: string): Promise<StoredFileInput> {
  if (!/\.(pdf|txt)$/i.test(file.name))
    throw new DomainError(400, 'file_type', 'Nur PDF- und TXT-Dateien sind erlaubt.');
  if (file.size > MAX_FILE_BYTES)
    throw new DomainError(400, 'file_size', 'Die Datei darf höchstens 30 MiB groß sein.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = detectFile(bytes, file.name);
  if (userId) await checkUploadLimits(pool, userId, bytes.length);
  const storageKey = randomUUID();
  const destination = filePath(storageKey);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(`${destination}.tmp`, bytes, { flag: 'wx', mode: 0o600, flush: true });
  await rename(`${destination}.tmp`, destination);
  return {
    storageKey,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteCount: bytes.length,
    mediaType,
    originalName: file.name.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 255)
  };
}
export async function readStoredFile(storageKey: string) {
  return readFile(filePath(storageKey));
}

export async function cleanupUnreferencedUpload(storageKey: string): Promise<void> {
  const path = filePath(storageKey);
  const referenced = await pool.query(
    'SELECT 1 FROM stored_file WHERE storage_key=$1 UNION ALL SELECT 1 FROM lecture_archive WHERE storage_key=$1 UNION ALL SELECT 1 FROM pdf_derivative WHERE storage_key=$1 LIMIT 1',
    [storageKey]
  );
  if (!referenced.rowCount) await rm(path, { force: true });
}
