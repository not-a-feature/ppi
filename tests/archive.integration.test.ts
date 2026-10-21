import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';
import type { Actor } from '../src/lib/server/domain/index.js';
import { termOptions } from '../src/lib/terms.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL,
  originalUploadDir = process.env.UPLOAD_DIR;
const schema = `ppi_archive_${randomUUID().replaceAll('-', '')}`;
const uploadDir = resolve('.data', schema);
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let archives: typeof import('../src/lib/server/archives.js');
let storage: typeof import('../src/lib/server/storage.js');
let admin: Actor, student: Actor, other: Actor, lectureId: string;

function archiveMembers(bytes: Buffer) {
  const members: Record<string, string> = {};
  let offset = bytes.readUInt32LE(bytes.length - 6);
  for (let entry = 0; entry < bytes.readUInt16LE(bytes.length - 12); entry++) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    members[name] = inflateRawSync(
      bytes.subarray(start, start + bytes.readUInt32LE(offset + 20))
    ).toString('utf8');
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return members;
}

async function createStudent(zx: string): Promise<Actor> {
  const id = randomUUID(),
    email = `${zx}@student.uni-tuebingen.de`;
  await db.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    id,
    'Archive dummy',
    email
  ]);
  await domain.activateAccount(id);
  return { id, email, isAdmin: false };
}
async function publishFile(name: string) {
  const storageKey = randomUUID(),
    bytes = Buffer.from(`Dummy archive protocol ${randomUUID()}`);
  await writeFile(storage.filePath(storageKey), bytes);
  const submitted = await domain.submitProtocol(student, {
    file: {
      storageKey,
      byteCount: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType: 'text/plain',
      originalName: name
    },
    lectureIds: [lectureId],
    term: termOptions()[0].value,
    examinerName: 'Archive Examiner',
    examDate: '2026-05-18',
    remarks: 'Archive fixture.',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  });
  const submission = await domain.getSubmission(student, submitted.submissionId);
  await domain.completeFileCheck({
    fileId: submission.revisions[0].file_id,
    generation: 1,
    status: 'clean',
    detail: 'Dummy test file.'
  });
  const ready = await domain.getSubmission(student, submitted.submissionId);
  await domain.decideSubmission(admin, {
    revisionId: submitted.revisionId,
    expectedVersion: ready.version,
    outcome: 'accepted',
    publicFeedback: 'Dummy protocol accepted.',
    reward: 'none',
    requestKey: randomUUID()
  });
  return submitted;
}
describe.skipIf(!testUrl)('private lecture archives', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.UPLOAD_DIR = uploadDir;
    db = await import('../src/lib/server/db.js');
    domain = await import('../src/lib/server/domain/index.js');
    archives = await import('../src/lib/server/archives.js');
    storage = await import('../src/lib/server/storage.js');
    for (const migration of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await db.pool.query(
        await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8')
      );
    await mkdir(uploadDir, { recursive: true });
    admin = await createStudent('zxadm01');
    student = await createStudent('zxabc01');
    other = await createStudent('zxabc02');
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    admin.isAdmin = true;
    lectureId = (await domain.createLecture(admin, 'Archive test lecture')).id;
    await domain.purchaseLectureAccess(student, lectureId, randomUUID());
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    if (adminPool) {
      assert(/^ppi_archive_[a-f0-9]{32}$/.test(schema));
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    }
    assert(uploadDir.startsWith(resolve('.data') + sep));
    await rm(uploadDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
  });
  it('prepares the exact published safe files, remains idempotent and restricts downloads to the requester', async () => {
    await publishFile('../dummy-a.txt');
    await publishFile('dummy-b.txt');
    const request = await archives.requestArchive(student, lectureId);
    expect(
      (await db.pool.query("SELECT payload FROM core_job WHERE type='prepare_archive'")).rows.some(
        (row) => row.payload.archiveId === request.id
      )
    ).toBe(true);
    await expect(archives.getArchiveDownload(student, request.id)).rejects.toMatchObject({
      code: 'archive_not_ready'
    });
    expect(await archives.prepareArchive(request.id)).toEqual({ id: request.id, status: 'ready' });
    const download = await archives.getArchiveDownload(student, request.id),
      bytes = await readFile(storage.filePath(download.storageKey));
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(download.byteCount).toBe(bytes.length);
    expect(bytes.readUInt16LE(bytes.length - 12)).toBe(3);
    expect(download.originalName).toBe('Archive test lecture.zip');
    expect(bytes.includes(Buffer.from('../dummy-a.txt'))).toBe(false);
    const directoryOffset = bytes.readUInt32LE(bytes.length - 6);
    expect(bytes.readUInt32LE(directoryOffset)).toBe(0x02014b50);
    const members = archiveMembers(bytes);
    const member = Object.values(members)[0];
    expect(member).toMatch(/^PPI - zxabc01 - \d{2}\.\d{2}\.\d{4}\n\nDummy archive protocol/);
    expect(member).not.toContain('zxabc02');
    const index = JSON.parse(members['index.json']);
    expect(index).toHaveLength(2);
    for (const entry of index) {
      expect(entry).toMatchObject({
        lectures: ['Archive test lecture'],
        examiners: ['Archive Examiner'],
        semester: termOptions()[0].value,
        exam_date: '2026-05-18'
      });
      expect(entry.number).toMatch(/^\d+$/);
      expect(entry.uploaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Object.hasOwn(members, entry.filename)).toBe(true);
    }
    expect((await archives.getArchive(student, request.id)).file_count).toBe(2);
    expect(await archives.getLectureArchive(student, lectureId, 2)).toMatchObject({
      id: request.id,
      status: 'ready'
    });
    expect(await archives.getLectureArchive(other, lectureId, 2)).toBeNull();
    await expect(archives.getArchive(other, request.id)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect(await archives.prepareArchive(request.id)).toEqual({ id: request.id, status: 'ready' });
    expect((await archives.getArchiveDownload(student, request.id)).storageKey).toBe(
      download.storageKey
    );
    await expect(archives.getArchiveDownload(other, request.id)).rejects.toMatchObject({
      code: 'not_found'
    });
    await expect(archives.requestArchive(other, lectureId)).rejects.toMatchObject({
      code: 'lecture_access_required'
    });
  });
  it('rebuilds queued and ready ZIP indexes when any assigned lecture is renamed', async () => {
    const shared = await domain.createLecture(admin, 'Shared archive lecture');
    const revisionId = (
      await db.pool.query('SELECT published_revision_id FROM submission ORDER BY id LIMIT 1')
    ).rows[0].published_revision_id;
    await db.pool.query('INSERT INTO revision_lecture VALUES($1,$2)', [revisionId, shared.id]);
    await domain.purchaseLectureAccess(other, lectureId, randomUUID());
    await domain.purchaseLectureAccess(student, shared.id, randomUUID());
    const ready = await archives.requestArchive(other, lectureId);
    await archives.prepareArchive(ready.id);
    const queued = await archives.requestArchive(student, shared.id);
    const current = await domain.getLecture(admin, shared.id);
    const renamed = await domain.updateLecture(admin, shared.id, current.version, {
      name: 'Renamed archive lecture',
      aliases: []
    });
    for (const [actor, archive] of [
      [other, ready],
      [student, queued]
    ] as const)
      expect((await archives.getArchive(actor, archive.id)).status).toBe('invalidated');
    const replacement = await archives.requestArchive(other, lectureId);
    expect(replacement.id).not.toBe(ready.id);
    await archives.prepareArchive(replacement.id);
    const download = await archives.getArchiveDownload(other, replacement.id);
    const index = JSON.parse(
      archiveMembers(await readFile(storage.filePath(download.storageKey)))['index.json']
    );
    expect(
      index.find((entry: { lectures: string[] }) => entry.lectures.includes(renamed.name))
    ).toBeTruthy();
    expect(JSON.stringify(index)).not.toContain('Shared archive lecture');
    await domain.updateLecture(admin, shared.id, renamed.version, {
      name: renamed.name,
      aliases: ['New alias']
    });
    expect((await archives.getArchive(other, replacement.id)).status).toBe('ready');
  });
  it('reuses queued and ready archives under concurrent requests and preserves the original expiry', async () => {
    const requests = await Promise.all(
      Array.from({ length: 6 }, () => archives.requestArchive(student, lectureId))
    );
    expect(new Set(requests.map((item) => item.id)).size).toBe(1);
    const request = requests[0];
    expect(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) FROM core_job WHERE type='prepare_archive' AND payload->>'archiveId'=$1",
            [request.id]
          )
        ).rows[0].count
      )
    ).toBe(1);
    await archives.prepareArchive(request.id);
    const again = await archives.requestArchive(student, lectureId);
    expect(again).toMatchObject({ id: request.id, status: 'ready', expiresAt: request.expiresAt });
    await publishFile('new-revision-set.txt');
    expect(await archives.getLectureArchive(student, lectureId, 3)).toBeNull();
    expect((await archives.requestArchive(student, lectureId)).id).not.toBe(request.id);
  });

  it.each(['expiry', 'deletion', 'date'])(
    'serves status during ZIP work, excludes another builder, and rechecks %s',
    async (change) => {
      const protocol = await publishFile('paused-build.txt');
      const request = await archives.requestArchive(student, lectureId);
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const originalEnd = ZipFile.prototype.end;
      const end = vi.spyOn(ZipFile.prototype, 'end').mockImplementationOnce(function (
        this: ZipFile,
        ...args
      ) {
        entered.resolve();
        void resume.promise.then(() => originalEnd.apply(this, args));
      });
      const build = archives.prepareArchive(request.id);
      try {
        await entered.promise;
        expect(db.pool.totalCount).toBe(db.pool.idleCount);
        const deadline = Promise.withResolvers<never>();
        const timer = setTimeout(
          () => deadline.reject(new Error('Archive status blocked during ZIP work.')),
          2000
        );
        try {
          expect(
            (await Promise.race([archives.getArchive(student, request.id), deadline.promise]))
              .status
          ).toBe('queued');
        } finally {
          clearTimeout(timer);
        }
        await expect(archives.prepareArchive(request.id)).rejects.toMatchObject({
          code: 'archive_busy'
        });
        expect((await archives.getArchive(student, request.id)).status).toBe('queued');
        if (change === 'expiry') {
          await db.pool.query(
            "UPDATE lecture_archive SET expires_at=now()-interval '1 second' WHERE id=$1",
            [request.id]
          );
        } else if (change === 'date') {
          await db.pool.query(
            "UPDATE lecture_archive SET created_at=now()-interval '1 day' WHERE id=$1",
            [request.id]
          );
        } else {
          const deletion = await import('../src/lib/server/deletion.js');
          const current = await domain.getSubmission(admin, protocol.submissionId);
          await deletion.requestProtocolFileDeletion(admin, {
            submissionId: protocol.submissionId,
            expectedVersion: current.version,
            reason: 'Deletion while archive compression is paused.'
          });
        }
        expect((await archives.getArchive(student, request.id)).status).toBe('invalidated');
      } finally {
        resume.resolve();
        end.mockRestore();
        expect(await build).toEqual({ id: request.id, status: 'invalidated' });
      }
      expect(
        (await db.pool.query('SELECT storage_key FROM lecture_archive WHERE id=$1', [request.id]))
          .rows[0].storage_key
      ).toBe(null);
    }
  );

  it('removes expired ZIP bytes while preserving metadata and source files, and skips a locked preparation', async () => {
    const request = await archives.requestArchive(student, lectureId);
    await archives.prepareArchive(request.id);
    const download = await archives.getArchiveDownload(student, request.id, true);
    const before = (
      await db.pool.query('SELECT revision_ids FROM lecture_archive WHERE id=$1', [request.id])
    ).rows[0];
    const source = (
      await db.pool.query('SELECT storage_key FROM stored_file WHERE deleted_at IS NULL LIMIT 1')
    ).rows[0].storage_key;
    const sourceBytes = await readFile(storage.filePath(source));
    const worker = await db.pool.connect();
    await db.pool.query(
      "UPDATE lecture_archive SET expires_at=now()-interval '1 second' WHERE id=$1",
      [request.id]
    );
    await worker.query('BEGIN');
    try {
      await worker.query('SELECT id FROM lecture_archive WHERE id=$1 FOR UPDATE', [request.id]);
      await archives.cleanupExpiredArchives();
      expect((await readFile(storage.filePath(download.storageKey))).length).toBeGreaterThan(0);
    } finally {
      await worker.query('ROLLBACK');
      worker.release();
    }
    await archives.cleanupExpiredArchives();
    expect(
      await archives.getLectureArchive(student, lectureId, before.revision_ids.length)
    ).toBeNull();
    expect((await download.handle!.readFile()).length).toBe(download.byteCount);
    await download.handle!.close();
    await expect(readFile(storage.filePath(download.storageKey))).rejects.toMatchObject({
      code: 'ENOENT'
    });
    const row = (await db.pool.query('SELECT * FROM lecture_archive WHERE id=$1', [request.id]))
      .rows[0];
    expect(row).toMatchObject({
      id: request.id,
      status: 'invalidated',
      storage_key: null,
      revision_ids: before.revision_ids
    });
    expect(await readFile(storage.filePath(source))).toEqual(sourceBytes);
    await expect(archives.getArchiveDownload(student, request.id)).rejects.toMatchObject({
      code: 'archive_invalidated'
    });
    expect((await archives.requestArchive(student, lectureId)).id).not.toBe(request.id);
    expect(await archives.cleanupExpiredArchives()).toBe(0);
  });

  it('invalidates a completed archive after any member is withdrawn and checks expired lecture access', async () => {
    const protocol = await publishFile('withdrawal.txt'),
      request = await archives.requestArchive(student, lectureId);
    await archives.prepareArchive(request.id);
    const current = await domain.getSubmission(admin, protocol.submissionId);
    await domain.withdrawPublication(admin, {
      submissionId: protocol.submissionId,
      expectedVersion: current.version,
      expectedPublishedRevisionId: protocol.revisionId,
      reason: 'Archive invalidation test.'
    });
    await expect(archives.getArchiveDownload(student, request.id)).rejects.toMatchObject({
      code: 'archive_invalidated'
    });
    expect((await archives.getArchive(student, request.id)).status).toBe('invalidated');
    const next = await archives.requestArchive(student, lectureId);
    await archives.prepareArchive(next.id);
    await db.pool.query(
      "UPDATE lecture_access SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1 AND lecture_id=$2",
      [student.id, lectureId]
    );
    await expect(archives.requestArchive(student, lectureId)).rejects.toMatchObject({
      code: 'lecture_access_required'
    });
    await expect(archives.getArchiveDownload(student, next.id)).rejects.toMatchObject({
      code: 'archive_invalidated'
    });
    await domain.purchaseLectureAccess(student, lectureId, randomUUID());
  });
  it('fails rather than creating a partial archive when a recorded source file is missing', async () => {
    const protocol = await publishFile('missing.txt'),
      request = await archives.requestArchive(student, lectureId);
    const file = (
      await db.pool.query(
        'SELECT f.storage_key FROM submission_revision r JOIN stored_file f ON f.id=r.file_id WHERE r.id=$1',
        [protocol.revisionId]
      )
    ).rows[0];
    const originalBytes = await readFile(storage.filePath(file.storage_key));
    await rm(storage.filePath(file.storage_key));
    await expect(archives.prepareArchive(request.id)).rejects.toMatchObject({ code: 'ENOENT' });
    const archive = await archives.getArchive(student, request.id);
    expect(archive.status).toBe('failed');
    await expect(archives.getArchiveDownload(student, request.id)).rejects.toMatchObject({
      code: 'archive_not_ready'
    });
    await writeFile(storage.filePath(file.storage_key), originalBytes);
    expect(await archives.prepareArchive(request.id)).toEqual({ id: request.id, status: 'ready' });
  });
});
