import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, SubmissionInput } from '../src/lib/server/domain/index.js';
import { termOptions } from '../src/lib/terms.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const schema = `ppi_test_${randomUUID().replaceAll('-', '')}`;
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let route: typeof import('../src/routes/admin/review/[id]/+page.server.js');
let admin: Actor;
let student: Actor;
let lectureId: string;

function input(): SubmissionInput {
  return {
    file: {
      storageKey: randomUUID(),
      sha256: 'a'.repeat(64),
      byteCount: 12,
      mediaType: 'text/plain',
      originalName: 'regression.txt'
    },
    lectureIds: [lectureId],
    term: termOptions()[0].value,
    remarks: 'Moderation regression fixture.',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  };
}
async function ready() {
  const result = await domain.submitProtocol(student, input());
  const fileId = (
    await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [result.revisionId])
  ).rows[0].file_id;
  await domain.completeFileCheck({ fileId, generation: 1, status: 'clean', detail: 'Fixture' });
  await db.pool.query(
    "INSERT INTO file_content_check(file_id,generation,status) VALUES($1,1,'ready')",
    [fileId]
  );
  return {
    ...result,
    fileId,
    version: (await domain.getSubmission(admin, result.submissionId)).version
  };
}
function event(submissionId: string, values: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const entry of Array.isArray(value) ? value : [value]) body.append(key, entry);
  return {
    locals: { actor: admin, preferences: { language: 'en' } },
    params: { id: submissionId },
    request: new Request('http://localhost/admin/review/' + submissionId, { method: 'POST', body })
  };
}

