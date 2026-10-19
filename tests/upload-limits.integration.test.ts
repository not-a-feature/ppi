import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { termOptions } from '../src/lib/terms.js';
import { MAX_FILE_BYTES } from '../src/lib/file-limits.js';
import type { Actor, StoredFileInput, SubmissionInput } from '../src/lib/server/domain/index.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalUploadDir = process.env.UPLOAD_DIR;
const schema = `ppi_upload_limits_${randomUUID().replaceAll('-', '')}`;
let root: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let storage: typeof import('../src/lib/server/storage.js');
let directory: string;
let lectureId: string;
let number = 0;

async function student(): Promise<Actor> {
  number++;
  const id = randomUUID();
  const email = `zxquo${String(number).padStart(2, '0')}@student.uni-tuebingen.de`;
  await db.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    id,
    'Synthetic quota student',
    email
  ]);
  await domain.activateAccount(id);
  return { id, email, isAdmin: false };
}

function input(file: StoredFileInput): SubmissionInput {
  return {
    file,
    lectureIds: [lectureId],
    examinerName: 'Dr. Synthetic Quota',
    examDate: '2026-10-18',
    term: termOptions()[0].value,
    remarks: '',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  };
}

describe.skipIf(!testUrl)('per-account upload resource limits', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert.equal(url.pathname, '/ppi_test');
    assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    root = new pg.Pool({ connectionString: testUrl });
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    directory = await mkdtemp(join(tmpdir(), 'ppi-upload-limits-'));
    process.env.UPLOAD_DIR = directory;
    db = await import('../src/lib/server/db.js');
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort())
      await db.pool.query(await readFile(`migrations/${name}`, 'utf8'));
    domain = await import('../src/lib/server/domain/index.js');
    storage = await import('../src/lib/server/storage.js');
    const admin = await student();
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    lectureId = (await domain.createLecture({ ...admin, isAdmin: true }, 'Quota test lecture')).id;
  });

  beforeEach(() => {
    vi.stubEnv('UPLOADS_PER_HOUR', '30');
    vi.stubEnv('UPLOAD_PENDING_LIMIT', '100');
    vi.stubEnv('UPLOAD_STORAGE_MIB', '256');
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await db?.pool.end();
    if (root) {
      assert(/^ppi_upload_limits_[a-f0-9]{32}$/.test(schema));
      await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root.end();
    }
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
  });

  it('counts improvements and deleted recent uploads and rejects before writing another file', async () => {
    vi.stubEnv('UPLOADS_PER_HOUR', '2');
    const actor = await student();
    const first = await storage.storeUpload(new File(['First protocol.'], 'first.txt'), actor.id);
    const submitted = await domain.submitProtocol(actor, input(first));
    const improvement = await storage.storeUpload(
      new File(['An improved protocol.'], 'improved.txt'),
      actor.id
    );
    await domain.reviseProtocol(actor, submitted.submissionId, input(improvement));
    await db.pool.query('UPDATE stored_file SET deleted_at=now() WHERE storage_key=$1', [
      first.storageKey
    ]);
    const before = (await readdir(directory)).sort();
    await expect(
      storage.storeUpload(new File(['One more protocol.'], 'excess.txt'), actor.id)
    ).rejects.toMatchObject({ status: 429, code: 'upload_rate_limit' });
    expect((await readdir(directory)).sort()).toEqual(before);
    expect((await domain.getSubmission(actor, submitted.submissionId)).revisions).toHaveLength(2);
  });

  it('accepts exactly 30 MiB through storage, submission validation and the database constraint', async () => {
    const actor = await student();
    const bytes = Buffer.alloc(MAX_FILE_BYTES, 0x20);
    bytes.write('%PDF-1.7\n');
    const stored = await storage.storeUpload(new File([bytes], 'thirty-mib.pdf'), actor.id);
    expect(stored.byteCount).toBe(30 * 1024 * 1024);
    const submitted = await domain.submitProtocol(actor, input(stored));
    const saved = await db.pool.query(
      `SELECT f.id,f.byte_count FROM stored_file f JOIN submission_revision r ON r.file_id=f.id WHERE r.id=$1`,
      [submitted.revisionId]
    );
    expect(saved.rows[0].byte_count).toBe(MAX_FILE_BYTES);
    await expect(
      domain.submitProtocol(
        actor,
        input({ ...stored, storageKey: randomUUID(), byteCount: MAX_FILE_BYTES + 1 })
      )
    ).rejects.toMatchObject({ status: 400, code: 'invalid_file' });
    await expect(
      db.pool.query('UPDATE stored_file SET byte_count=$2 WHERE id=$1', [
        saved.rows[0].id,
        MAX_FILE_BYTES + 1
      ])
    ).rejects.toMatchObject({ code: '23514', constraint: 'stored_file_byte_count_check' });
    const oversized = new File(['Not read.'], 'oversized.pdf');
    vi.spyOn(oversized, 'size', 'get').mockReturnValue(MAX_FILE_BYTES + 1);
    const readBytes = vi.spyOn(oversized, 'arrayBuffer');
    const before = (await readdir(directory)).sort();
    await expect(storage.storeUpload(oversized, actor.id)).rejects.toMatchObject({
      status: 400,
      code: 'file_size',
      message: 'Die Datei darf höchstens 30 MiB groß sein.'
    });
    expect(readBytes).not.toHaveBeenCalled();
    expect((await readdir(directory)).sort()).toEqual(before);
  });

  it('serializes concurrent submissions so one pending slot cannot admit two files', async () => {
    vi.stubEnv('UPLOAD_PENDING_LIMIT', '1');
    const actor = await student();
    const files = await Promise.all([
      storage.storeUpload(new File(['First concurrent protocol.'], 'one.txt'), actor.id),
      storage.storeUpload(new File(['Second concurrent protocol.'], 'two.txt'), actor.id)
    ]);
    const results = await Promise.allSettled(
      files.map((file) => domain.submitProtocol(actor, input(file)))
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert(rejected?.status === 'rejected');
    expect(rejected.reason).toMatchObject({ status: 429, code: 'upload_pending_limit' });
    expect(
      (
        await db.pool.query('SELECT count(*)::integer n FROM submission WHERE uploader_id=$1', [
          actor.id
        ])
      ).rows[0].n
    ).toBe(1);
    await Promise.all(files.map((file) => storage.cleanupUnreferencedUpload(file.storageKey)));
    for (const result of results)
      if (result.status === 'fulfilled')
        expect(
          (await domain.getSubmission(actor, result.value.submissionId)).revisions
        ).toHaveLength(1);
  });

  it('counts retained original and OCR bytes across generations without charging another account', async () => {
    vi.stubEnv('UPLOAD_STORAGE_MIB', '1');
    const actor = await student();
    const original = Buffer.alloc(300 * 1024, 0x20);
    original.write('%PDF-1.7\n');
    const stored = await storage.storeUpload(new File([original], 'original.pdf'), actor.id);
    const submitted = await domain.submitProtocol(actor, input(stored));
    const fileId = (await domain.getSubmission(actor, submitted.submissionId)).revisions[0].file_id;
    for (const [generation, size] of [
      [1, 450 * 1024],
      [2, 250 * 1024]
    ]) {
      const key = randomUUID();
      const bytes = Buffer.alloc(size, 0x20);
      await writeFile(storage.filePath(key), bytes, { flag: 'wx' });
      await db.pool.query(
        `INSERT INTO pdf_derivative(file_id,generation,status,storage_key,sha256,byte_count)
         VALUES($1,$2,'ready',$3,$4,$5)`,
        [fileId, generation, key, createHash('sha256').update(bytes).digest('hex'), bytes.length]
      );
    }
    const before = (await readdir(directory)).sort();
    await expect(
      storage.storeUpload(new File([Buffer.alloc(50 * 1024, 0x20)], 'excess.txt'), actor.id)
    ).rejects.toMatchObject({ status: 429, code: 'upload_storage_limit' });
    expect((await readdir(directory)).sort()).toEqual(before);
    const other = await student();
    const allowed = await storage.storeUpload(new File(['Other account.'], 'other.txt'), other.id);
    await storage.cleanupUnreferencedUpload(allowed.storageKey);
    await db.pool.query('UPDATE stored_file SET deleted_at=now() WHERE id=$1', [fileId]);
    const afterDeletion = await storage.storeUpload(
      new File([Buffer.alloc(50 * 1024, 0x20)], 'after-deletion.txt'),
      actor.id
    );
    await storage.cleanupUnreferencedUpload(afterDeletion.storageKey);
  });
});
