import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { termOptions } from '../src/lib/terms.js';
import type { Actor } from '../src/lib/server/domain/index.js';

const fixtures = process.env.REAL_OCR_OUTPUT;
const schema = `ppi_ocr_${randomUUID().replaceAll('-', '')}`;
const directory = resolve(fixtures ?? '.data', schema);
let root: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let storage: typeof import('../src/lib/server/storage.js');
let checks: typeof import('../src/lib/server/content-checks.js');
let ocr: typeof import('../src/lib/server/pdf-processing.js');
let delivery: typeof import('../src/lib/server/download-delivery.js');
let deletion: typeof import('../src/lib/server/deletion.js');
let extract: typeof import('../src/lib/server/document-text.js');
let admin: Actor, student: Actor, other: Actor, lectureId: string;

async function submit(bytes: Uint8Array, filename: string) {
  const stored = await storage.storeUpload(new File([Uint8Array.from(bytes)], filename));
  const result = await domain.submitProtocol(student, {
    file: stored,
    lectureIds: [lectureId],
    term: termOptions()[0].value,
    examinerName: 'Dr. Synthetic',
    examDate: '2026-10-18',
    remarks: '',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  });
  const current = await domain.getSubmission(admin, result.submissionId);
  const fileId = current.revisions[0].file_id;
  await domain.completeFileCheck({
    fileId,
    generation: 1,
    status: 'clean',
    detail: 'Synthetic fixture.'
  });
  await checks.analyzeFileContent(fileId, 1);
  return { ...result, fileId, stored };
}