describe.skipIf(!testUrl)('moderation regression transactions and actions', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../src/lib/server/db.js');
    for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await db.pool.query(
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      );
    domain = await import('../src/lib/server/domain/index.js');
    route = await import('../src/routes/admin/review/[id]/+page.server.js');
    const actors: Actor[] = [];
    for (const email of ['zxreg01@student.uni-tuebingen.de', 'zxreg02@student.uni-tuebingen.de']) {
      const id = randomUUID();
      await db.pool.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [id, 'Regression fixture', email]
      );
      await domain.activateAccount(id);
      actors.push({ id, email, isAdmin: false });
    }
    [admin, student] = actors;
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    admin.isAdmin = true;
    lectureId = (await domain.createLecture(admin, 'Moderation regression lecture')).id;
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    if (adminPool) {
      assert(/^ppi_test_[a-f0-9]{32}$/.test(schema));
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('advances in queue order, skips unavailable work, wraps, and reports an exhausted queue', async () => {
    const entries = [];
    for (let i = 0; i < 11; i++) entries.push(await ready());
    entries.sort((a, b) => a.submissionId.localeCompare(b.submissionId));
    await db.pool.query("UPDATE submission SET created_at='2026-01-01' WHERE id=ANY($1::uuid[])", [
      entries.map((entry) => entry.submissionId)
    ]);
    for (const [index, state] of [
      [2, 'changes_requested'],
      [3, 'processing'],
      [4, 'accepted'],
      [5, 'rejected']
    ] as const)
      await db.pool.query('UPDATE submission SET review_state=$2 WHERE id=$1', [
        entries[index].submissionId,
        state
      ]);
    await db.pool.query("UPDATE stored_file SET safety_status='blocked' WHERE id=$1", [
      entries[6].fileId
    ]);
    await db.pool.query('UPDATE stored_file SET deleted_at=now() WHERE id=$1', [entries[7].fileId]);
    await db.pool.query('UPDATE submission SET files_deleted_at=now() WHERE id=$1', [
      entries[8].submissionId
    ]);

    const currentId = entries[1].submissionId;
    const queue = await domain.listReviewQueuePage(admin, { includeAll: true, paginate: false });
    expect(queue.entries.map((entry) => entry.id)).toEqual(
      entries.map((entry) => entry.submissionId).reverse()
    );
    expect(queue.entries[0].lecture_ids).toEqual([lectureId]);
    expect(await domain.getNextReview(admin, currentId)).toMatchObject({
      id: entries[0].submissionId
    });
    expect(await domain.getNextReview(admin, currentId, lectureId)).toMatchObject({
      id: entries[0].submissionId
    });
    expect(await domain.getNextReview(admin, currentId, randomUUID())).toBeNull();
    await db.pool.query("UPDATE submission SET review_state='rejected' WHERE id=$1", [
      entries[0].submissionId
    ]);
    expect(await domain.getNextReview(admin, currentId)).toMatchObject({
      id: entries[10].submissionId
    });
    await db.pool.query("UPDATE submission SET review_state='rejected' WHERE id=$1", [
      entries[10].submissionId
    ]);
    expect(await domain.getNextReview(admin, currentId)).toMatchObject({
      id: entries[9].submissionId
    });
    await db.pool.query("UPDATE submission SET review_state='rejected' WHERE id=$1", [
      entries[9].submissionId
    ]);
    expect(await domain.getNextReview(admin, currentId)).toBeNull();
    await expect(domain.getNextReview(student, currentId)).rejects.toMatchObject({
      code: 'admin_required'
    });
  });

  it('preserves a stale rejection draft and requires explicit context refresh before reconfirmation', async () => {
    const submission = await ready();
    const preview = await domain.getRewardPreview(admin, submission.revisionId, 'base');
    const values = {
      revisionId: submission.revisionId,
      version: String(submission.version),
      requestKey: randomUUID(),
      outcome: 'rejected',
      publicFeedback: '  Detailed rejection retained.\r\nSecond line.  ',
      internalNote: 'Internal review detail.',
      reward: 'none',
      rewardPolicyVersion: String(preview.policyVersion),
      rewardRecipientIds: preview.recipientIds,
      confirmed: 'on'
    };
    await domain.reprocessFile(admin, submission.submissionId);
    const result = (await route.actions.decide(
      event(submission.submissionId, values) as never
    )) as any;
    expect(result.status).toBe(409);
    expect(result.data.requiresRefresh).toBe(true);
    expect(result.data.reviewSaved).not.toBe(true);
    const { confirmed, ...draft } = values;
    expect(result.data.values).toEqual(draft);
    expect(
      (await domain.getSubmission(admin, submission.submissionId)).revisions[0].decisions
    ).toHaveLength(0);
    const refreshed = (await route.actions.refreshDecision(
      event(submission.submissionId, draft) as never
    )) as any;
    expect(refreshed.requiresRefresh).toBe(false);
    expect(refreshed.values).toMatchObject({
      outcome: values.outcome,
      publicFeedback: values.publicFeedback,
      internalNote: values.internalNote,
      reward: values.reward,
      revisionId: values.revisionId
    });
    expect(Number(refreshed.values.version)).toBeGreaterThan(submission.version);
    expect(refreshed.values.requestKey).not.toBe(values.requestKey);
    const unconfirmed = (await route.actions.decide(
      event(submission.submissionId, refreshed.values) as never
    )) as any;
    expect(unconfirmed.status).toBe(400);
    const successful = await route.actions.decide(
      event(submission.submissionId, { ...refreshed.values, confirmed: 'on' }) as never
    );
    expect(successful).toMatchObject({ reviewSaved: true });
    const saved = await domain.getSubmission(admin, submission.submissionId);
    expect(saved.review_state).toBe('rejected');
    expect(saved.revisions[0].decisions[0]).toMatchObject({
      outcome: 'rejected',
      public_feedback: values.publicFeedback,
      internal_note: values.internalNote
    });
    expect(saved.rewardAllocation).toBeNull();
  });

  it('keeps the published original distinct from a rejected improvement in student contributions', async () => {
    const submitted = await ready();
    await domain.decideSubmission(admin, {
      revisionId: submitted.revisionId,
      expectedVersion: submitted.version,
      outcome: 'accepted',
      publicFeedback: 'Published original.',
      reward: 'none',
      requestKey: randomUUID()
    });
    const improvement = await domain.reviseProtocol(student, submitted.submissionId, input());
    const fileId = (
      await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [
        improvement.revisionId
      ])
    ).rows[0].file_id;
    await domain.completeFileCheck({ fileId, generation: 1, status: 'clean', detail: 'Fixture' });
    await domain.decideSubmission(admin, {
      revisionId: improvement.revisionId,
      expectedVersion: (await domain.getSubmission(admin, submitted.submissionId)).version,
      outcome: 'rejected',
      publicFeedback: 'Keep the original.',
      reward: 'none',
      requestKey: randomUUID()
    });
    const ownRow = async () =>
      (await domain.listOwnSubmissionsPage(student)).submissions.find(
        (submission) => submission.id === submitted.submissionId
      );
    expect(await ownRow()).toMatchObject({
      review_state: 'rejected',
      revision_number: 2,
      visibility: 'published',
      published_revision_id: submitted.revisionId,
      published_revision_number: 1
    });
    await db.pool.query("UPDATE submission SET visibility='withdrawn' WHERE id=$1", [
      submitted.submissionId
    ]);
    expect((await ownRow()).published_revision_number).toBeNull();
    await db.pool.query("UPDATE submission SET visibility='published' WHERE id=$1", [
      submitted.submissionId
    ]);
    await db.pool.query('UPDATE stored_file SET deleted_at=now() WHERE id=$1', [submitted.fileId]);
    expect((await ownRow()).published_revision_number).toBeNull();
  });

  it('rescans a published historical revision while an improvement is pending, ignoring stale check completions', async () => {
    const submitted = await ready();
    await domain.decideSubmission(admin, {
      revisionId: submitted.revisionId,
      expectedVersion: submitted.version,
      outcome: 'accepted',
      publicFeedback: 'Published.',
      reward: 'none',
      requestKey: randomUUID()
    });
    const improvement = await domain.reviseProtocol(student, submitted.submissionId, input());
    const scan = await domain.reprocessFile(admin, submitted.submissionId, submitted.revisionId);
    expect(scan).toEqual({ fileId: submitted.fileId, generation: 2 });
    const state = await domain.getSubmission(admin, submitted.submissionId);
    expect(state).toMatchObject({
      published_revision_id: submitted.revisionId,
      current_revision_id: improvement.revisionId,
      visibility: 'published',
      review_state: 'processing'
    });
    await expect(domain.getDownload(student, submitted.revisionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect(
      await domain.completeFileCheck({
        fileId: scan.fileId,
        generation: 1,
        status: 'clean',
        detail: 'Stale'
      })
    ).toBe(false);
    expect(
      await domain.completeFileCheck({
        fileId: scan.fileId,
        generation: 2,
        status: 'clean',
        detail: 'Current'
      })
    ).toBe(true);
    expect(
      await domain.completeFileCheck({
        fileId: scan.fileId,
        generation: 2,
        status: 'blocked',
        detail: 'Duplicate'
      })
    ).toBe(false);
    expect((await domain.getSubmission(admin, submitted.submissionId)).review_state).toBe(
      'processing'
    );
    expect(await domain.getDownload(student, submitted.revisionId)).toMatchObject({
      fileId: submitted.fileId,
      generation: 2
    });
    const jobs = (
      await db.pool.query('SELECT payload FROM core_job WHERE business_key=$1', [
        `file_check:${scan.fileId}:2`
      ])
    ).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({
      revisionId: submitted.revisionId,
      fileId: scan.fileId,
      generation: 2
    });
    const currentScan = await domain.reprocessFile(admin, submitted.submissionId);
    const currentFile = (
      await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [
        improvement.revisionId
      ])
    ).rows[0].file_id;
    expect(currentScan.fileId).toBe(currentFile);
  });

  it('serializes concurrent rescans and completions without duplicating job generations', async () => {
    const submitted = await ready();
    const scans = await Promise.all([
      domain.reprocessFile(admin, submitted.submissionId, submitted.revisionId),
      domain.reprocessFile(admin, submitted.submissionId, submitted.revisionId)
    ]);
    expect(scans.map((scan) => scan.generation).sort()).toEqual([2, 3]);
    const [scan] = await Promise.all([
      domain.reprocessFile(admin, submitted.submissionId, submitted.revisionId),
      domain.completeFileCheck({
        fileId: submitted.fileId,
        generation: 3,
        status: 'clean',
        detail: 'Concurrent completion'
      })
    ]);
    expect(scan.generation).toBe(4);
    const jobs = (
      await db.pool.query(
        "SELECT business_key FROM core_job WHERE type='file_check' AND payload->>'fileId'=$1 ORDER BY business_key",
        [submitted.fileId]
      )
    ).rows;
    expect(jobs.map((job) => job.business_key)).toEqual(
      [1, 2, 3, 4].map((generation) => `file_check:${submitted.fileId}:${generation}`)
    );
    expect(
      await domain.completeFileCheck({
        fileId: submitted.fileId,
        generation: 4,
        status: 'clean',
        detail: 'Latest completion'
      })
    ).toBe(true);
  });

  it('rejects unauthorized, unrelated and deleted revision rescans without queuing work', async () => {
    const first = await ready(),
      second = await ready();
    await expect(
      domain.reprocessFile({ ...student, isAdmin: true }, first.submissionId, first.revisionId)
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(
      domain.reprocessFile(admin, first.submissionId, second.revisionId)
    ).rejects.toMatchObject({ code: 'not_found' });
    await db.pool.query('UPDATE stored_file SET deleted_at=now() WHERE id=$1', [first.fileId]);
    await expect(
      domain.reprocessFile(admin, first.submissionId, first.revisionId)
    ).rejects.toMatchObject({ code: 'files_deleted' });
    await db.pool.query('UPDATE submission SET files_deleted_at=now() WHERE id=$1', [
      second.submissionId
    ]);
    await expect(
      domain.reprocessFile(admin, second.submissionId, second.revisionId)
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (
        await db.pool.query('SELECT safety_generation FROM stored_file WHERE id=ANY($1::uuid[])', [
          [first.fileId, second.fileId]
        ])
      ).rows.map((row) => row.safety_generation)
    ).toEqual([1, 1]);
  });

  it('retains reconsideration explanation and resolution in both authorized histories', async () => {
    const submitted = await ready();
    await domain.decideSubmission(admin, {
      revisionId: submitted.revisionId,
      expectedVersion: submitted.version,
      outcome: 'rejected',
      publicFeedback: 'Needs clarification.',
      reward: 'none',
      requestKey: randomUUID()
    });
    const explanation = 'The cited protocol already includes the requested clarification.';
    await domain.requestReconsideration(student, submitted.submissionId, explanation);
    let state = await domain.getSubmission(admin, submitted.submissionId);
    expect(state.revisions[0].reconsiderations[0]).toMatchObject({ explanation, status: 'open' });
    await domain.decideSubmission(admin, {
      revisionId: submitted.revisionId,
      expectedVersion: state.version,
      outcome: 'accepted',
      publicFeedback: 'Clarification accepted.',
      reward: 'none',
      requestKey: randomUUID()
    });
    state = await domain.getSubmission(student, submitted.submissionId);
    expect(state.revisions[0].reconsiderations[0]).toMatchObject({
      explanation,
      status: 'resolved',
      resolution: 'Clarification accepted.'
    });
  });
});
