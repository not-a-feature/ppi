import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg, { type PoolClient } from 'pg';
import { ZipFile } from 'yazl';
import { databaseConnectionOptions, pool, transaction } from './db.js';
import { currentActor, getActor, DomainError, type Actor } from './domain/index.js';
import { filePath } from './storage.js';
import { getDeliveryBytes } from './download-delivery.js';
import { downloadDay } from './download-watermark.js';
import { uploadNumberSql } from './domain/shared.js';

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 100;
function archiveName(name: string) {
  return (
    name
      .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 160) || 'protocols'
  );
}
function requireId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new DomainError(400, 'invalid_id', 'Invalid archive identifier.');
}
async function validArchive(client: PoolClient | pg.Client, archive: Record<string, any>) {
  if (!archive.watermark_day) return false;
  const row = (
    await client.query(
      `SELECT
    $4::timestamptz>now() unexpired,
    ($5::timestamptz AT TIME ZONE 'Europe/Berlin')::date=(now() AT TIME ZONE 'Europe/Berlin')::date current_day,
    EXISTS(SELECT 1 FROM "user" u JOIN ppi_user p ON p.user_id=u.id WHERE u.id=$1 AND u."emailVerified" AND p.status='active') eligible,
    EXISTS(SELECT 1 FROM lecture_access a JOIN lecture l ON l.id=a.lecture_id WHERE a.user_id=$1 AND a.lecture_id=$2 AND a.expires_at>now() AND l.approval_status='approved') entitled,
    (SELECT count(*)::integer FROM submission_revision r JOIN submission s ON s.published_revision_id=r.id JOIN stored_file f ON f.id=r.file_id
      WHERE r.id=ANY($3::uuid[]) AND s.visibility='published' AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL AND f.safety_status='clean'
      AND NOT EXISTS(SELECT 1 FROM revision_lecture other JOIN lecture l ON l.id=other.lecture_id WHERE other.revision_id=r.id AND l.approval_status<>'approved')
      AND EXISTS(SELECT 1 FROM revision_lecture rl WHERE rl.revision_id=r.id AND rl.lecture_id=$2)) valid_count`,
      [
        archive.requester_id,
        archive.lecture_id,
        archive.revision_ids,
        archive.expires_at,
        archive.created_at
      ]
    )
  ).rows[0];
  return (
    row.unexpired &&
    row.current_day &&
    row.eligible &&
    row.entitled &&
    row.valid_count === archive.revision_ids.length
  );
}
async function invalidate(client: PoolClient | pg.Client, id: string) {
  await client.query(
    "UPDATE lecture_archive SET status='invalidated',error='Archive expired or its access or publication changed.' WHERE id=$1",
    [id]
  );
}
export async function requestArchive(actor: Actor, lectureId: string) {
  requireId(lectureId);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `archive:${actor.id}:${lectureId}`
    ]);
    await currentActor(client, actor);
    const entitlement = await client.query(
      "SELECT a.lecture_id FROM lecture_access a JOIN lecture l ON l.id=a.lecture_id WHERE a.user_id=$1 AND a.lecture_id=$2 AND a.expires_at>now() AND l.approval_status='approved' FOR SHARE OF a,l",
      [actor.id, lectureId]
    );
    if (!entitlement.rowCount)
      throw new DomainError(
        403,
        'lecture_access_required',
        'Current lecture access is required to prepare an archive.'
      );
    const files = (
      await client.query(
        `SELECT r.id,f.byte_count FROM submission s JOIN submission_revision r ON r.id=s.published_revision_id
      JOIN stored_file f ON f.id=r.file_id WHERE s.visibility='published' AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL AND f.safety_status='clean'
      AND NOT EXISTS(SELECT 1 FROM revision_lecture other JOIN lecture l ON l.id=other.lecture_id WHERE other.revision_id=r.id AND l.approval_status<>'approved')
      AND EXISTS(SELECT 1 FROM revision_lecture rl WHERE rl.revision_id=r.id AND rl.lecture_id=$1) ORDER BY r.id LIMIT 101`,
        [lectureId]
      )
    ).rows;
    if (!files.length)
      throw new DomainError(
        409,
        'empty_archive',
        'No published safe protocols are available for this lecture.'
      );
    if (
      files.length > MAX_ARCHIVE_FILES ||
      files.reduce((sum, file) => sum + file.byte_count, 0) > MAX_ARCHIVE_BYTES
    )
      throw new DomainError(
        413,
        'archive_too_large',
        'Archives are limited to 100 protocols and 200 MiB. Download individual files instead.'
      );
    const revisionIds = files.map((file) => file.id);
    const existing = (
      await client.query(
        `SELECT * FROM lecture_archive WHERE requester_id=$1 AND lecture_id=$2
       AND revision_ids=$3::uuid[] AND status IN ('queued','ready') AND expires_at>now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [actor.id, lectureId, revisionIds]
      )
    ).rows[0];
    if (existing && (await validArchive(client, existing)))
      return {
        id: existing.id,
        status: existing.status as 'queued' | 'ready',
        expiresAt: existing.expires_at as Date
      };
    const archive = (
      await client.query(
        `INSERT INTO lecture_archive(requester_id,lecture_id,revision_ids,expires_at,watermark_day)
         VALUES($1,$2,$3,LEAST(now()+interval '1 hour',(date_trunc('day',now() AT TIME ZONE 'Europe/Berlin')+interval '1 day') AT TIME ZONE 'Europe/Berlin'),(now() AT TIME ZONE 'Europe/Berlin')::date) RETURNING id,status,expires_at`,
        [actor.id, lectureId, files.map((file) => file.id)]
      )
    ).rows[0];
    await client.query(
      "INSERT INTO core_job(type,business_key,payload) VALUES('prepare_archive',$1,$2)",
      [`archive:${archive.id}`, JSON.stringify({ archiveId: archive.id })]
    );
    await client.query(
      'INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)',
      [
        actor.id,
        'archive.requested',
        archive.id,
        JSON.stringify({ lectureId, fileCount: files.length })
      ]
    );
    return {
      id: archive.id,
      status: archive.status as 'queued' | 'ready',
      expiresAt: archive.expires_at as Date
    };
  });
}
export async function prepareArchive(archiveId: string) {
  requireId(archiveId);
  const client = new pg.Client(databaseConnectionOptions());
  await client.connect();
  // Session locks survive the short transactions without reserving an application pool slot.
  let connectionError: Error | undefined;
  client.on('error', (error) => {
    connectionError = error;
  });
  let claimed = false;
  const deliveredFiles: string[] = [];
  const storageKey = randomUUID(),
    destination = filePath(storageKey),
    temporary = `${destination}.tmp`;
  try {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
      [`archive-build:${archiveId}`]
    );
    if (!locked.rows[0].acquired)
      throw new DomainError(409, 'archive_busy', 'Archive preparation is already running.');
    claimed = true;
    await client.query('BEGIN');
    const archive = (
      await client.query('SELECT * FROM lecture_archive WHERE id=$1 FOR UPDATE', [archiveId])
    ).rows[0];
    if (!archive) throw new DomainError(404, 'not_found', 'Archive not found.');
    if (archive.status === 'invalidated' || !(await validArchive(client, archive))) {
      await invalidate(client, archiveId);
      await client.query('COMMIT');
      return { id: archiveId, status: 'invalidated' as const };
    }
    if (archive.status === 'ready') {
      await client.query('COMMIT');
      return { id: archiveId, status: 'ready' as const };
    }
    const files = (
      await client.query(
        `SELECT r.id,s.id submission_id,s.created_at uploaded_at,${uploadNumberSql} upload_number,
        r.term,r.exam_date::text exam_date,
        ARRAY(SELECT l.name FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id WHERE rl.revision_id=r.id ORDER BY l.name) lectures,
        ARRAY(SELECT e.name FROM revision_examiner re JOIN examiner e ON e.id=re.examiner_id WHERE re.revision_id=r.id ORDER BY re.position) examiners,
        f.id file_id,f.storage_key,f.original_name,f.byte_count,f.sha256,f.media_type,f.safety_generation
        FROM submission_revision r JOIN submission s ON s.id=r.submission_id JOIN stored_file f ON f.id=r.file_id
        WHERE r.id=ANY($1::uuid[]) ORDER BY s.created_at DESC,s.id DESC`,
        [archive.revision_ids]
      )
    ).rows;
    await client.query('COMMIT');
    if (
      files.length > MAX_ARCHIVE_FILES ||
      files.reduce((sum, file) => sum + file.byte_count, 0) > MAX_ARCHIVE_BYTES
    )
      throw new DomainError(413, 'archive_too_large', 'Archive exceeds the file or byte limit.');
    for (const file of files)
      if ((await stat(filePath(file.storage_key))).size !== file.byte_count)
        throw new Error('Stored file size differs from its recorded size.');
    const requester = await getActor(archive.requester_id);
    if (!requester)
      throw new DomainError(403, 'account_ineligible', 'The requesting account is unavailable.');
    let deliveredBytes = 0;
    for (const file of files) {
      const bytes = await getDeliveryBytes(
        {
          fileId: file.file_id,
          generation: file.safety_generation,
          storageKey: file.storage_key,
          sha256: file.sha256,
          mediaType: file.media_type
        },
        requester,
        { day: downloadDay(archive.created_at), cache: false }
      );
      deliveredBytes += bytes.length;
      if (deliveredBytes > MAX_ARCHIVE_BYTES)
        throw new DomainError(
          413,
          'archive_too_large',
          'Delivered files exceed the archive size limit.'
        );
      const path = filePath(randomUUID());
      deliveredFiles.push(path);
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    }
    await mkdir(dirname(destination), { recursive: true });
    const zip = new ZipFile();
    const zipStream = zip.outputStream as Readable;
    zip.on('error', (error) => zipStream.destroy(error));
    const output = pipeline(zipStream, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const index = files.map((file, position) => {
      const filename = `${file.upload_number ?? position + 1}-${archiveName(file.original_name)}`;
      zip.addFile(deliveredFiles[position], filename);
      return {
        number: file.upload_number,
        submission_id: file.submission_id,
        filename,
        lectures: file.lectures,
        examiners: file.examiners,
        semester: file.term,
        exam_date: file.exam_date,
        uploaded_at: file.uploaded_at.toISOString()
      };
    });
    zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2) + '\n'), 'index.json');
    zip.end();
    await output;
    await rename(temporary, destination);
    const byteCount = (await stat(destination)).size;
    if (connectionError) throw connectionError;
    await client.query('BEGIN');
    const current = (
      await client.query('SELECT * FROM lecture_archive WHERE id=$1 FOR UPDATE', [archiveId])
    ).rows[0];
    if (current.status === 'invalidated' || !(await validArchive(client, current))) {
      await invalidate(client, archiveId);
      await client.query('COMMIT');
      await rm(destination, { force: true });
      return { id: archiveId, status: 'invalidated' as const };
    }
    await client.query(
      "UPDATE lecture_archive SET status='ready',storage_key=$2,byte_count=$3,error='',completed_at=now() WHERE id=$1",
      [archiveId, storageKey, byteCount]
    );
    await client.query('COMMIT');
    return { id: archiveId, status: 'ready' as const };
  } catch (error) {
    await client.end();
    await rm(temporary, { force: true });
    if (claimed) {
      // A connection failure can hide a successful COMMIT; keep any published bytes.
      const recorded = (
        await pool.query('SELECT storage_key FROM lecture_archive WHERE id=$1', [archiveId])
      ).rows[0];
      if (recorded?.storage_key !== storageKey) await rm(destination, { force: true });
      await pool.query(
        "UPDATE lecture_archive SET status='failed',error=$2 WHERE id=$1 AND status NOT IN ('ready','invalidated')",
        [archiveId, 'Archive preparation failed. The worker can retry this job.']
      );
    }
    throw error;
  } finally {
    await client.end();
    await Promise.all(deliveredFiles.map((path) => rm(path, { force: true })));
  }
}
export async function getArchive(actor: Actor, id: string) {
  requireId(id);
  return transaction(async (client) => {
    await currentActor(client, actor);
    const archive = (
      await client.query(
        'SELECT * FROM lecture_archive WHERE id=$1 AND requester_id=$2 FOR UPDATE',
        [id, actor.id]
      )
    ).rows[0];
    if (!archive) throw new DomainError(404, 'not_found', 'Archive not found.');
    if (archive.status !== 'invalidated' && !(await validArchive(client, archive))) {
      await invalidate(client, id);
      archive.status = 'invalidated';
      archive.error = 'Archive expired or its access or publication changed.';
    }
    return {
      id: archive.id,
      status: archive.status as 'queued' | 'ready' | 'failed' | 'invalidated',
      error: archive.error,
      expires_at: archive.expires_at as Date,
      lecture_id: archive.lecture_id,
      file_count: archive.revision_ids.length
    };
  });
}
export async function getLectureArchive(actor: Actor, lectureId: string, fileCount: number) {
  requireId(lectureId);
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM lecture_archive WHERE requester_id=$1 AND lecture_id=$2
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [actor.id, lectureId]
  );
  if (!result.rowCount) return null;
  const archive = await getArchive(actor, result.rows[0].id);
  return archive.file_count === fileCount && archive.status !== 'invalidated' ? archive : null;
}

export async function getArchiveDownload(actor: Actor, id: string, openFile = false) {
  requireId(id);
  const result = await transaction(async (client) => {
    await currentActor(client, actor);
    const archive = (
      await client.query(
        `SELECT a.*,l.name lecture_name FROM lecture_archive a JOIN lecture l ON l.id=a.lecture_id
        WHERE a.id=$1 AND a.requester_id=$2 FOR UPDATE OF a`,
        [id, actor.id]
      )
    ).rows[0];
    if (!archive) throw new DomainError(404, 'not_found', 'Archive not found.');
    if (archive.status === 'invalidated' || !(await validArchive(client, archive))) {
      await invalidate(client, id);
      return null;
    }
    if (archive.status !== 'ready')
      throw new DomainError(409, 'archive_not_ready', 'The archive is not ready.');
    return {
      storageKey: archive.storage_key as string,
      handle: openFile ? await open(filePath(archive.storage_key), 'r') : undefined,
      originalName: `${archiveName(archive.lecture_name)}.zip`,
      mediaType: 'application/zip' as const,
      byteCount: Number(archive.byte_count)
    };
  });
  if (!result)
    throw new DomainError(
      410,
      'archive_invalidated',
      'Archive expired or its access or publication changed. Request a new archive.'
    );
  return result;
}

export async function cleanupExpiredArchives() {
  return transaction(async (client) => {
    const expired = await client.query(
      `SELECT id,storage_key FROM lecture_archive WHERE expires_at<=now() AND storage_key IS NOT NULL
       ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED`
    );
    for (const archive of expired.rows) {
      await rm(filePath(archive.storage_key), { force: true });
      await client.query(
        `UPDATE lecture_archive SET status='invalidated',storage_key=NULL,
         error='Archive expired or its access or publication changed.' WHERE id=$1`,
        [archive.id]
      );
    }
    return expired.rows.length;
  });
}