describe.skipIf(!fixtures)('real OCR and personal PDF delivery', () => {
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.equal(url.pathname, '/ppi_test');
    assert(['localhost', '127.0.0.1', 'db'].includes(url.hostname));
    root = new pg.Pool({ connectionString: url.toString() });
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.UPLOAD_DIR = directory;
    db = await import('../src/lib/server/db.js');
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.pool.query(await readFile(`migrations/${name}`, 'utf8'));
    domain = await import('../src/lib/server/domain/index.js');
    storage = await import('../src/lib/server/storage.js');
    checks = await import('../src/lib/server/content-checks.js');
    ocr = await import('../src/lib/server/pdf-processing.js');
    delivery = await import('../src/lib/server/download-delivery.js');
    deletion = await import('../src/lib/server/deletion.js');
    extract = await import('../src/lib/server/document-text.js');
    const actors: Actor[] = [];
    for (const zx of ['zxocr01', 'zxocr02', 'zxocr03']) {
      const id = randomUUID(),
        email = `${zx}@student.uni-tuebingen.de`;
      await db.pool.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [id, 'Synthetic OCR user', email]
      );
      await domain.activateAccount(id);
      actors.push({ id, email, isAdmin: false });
    }
    [admin, student, other] = actors;
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    admin.isAdmin = true;
    lectureId = (await domain.createLecture(admin, 'Synthetic OCR benchmark')).id;
  });
  afterAll(async () => {
    await db?.pool.end();
    if (root) {
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
    assert(directory.startsWith(resolve(fixtures ?? '.data') + sep));
    await rm(directory, { recursive: true, force: true });
  });

  it('adds searchable text, preserves originals, isolates watermarks, and removes OCR bytes on deletion', async () => {
    const timings: Record<string, number> = {};
    for (const [name, expectedPages] of [
      ['scanned-1page.pdf', 1],
      ['scanned-3pages.pdf', 3],
      ['mixed.pdf', 2]
    ] as const) {
      const bytes = await readFile(resolve('tests/fixtures/ocr', name));
      const start = performance.now();
      const file = await submit(bytes, name);
      timings[`${name}:analysis_ms`] = performance.now() - start;
      expect((await checks.getContentChecks(admin, file.submissionId)).ocrStatus).toBe('pending');
      const begin = performance.now();
      await Promise.all([ocr.processPdfOcr(file.fileId, 1), ocr.processPdfOcr(file.fileId, 1)]);
      timings[`${name}:ocr_ms`] = performance.now() - begin;
      expect(db.pool.totalCount).toBe(db.pool.idleCount);
      await checks.analyzeFileContent(file.fileId, 1);
      expect(await checks.getContentChecks(admin, file.submissionId)).toMatchObject({
        state: 'ready',
        ocrStatus: 'ready',
        pageCount: expectedPages
      });
      const row = (
        await db.pool.query('SELECT * FROM pdf_derivative WHERE file_id=$1', [file.fileId])
      ).rows[0];
      const searchable = await readFile(storage.filePath(row.storage_key));
      const text = await extract.extractDocumentText(searchable, 'application/pdf');
      expect(text.text).toContain('Quicksort');
      expect(text.pageWordCounts[0]).toBeGreaterThan(150);
      if (name === 'mixed.pdf')
        expect(text.text).toContain('Original digital text remains searchable');
      expect(
        createHash('sha256')
          .update(await readFile(storage.filePath(file.stored.storageKey)))
          .digest('hex')
      ).toBe(file.stored.sha256);
      expect(await readFile(storage.filePath(file.stored.storageKey))).toEqual(bytes);
      await ocr.processPdfOcr(file.fileId, 1);
      expect(
        (
          await db.pool.query('SELECT storage_key FROM pdf_derivative WHERE file_id=$1', [
            file.fileId
          ])
        ).rows[0].storage_key
      ).toBe(row.storage_key);
      const source = {
        fileId: file.fileId,
        generation: 1,
        storageKey: file.stored.storageKey,
        sha256: file.stored.sha256,
        mediaType: 'application/pdf' as const
      };
      const cold = performance.now();
      const first = await delivery.getDeliveryBytes(source, student, { preview: true });
      timings[`${name}:watermark_cold_ms`] = performance.now() - cold;
      const warm = performance.now();
      await Promise.all(
        Array.from({ length: 100 }, () => delivery.getDeliveryBytes(source, student))
      );
      timings[`${name}:watermark_100_cached_ms`] = performance.now() - warm;
      const otherBytes = await delivery.getDeliveryBytes(source, other);
      expect((await extract.extractDocumentText(first, 'application/pdf')).text).toContain(
        'PPI - zxocr02'
      );
      const otherText = (await extract.extractDocumentText(otherBytes, 'application/pdf')).text;
      expect(otherText).toContain('PPI - zxocr03');
      expect(otherText).not.toContain('PPI - zxocr02');
      expect(await delivery.getDeliveryBytes(source, admin, { preview: true })).toEqual(searchable);
      if (name === 'scanned-1page.pdf') {
        await writeFile(resolve(fixtures!, 'searchable.pdf'), searchable);
        await writeFile(resolve(fixtures!, 'watermarked.pdf'), first);
        const alreadySearchable = await submit(searchable, 'already-ocr.pdf');
        expect(
          (await checks.getContentChecks(admin, alreadySearchable.submissionId)).ocrStatus
        ).toBe('skipped');
        expect(
          (
            await db.pool.query(
              "SELECT 1 FROM core_job WHERE type='pdf_ocr' AND payload->>'fileId'=$1",
              [alreadySearchable.fileId]
            )
          ).rowCount
        ).toBe(0);
      }
      const current = await domain.getSubmission(admin, file.submissionId);
      await deletion.requestProtocolFileDeletion(admin, {
        submissionId: file.submissionId,
        expectedVersion: current.version,
        reason: 'Synthetic OCR deletion test.'
      });
      await deletion.cleanupDeletedProtocolFiles(file.submissionId);
      await expect(readFile(storage.filePath(row.storage_key))).rejects.toMatchObject({
        code: 'ENOENT'
      });
      await ocr.processPdfOcr(file.fileId, 1);
      expect(
        (
          await db.pool.query('SELECT storage_key FROM pdf_derivative WHERE file_id=$1', [
            file.fileId
          ])
        ).rows[0].storage_key
      ).toBeNull();
    }
    const digital = await PDFDocument.create(),
      font = await digital.embedFont(StandardFonts.Helvetica);
    digital.addPage().drawText('Fully digital PDF. No OCR processing needed.', { font, size: 12 });
    const start = performance.now();
    const file = await submit(await digital.save(), 'digital.pdf');
    timings.digital_analysis_ms = performance.now() - start;
    expect((await checks.getContentChecks(admin, file.submissionId)).ocrStatus).toBe('skipped');
    expect(
      (
        await db.pool.query(
          "SELECT 1 FROM core_job WHERE type='pdf_ocr' AND payload->>'fileId'=$1",
          [file.fileId]
        )
      ).rowCount
    ).toBe(0);
    await writeFile(resolve(fixtures!, 'benchmark.json'), JSON.stringify(timings, null, 2));
    console.log('OCR_BENCHMARK', JSON.stringify(timings));
  }, 180000);

  it('keeps admin notes private and rejects concurrent edits', async () => {
    const before = (await domain.listAdminUsersPage(admin, { search: student.email })).entries[0];
    await domain.setUserNote(admin, student.id, 'Private synthetic note', before.note_version);
    await expect(
      domain.setUserNote(
        { ...student, isAdmin: true },
        student.id,
        'Not allowed',
        before.note_version + 1
      )
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(domain.listAdminUsersPage(student)).rejects.toMatchObject({
      code: 'admin_required'
    });
    await expect(
      domain.setUserNote(admin, student.id, 'Stale edit', before.note_version)
    ).rejects.toMatchObject({ status: 409 });
    const current = (await domain.listAdminUsersPage(admin, { search: student.email })).entries[0];
    expect(current.admin_note).toBe('Private synthetic note');
    expect(JSON.stringify(await domain.getCreditsDashboard(student))).not.toContain(
      'Private synthetic note'
    );
    expect(
      JSON.stringify(
        (await db.pool.query("SELECT detail FROM audit_event WHERE action='user.note_updated'"))
          .rows
      )
    ).not.toContain('Private synthetic note');
    await domain.setUserNote(admin, student.id, '', current.note_version);
  });
});
