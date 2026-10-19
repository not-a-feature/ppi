import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../src/lib/server/domain/index.js';
import { termOptions } from '../src/lib/terms.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalUrl = process.env.DATABASE_URL;
const originalUploadDir = process.env.UPLOAD_DIR;
const schema = `ppi_content_${randomUUID().replaceAll('-', '')}`;
const uploadDir = resolve('.data', schema);
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let checks: typeof import('../src/lib/server/content-checks.js');
let storage: typeof import('../src/lib/server/storage.js');
let deletion: typeof import('../src/lib/server/deletion.js');
let admin: Actor, student: Actor, lectureId: string;
const longText = Array.from({ length: 240 }, (_, i) => `concept${i}`).join(' ');

function pdfFixture(text: string) {
  const lines = text.match(/(?:\S+\s*){1,10}/g) ?? [];
  const stream =
    'BT /F1 10 Tf 40 800 Td 14 TL\n' +
    lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n') +
    '\nET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('');
  return Buffer.from(pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

async function submit(text: string | Buffer, name = 'exam.txt', metadata = true) {
  const input = {
    file: await storage.storeUpload(new File([new Uint8Array(Buffer.from(text))], name)),
    lectureIds: [lectureId],
    term: termOptions()[0].value,
    remarks: 'Synthetic analysis test.',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID(),
    ...(metadata ? { examinerName: 'Dr. Test', examDate: '2026-10-18' } : {})
  };
  const result = await domain.submitProtocol(student, input);
  const fileId = (
    await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [result.revisionId])
  ).rows[0].file_id as string;
  await domain.completeFileCheck({
    fileId,
    generation: 1,
    status: 'clean',
    detail: 'Synthetic test.'
  });
  await checks.analyzeFileContent(fileId, 1);
  return { ...result, fileId, input };
}

describe.skipIf(!testUrl)('admin automatic content checks', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.UPLOAD_DIR = uploadDir;
    db = await import('../src/lib/server/db.js');
    domain = await import('../src/lib/server/domain/index.js');
    checks = await import('../src/lib/server/content-checks.js');
    storage = await import('../src/lib/server/storage.js');
    deletion = await import('../src/lib/server/deletion.js');
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.pool.query(await readFile(`migrations/${name}`, 'utf8'));
    const actors: Actor[] = [];
    for (const email of ['zxcon01@student.uni-tuebingen.de', 'zxcon02@student.uni-tuebingen.de']) {
      const id = randomUUID();
      await db.pool.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [id, 'Synthetic check user', email]
      );
      await domain.activateAccount(id);
      actors.push({ id, email, isAdmin: false });
    }
    [admin, student] = actors;
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    admin.isAdmin = true;
    lectureId = (await domain.createLecture(admin, 'Content check tests')).id;
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    if (adminPool) {
      assert(/^ppi_content_[a-f0-9]{32}$/.test(schema));
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    }
    assert(uploadDir.startsWith(resolve('.data') + sep));
    await rm(uploadDir, { recursive: true, force: true });
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
  });

  it('finds byte duplicates, formatting-only copies and high similarity without flagging unrelated text or changing decisions', async () => {
    const base = await submit(longText);
    const copy = await submit(longText, 'copy.txt');
    let report = await checks.getContentChecks(admin, copy.submissionId);
    expect(report.duplicates).toContainEqual(
      expect.objectContaining({ id: base.submissionId, sameSubmission: false })
    );
    expect(report.similar).toContainEqual(
      expect.objectContaining({ id: base.submissionId, score: 1 })
    );
    const formatted = await submit(longText.toUpperCase().replaceAll(' ', '\n\n'));
    report = await checks.getContentChecks(admin, formatted.submissionId);
    expect(report.duplicates).toEqual([]);
    expect(report.similar.some((m) => m.id === base.submissionId && m.score === 1)).toBe(true);
    const near = await submit(longText.replace('concept120', 'changed'));
    report = await checks.getContentChecks(admin, near.submissionId);
    expect(report.similar.find((m) => m.id === base.submissionId)?.score).toBeGreaterThan(0.9);
    expect(
      (await checks.getContentChecks(admin, base.submissionId)).similar.some(
        (m) => m.id === near.submissionId
      )
    ).toBe(true);
    const unrelated = await submit(
      Array.from({ length: 240 }, (_, i) => `unrelated${i}`).join(' ')
    );
    expect((await checks.getContentChecks(admin, unrelated.submissionId)).similar).toEqual([]);
    expect((await domain.getSubmission(admin, near.submissionId)).review_state).toBe(
      'awaiting_review'
    );
    expect((await domain.getCreditsDashboard(student)).balance).toBe(5);
  });

  it('counts short content, repetition and legacy missing metadata', async () => {
    const short = await submit('A short exam protocol.', 'short.txt', false);
    const report = await checks.getContentChecks(admin, short.submissionId);
    expect(report).toMatchObject({
      state: 'ready',
      wordCount: 4,
      missingMetadata: ['examiner', 'date']
    });
    const repeated = await submit('Repeated answer with no detail. '.repeat(100));
    expect(
      (await checks.getContentChecks(admin, repeated.submissionId)).repeatedFraction
    ).toBeGreaterThan(0.95);
  });

  it('extracts real PDF text and distinguishes textless pages and failed extraction from an empty TXT', async () => {
    const pdf = await submit(pdfFixture(longText), 'protocol.pdf');
    expect(await checks.getContentChecks(admin, pdf.submissionId)).toMatchObject({
      state: 'ready',
      wordCount: 240,
      pageCount: 1,
      textlessPages: 0
    });
    const blank = await submit(pdfFixture(''), 'scan-without-text.pdf');
    expect(await checks.getContentChecks(admin, blank.submissionId)).toMatchObject({
      state: 'ready',
      ocrStatus: 'skipped',
      wordCount: 0,
      pageCount: 1,
      textlessPages: 1
    });
    const empty = await submit('   \n\t', 'empty.txt');
    expect(await checks.getContentChecks(admin, empty.submissionId)).toMatchObject({
      state: 'ready',
      wordCount: 0,
      pageCount: null,
      textlessPages: 0
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = await submit('%PDF-1.4\nbroken', 'unreadable.pdf');
      expect(await checks.getContentChecks(admin, broken.submissionId)).toMatchObject({
        state: 'unavailable',
        reason: 'extraction_failed'
      });
    } finally {
      log.mockRestore();
    }
  });

  it('labels earlier versions, prevents student access, and ignores stale generations and deleted content', async () => {
    const first = await submit('A distinct short protocol version for this test.');
    const input = {
      ...first.input,
      file: await storage.storeUpload(
        new File(['A distinct short protocol version for this test.'], 'improvement.txt')
      ),
      requestKey: randomUUID()
    };
    const improved = await domain.reviseProtocol(student, first.submissionId, input);
    const fileId = (
      await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [
        improved.revisionId
      ])
    ).rows[0].file_id;
    await domain.completeFileCheck({ fileId, generation: 1, status: 'clean', detail: 'Test' });
    await checks.analyzeFileContent(fileId, 1);
    expect((await checks.getContentChecks(admin, first.submissionId)).duplicates).toContainEqual(
      expect.objectContaining({ id: first.submissionId, sameSubmission: true, revision: 1 })
    );
    await expect(
      checks.getContentChecks({ ...student, isAdmin: true }, first.submissionId)
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(checks.requestContentCheck(student, first.submissionId)).rejects.toMatchObject({
      code: 'admin_required'
    });
    await domain.reprocessFile(admin, first.submissionId);
    expect((await checks.getContentChecks(admin, first.submissionId)).state).toBe('waiting');
    await checks.analyzeFileContent(fileId, 1);
    await domain.completeFileCheck({ fileId, generation: 2, status: 'clean', detail: 'Test' });
    expect((await checks.getContentChecks(admin, first.submissionId)).state).toBe('pending');
    await checks.analyzeFileContent(fileId, 2);
    await checks.requestContentCheck(admin, first.submissionId);
    expect((await checks.getContentChecks(admin, first.submissionId)).state).toBe('pending');
    await checks.analyzeFileContent(fileId, 2);
    const state = await domain.getSubmission(admin, first.submissionId);
    await deletion.requestProtocolFileDeletion(admin, {
      submissionId: first.submissionId,
      expectedVersion: state.version,
      reason: 'Remove synthetic test.'
    });
    await checks.analyzeFileContent(fileId, 2);
    expect(
      (
        await db.pool.query('SELECT count(*)::int n FROM file_content_check WHERE file_id=$1', [
          fileId
        ])
      ).rows[0].n
    ).toBe(0);
    await expect(checks.getContentChecks(admin, first.submissionId)).rejects.toMatchObject({
      code: 'not_found'
    });
  });
});
