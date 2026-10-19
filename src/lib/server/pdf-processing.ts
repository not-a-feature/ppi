import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import { pool, transaction } from './db.js';
import { filePath } from './storage.js';
import { extractDocumentText } from './document-text.js';
import { requireId } from './domain/shared.js';

const execute = promisify(execFile);

export async function getReadableSource(
  fileId: string,
  generation: number,
  storageKey: string,
  sha256: string
) {
  const row = (
    await pool.query(
      `SELECT storage_key,sha256 FROM pdf_derivative WHERE file_id=$1 AND generation=$2 AND status IN ('ready','partial')`,
      [fileId, generation]
    )
  ).rows[0];
  return row
    ? { storageKey: row.storage_key as string, sha256: row.sha256 as string }
    : { storageKey, sha256 };
}

export async function scheduleOcr(
  client: PoolClient,
  fileId: string,
  generation: number,
  pages: number[]
) {
  const result = await client.query(
    `INSERT INTO pdf_derivative(file_id,generation,status,processed_at,pages) VALUES($1,$2,$3,CASE WHEN $3='skipped' THEN now() ELSE NULL END,$4)
     ON CONFLICT(file_id,generation) DO UPDATE SET status='pending',error='',pages=EXCLUDED.pages
       WHERE $3='pending' AND pdf_derivative.status IN ('failed','skipped')
     RETURNING status`,
    [fileId, generation, pages.length ? 'pending' : 'skipped', pages]
  );
  if (result.rows[0]?.status === 'pending')
    await client.query("INSERT INTO core_job(type,business_key,payload) VALUES('pdf_ocr',$1,$2)", [
      `pdf_ocr:${fileId}:${generation}:${randomUUID()}`,
      JSON.stringify({ fileId, generation })
    ]);
}

export async function processPdfOcr(fileId: string, generation: number) {
  requireId(fileId);
  const file = (await pool.query('SELECT * FROM stored_file WHERE id=$1', [fileId])).rows[0];
  if (
    !file ||
    file.deleted_at ||
    file.safety_status !== 'clean' ||
    file.safety_generation !== generation ||
    file.media_type !== 'application/pdf'
  )
    return;
  const derivative = (
    await pool.query('SELECT status,pages FROM pdf_derivative WHERE file_id=$1 AND generation=$2', [
      fileId,
      generation
    ])
  ).rows[0];
  if (!derivative || !['pending', 'failed'].includes(derivative.status)) return;
  const directory = await mkdtemp(join(tmpdir(), 'ppi-ocr-'));
  const output = join(directory, 'searchable.pdf');
  const storageKey = randomUUID();
  let published = false;
  try {
    await execute(
      process.env.OCRMYPDF_PATH ?? 'ocrmypdf',
      [
        '--skip-text',
        '--pages',
        derivative.pages.join(','),
        '--output-type',
        'pdf',
        '--optimize',
        '0',
        '--fast-web-view',
        '999999',
        '--jobs',
        '2',
        '--language',
        'deu+eng',
        '--tesseract-timeout',
        '15',
        '--skip-big',
        '20',
        filePath(file.storage_key),
        output
      ],
      {
        timeout: 180000,
        maxBuffer: 1048576,
        windowsHide: true,
        env: { ...process.env, OMP_THREAD_LIMIT: '1' }
      }
    );
    const bytes = await readFile(output);
    if (bytes.length > 64 * 1024 * 1024) throw new Error('OCR output exceeds 64 MiB');
    const original = await extractDocumentText(
      await readFile(filePath(file.storage_key)),
      'application/pdf'
    );
    const extracted = await extractDocumentText(bytes, 'application/pdf');
    if (extracted.pageCount !== original.pageCount || extracted.reason)
      throw new Error('OCR output validation failed');
    await writeFile(filePath(storageKey), bytes, { flag: 'wx', mode: 0o600, flush: true });
    published = await transaction(async (client) => {
      const current = (
        await client.query('SELECT * FROM stored_file WHERE id=$1 FOR SHARE', [fileId])
      ).rows[0];
      if (
        !current ||
        current.deleted_at ||
        current.safety_status !== 'clean' ||
        current.safety_generation !== generation
      )
        return false;
      await client.query(
        `UPDATE pdf_derivative SET status=$3,storage_key=$4,sha256=$5,byte_count=$6,error='',processed_at=now()
         WHERE file_id=$1 AND generation=$2`,
        [
          fileId,
          generation,
          extracted.textlessPages || extracted.ocrPages.length ? 'partial' : 'ready',
          storageKey,
          createHash('sha256').update(bytes).digest('hex'),
          bytes.length
        ]
      );
      await client.query('DELETE FROM file_content_check WHERE file_id=$1', [fileId]);
      await client.query(
        "INSERT INTO core_job(type,business_key,payload) VALUES('content_check',$1,$2) ON CONFLICT(business_key) DO NOTHING",
        [
          `content_check:ocr:${fileId}:${generation}:${storageKey}`,
          JSON.stringify({ fileId, generation })
        ]
      );
      await client.query(
        `UPDATE lecture_archive SET status='invalidated',error='A searchable PDF became available. Prepare a new archive.'
         WHERE revision_ids && ARRAY(SELECT id FROM submission_revision WHERE file_id=$1)`,
        [fileId]
      );
      return true;
    });
  } catch (error) {
    await pool.query(
      "UPDATE pdf_derivative SET status='failed',error='OCR failed. The original file is retained.',processed_at=now() WHERE file_id=$1 AND generation=$2 AND status IN ('pending','failed')",
      [fileId, generation]
    );
    throw error;
  } finally {
    if (
      !published &&
      !(await pool.query('SELECT 1 FROM pdf_derivative WHERE storage_key=$1', [storageKey]))
        .rowCount
    )
      await rm(filePath(storageKey), { force: true });
    await rm(directory, { recursive: true, force: true });
  }
}
