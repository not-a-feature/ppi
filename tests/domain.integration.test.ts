import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, SubmissionInput } from '../src/lib/server/domain/index.js';
import { termOptions, isValidTerm } from '../src/lib/terms.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const schema = `ppi_test_${randomUUID().replaceAll('-', '')}`;
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let admin: Actor;
let fixtureNumber = 0;

async function user(verified = true): Promise<Actor> {
  fixtureNumber++;
  assert(fixtureNumber < 100);
  const id = randomUUID(),
    email = `zxaaa${String(fixtureNumber).padStart(2, '0')}@student.uni-tuebingen.de`;
  await db.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,$4)', [
    id,
    'Dummy student',
    email,
    verified
  ]);
  if (verified) await domain.activateAccount(id);
  return { id, email, isAdmin: false };
}
function input(lectureId: string, collaboratorZx: string[] = []): SubmissionInput {
  return {
    file: {
      storageKey: randomUUID(),
      sha256: 'a'.repeat(64),
      byteCount: 12,
      mediaType: 'text/plain',
      originalName: 'dummy.txt'
    },
    lectureIds: [lectureId],
    term: termOptions()[0].value,
    remarks: 'Dummy protocol for integration tests.',
    collaboratorZx,
    attested: true,
    requestKey: randomUUID()
  };
}
async function readySubmission(actor: Actor, lectureId: string, contributors: string[] = []) {
  const submitted = await domain.submitProtocol(actor, input(lectureId, contributors));
  const revision = (
    await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [
      submitted.revisionId
    ])
  ).rows[0];
  await domain.completeFileCheck({
    fileId: revision.file_id,
    generation: 1,
    status: 'clean',
    detail: 'Dummy test file.'
  });
  const current = await domain.getSubmission(admin, submitted.submissionId);
  return { ...submitted, version: current.version };
}
async function review(
  revisionId: string,
  expectedVersion: number,
  reward: 'none' | 'base' | 'excellent' = 'base',
  outcome: 'accepted' | 'rejected' = 'accepted',
  requestKey = randomUUID()
) {
  const preview = await domain.getRewardPreview(
    admin,
    revisionId,
    reward === 'excellent' ? 'excellent' : 'base'
  );
  return domain.decideSubmission(admin, {
    revisionId,
    expectedVersion,
    reward,
    outcome,
    publicFeedback: 'Reviewed dummy protocol.',
    requestKey,
    rewardPolicyVersion: preview.policyVersion,
    rewardRecipientIds: preview.recipientIds
  });
}
async function balance(actor: Actor) {
  return (await domain.getDashboard(actor)).balance;
}

describe.skipIf(!testUrl)('PostgreSQL domain transactions', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
      'Integration tests require a local disposable database.'
    );
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../src/lib/server/db.js');
    domain = await import('../src/lib/server/domain/index.js');
    for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await db.pool.query(
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      );
    admin = await user();
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    admin.isAdmin = true;
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
  it('grants activation once and denies unverified accounts', async () => {
    const student = await user();
    await Promise.all([domain.activateAccount(student.id), domain.activateAccount(student.id)]);
    expect(await balance(student)).toBe(5);
    const unverified = await user(false);
    await expect(domain.activateAccount(unverified.id)).rejects.toMatchObject({
      code: 'account_ineligible'
    });
    expect(await domain.getActor(unverified.id)).toBeNull();
  });
  it('uses current permissions instead of trusting a forged or stale actor', async () => {
    const student = await user();
    await expect(
      domain.createLecture({ ...student, isAdmin: true }, 'Forged permission')
    ).rejects.toMatchObject({ code: 'admin_required' });
    await domain.setAccountStatus(admin, student.id, 'suspended');
    expect(await domain.getActor(student.id)).toBeNull();
    await expect(domain.getDashboard(student)).rejects.toMatchObject({
      code: 'account_ineligible'
    });
    await expect(domain.setAdmin(admin, admin.id, false)).rejects.toMatchObject({
      code: 'last_admin'
    });
  });
  it('prevents concurrent overspending and repeated active-access charges', async () => {
    const student = await user();
    await domain.adjustCredits(
      admin,
      student.id,
      -4,
      'Set concurrency fixture balance.',
      randomUUID()
    );
    const first = await domain.createLecture(admin, `Concurrency A ${randomUUID()}`);
    const second = await domain.createLecture(admin, `Concurrency B ${randomUUID()}`);
    const results = await Promise.allSettled([
      domain.purchaseLectureAccess(student, first.id, randomUUID()),
      domain.purchaseLectureAccess(student, second.id, randomUUID())
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await balance(student)).toBe(0);
    const purchased = (await domain.getDashboard(student)).access[0];
    expect(
      (await domain.getDashboard(student)).ledger.find((entry) => entry.kind === 'purchase')
        .lecture_name
    ).toBe(purchased.name);
    const repeated = await domain.purchaseLectureAccess(
      student,
      purchased.lecture_id,
      randomUUID()
    );
    expect(repeated.charged).toBe(0);
    expect(new Date(repeated.expiresAt).getTime()).toBe(new Date(purchased.expires_at).getTime());
    const legacy = await user();
    await db.transaction(async (client) => {
      await client.query(
        "INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,reason) VALUES($1,-1,'purchase',$2,1,'Lecture access')",
        [legacy.id, randomUUID()]
      );
      await client.query('UPDATE credit_account SET balance=balance-1 WHERE user_id=$1', [
        legacy.id
      ]);
      await client.query(
        "INSERT INTO audit_event(actor_id,action,entity_id) VALUES($1,'lecture.purchased',$2)",
        [legacy.id, first.id]
      );
    });
    expect(
      (await domain.getDashboard(legacy)).ledger.find((entry) => entry.kind === 'purchase')
        .lecture_name
    ).toBe(first.name);
  });
  it.each([1, 2, 3, 4])(
    'rounds an equal reward up across %i distinct recipients',
    async (recipientCount) => {
      const participants = await Promise.all(Array.from({ length: recipientCount }, () => user()));
      const lecture = await domain.createLecture(admin, `Reward ${randomUUID()}`);
      const collaborators = participants.map((participant) => participant.email.split('@')[0]);
      collaborators.push(collaborators[0], 'zxzzz99');
      const unverified = await user(false);
      collaborators.push(unverified.email.split('@')[0]);
      const submission = await readySubmission(participants[0], lecture.id, collaborators);
      if (recipientCount > 1) await domain.setAccountStatus(admin, participants[1].id, 'suspended');
      const key = randomUUID();
      await review(submission.revisionId, submission.version, 'base', 'accepted', key);
      await review(submission.revisionId, submission.version, 'base', 'accepted', key);
      for (const participant of participants)
        expect(
          (
            await db.pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [
              participant.id
            ])
          ).rows[0].balance
        ).toBe(5 + Math.ceil(3 / recipientCount));
      const current = await domain.getSubmission(admin, submission.submissionId);
      expect(current.rewardRecipients).toHaveLength(recipientCount);
      await review(submission.revisionId, current.version, 'excellent');
      for (const participant of participants)
        expect(
          (
            await db.pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [
              participant.id
            ])
          ).rows[0].balance
        ).toBe(5 + Math.ceil(3 / recipientCount));
    }
  );
  it('permits a reward for rejection of the initial submission', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Rejected reward ${randomUUID()}`);
    const submission = await readySubmission(student, lecture.id);
    await review(submission.revisionId, submission.version, 'excellent', 'rejected');
    expect(await balance(student)).toBe(11);
    const current = await domain.getSubmission(student, submission.submissionId);
    expect(current.visibility).toBe('unpublished');
    expect(current.revisions[0].decisions[0]).not.toHaveProperty('internal_note');
  });
  it('keeps immutable revisions and never rewards improvements, including an unpaid initial submission', async () => {
    const student = await user(),
      other = await user(),
      lecture = await domain.createLecture(admin, `Revision ${randomUUID()}`);
    const first = await readySubmission(student, lecture.id);
    await review(first.revisionId, first.version, 'none');
    await expect(
      domain.reviseProtocol(other, first.submissionId, input(lecture.id))
    ).rejects.toMatchObject({ code: 'uploader_required' });
    const second = await domain.reviseProtocol(student, first.submissionId, input(lecture.id));
    const current = await domain.getSubmission(student, first.submissionId);
    expect(current.published_revision_id).toBe(first.revisionId);
    expect(current.revisions).toHaveLength(2);
    const fileId = current.revisions[0].file_id;
    await domain.completeFileCheck({
      fileId,
      generation: 1,
      status: 'clean',
      detail: 'Dummy test file.'
    });
    const ready = await domain.getSubmission(student, first.submissionId);
    await expect(review(second.revisionId, ready.version, 'excellent')).rejects.toMatchObject({
      code: 'improvement_unrewarded'
    });
    await review(second.revisionId, ready.version, 'none');
    expect(await balance(student)).toBe(5);
    expect((await domain.getSubmission(student, first.submissionId)).published_revision_id).toBe(
      second.revisionId
    );
    await expect(
      db.pool.query("UPDATE submission_revision SET remarks='changed' WHERE id=$1", [
        first.revisionId
      ])
    ).rejects.toThrow('History records are immutable');
  });
  it('inherits the exam date across improvements and ignores replacement dates', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Inherited date ${randomUUID()}`);
    const first = await domain.submitProtocol(student, {
      ...input(lecture.id),
      examDate: '2026-10-18'
    });
    await domain.reviseProtocol(student, first.submissionId, {
      ...input(lecture.id),
      examDate: '2025-01-01'
    });
    await domain.reviseProtocol(student, first.submissionId, input(lecture.id));
    const dates = await db.pool.query(
      'SELECT exam_date::text date FROM submission_revision WHERE submission_id=$1 ORDER BY revision_number',
      [first.submissionId]
    );
    expect(dates.rows.map((row) => row.date)).toEqual(['2026-10-18', '2026-10-18', '2026-10-18']);
    const legacy = await domain.submitProtocol(student, input(lecture.id));
    await domain.reviseProtocol(student, legacy.submissionId, {
      ...input(lecture.id),
      examDate: '2026-10-18'
    });
    expect(
      (
        await db.pool.query('SELECT exam_date FROM submission_revision WHERE submission_id=$1', [
          legacy.submissionId
        ])
      ).rows.every((row) => row.exam_date === null)
    ).toBe(true);
  });
  it('rolls back all rewards, decision and publication when one recipient fails', async () => {
    const student = await user(),
      collaborator = await user(),
      lecture = await domain.createLecture(admin, `Rollback ${randomUUID()}`);
    const submission = await readySubmission(student, lecture.id, [
      collaborator.email.split('@')[0]
    ]);
    await db.pool
      .query(`CREATE FUNCTION reject_test_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='contribution' AND NEW.user_id='${collaborator.id}' THEN RAISE EXCEPTION 'Test recipient failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_reward BEFORE INSERT ON credit_entry FOR EACH ROW EXECUTE FUNCTION reject_test_reward();`);
    await expect(review(submission.revisionId, submission.version)).rejects.toThrow(
      'Test recipient failure'
    );
    expect(await balance(student)).toBe(5);
    expect(await balance(collaborator)).toBe(5);
    const current = await domain.getSubmission(admin, submission.submissionId);
    expect(current.visibility).toBe('unpublished');
    expect(current.rewardAllocation).toBeNull();
    expect(current.revisions[0].decisions).toHaveLength(0);
    await db.pool.query(
      'DROP TRIGGER reject_test_reward ON credit_entry; DROP FUNCTION reject_test_reward()'
    );
  });
  it('deduplicates uploads and rejects reused request keys with changed input', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Idempotence ${randomUUID()}`);
    const request = input(lecture.id);
    const results = await Promise.all([
      domain.submitProtocol(student, request),
      domain.submitProtocol(student, request)
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      await domain.submitProtocol(student, {
        ...request,
        file: { ...request.file, storageKey: randomUUID() }
      })
    ).toEqual(results[0]);
    expect((await domain.getSubmission(student, results[0].submissionId)).revisions).toHaveLength(
      1
    );
    await expect(
      domain.submitProtocol(student, { ...request, remarks: 'Changed input' })
    ).rejects.toMatchObject({ code: 'request_key_reused' });
  });
  it('rejects unsafe files and stale review/check completions', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Safety ${randomUUID()}`);
    const first = await domain.submitProtocol(student, input(lecture.id));
    const initial = await domain.getSubmission(student, first.submissionId);
    await expect(review(first.revisionId, initial.version, 'none')).rejects.toMatchObject({
      code: 'unsafe_file'
    });
    const second = await domain.reviseProtocol(student, first.submissionId, input(lecture.id));
    await domain.completeFileCheck({
      fileId: initial.revisions[0].file_id,
      generation: 1,
      status: 'clean',
      detail: 'Late first revision result.'
    });
    const current = await domain.getSubmission(student, first.submissionId);
    expect(current.current_revision_id).toBe(second.revisionId);
    expect(current.review_state).toBe('processing');
    await expect(review(first.revisionId, current.version, 'none')).rejects.toMatchObject({
      code: 'stale_review'
    });
    expect(
      await domain.completeFileCheck({
        fileId: initial.revisions[0].file_id,
        generation: 1,
        status: 'blocked',
        detail: 'Duplicate completion.'
      })
    ).toBe(false);
  });
  it('withdraws the published revision while an improvement remains pending', async () => {
    const student = await user(),
      reader = await user(),
      lecture = await domain.createLecture(admin, `Withdrawal ${randomUUID()}`);
    const first = await readySubmission(student, lecture.id);
    await review(first.revisionId, first.version, 'none');
    await domain.purchaseLectureAccess(reader, lecture.id, randomUUID());
    await expect(domain.getDownload(reader, first.revisionId)).resolves.toHaveProperty(
      'storageKey'
    );
    await domain.reviseProtocol(student, first.submissionId, input(lecture.id));
    const current = await domain.getSubmission(admin, first.submissionId);
    await domain.withdrawPublication(admin, {
      submissionId: first.submissionId,
      expectedVersion: current.version,
      expectedPublishedRevisionId: first.revisionId,
      reason: 'Dummy withdrawal test.'
    });
    await expect(domain.getDownload(reader, first.revisionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    const withdrawn = await domain.getSubmission(student, first.submissionId);
    expect(withdrawn.review_state).toBe('processing');
    expect(withdrawn.published_revision_id).toBe(first.revisionId);
    expect(withdrawn.visibility).toBe('withdrawn');
  });
  it('freezes periodic grant amounts and recipients across batches and retries', async () => {
    const student = await user(),
      unverified = await user(false),
      before = await balance(student),
      period = randomUUID();
    const suspended = await user();
    await domain.setAccountStatus(admin, suspended.id, 'suspended');
    const deletionPending = await user();
    await domain.requestAccountDeletion(deletionPending);
    const preview = await domain.getPeriodicGrantPreview(admin);
    const verifiedCount = (
      await db.pool.query('SELECT count(*)::integer n FROM "user" WHERE "emailVerified"')
    ).rows[0].n;
    expect(preview).toEqual({ accounts: verifiedCount, amount: 2, total: verifiedCount * 2 });
    const first = await domain.processPeriodicGrant(period, 1);
    const policy = await domain.getSettings(admin);
    await domain.updateSettings(admin, { ...policy, periodic_grant: 9 });
    let batch = first;
    while (batch.remaining > 0) batch = await domain.processPeriodicGrant(period, 1000);
    expect(batch.amount).toBe(2);
    expect(await balance(student)).toBe(before + 2);
    expect(
      (await db.pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [suspended.id]))
        .rows[0].balance
    ).toBe(7);
    expect(
      (
        await db.pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [
          deletionPending.id
        ])
      ).rows[0].balance
    ).toBe(7);
    await domain.processPeriodicGrant(period, 1000);
    expect(await balance(student)).toBe(before + 2);
    expect(
      (await db.pool.query('SELECT * FROM credit_entry WHERE user_id=$1', [unverified.id])).rows
    ).toHaveLength(0);
    await domain.updateSettings(admin, { ...policy, periodic_grant: 2 });
  });
  it('retains protocols after a deletion request and reconciles cached balances with the ledger', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Deletion ${randomUUID()}`);
    const submitted = await domain.submitProtocol(student, input(lecture.id));
    await domain.requestAccountDeletion(student);
    expect(await domain.getActor(student.id)).toBeNull();
    expect((await domain.getSubmission(admin, submitted.submissionId)).uploader_id).toBe(
      student.id
    );
    const mismatches = await db.pool
      .query(`SELECT a.user_id FROM credit_account a LEFT JOIN credit_entry e ON e.user_id=a.user_id
      GROUP BY a.user_id,a.balance HAVING a.balance<>COALESCE(sum(e.amount),0)`);
    expect(mismatches.rows).toHaveLength(0);
  });
  it('records private content reports, resolves them once and leaves publication unchanged', async () => {
    const student = await user(),
      reporter = await user(),
      lecture = await domain.createLecture(admin, `Report ${randomUUID()}`);
    const submission = await readySubmission(student, lecture.id);
    await review(submission.revisionId, submission.version, 'none');
    const request = {
      submissionId: submission.submissionId,
      category: 'metadata' as const,
      explanation: 'The exam term needs correction.',
      requestKey: randomUUID()
    };
    const report = await domain.reportContent(reporter, request);
    expect(await domain.reportContent(reporter, request)).toEqual(report);
    await expect(domain.listContentReports(reporter)).rejects.toMatchObject({
      code: 'admin_required'
    });
    await expect(
      domain.resolveContentReport(reporter, report.id, 'Unauthorized resolution.')
    ).rejects.toMatchObject({ code: 'admin_required' });
    expect(
      (await domain.listContentReports(admin)).find((item) => item.id === report.id).reporter_email
    ).toBe(reporter.email);
    await domain.resolveContentReport(
      admin,
      report.id,
      'Metadata reviewed; no publication change.'
    );
    await expect(
      domain.resolveContentReport(admin, report.id, 'Second resolution.')
    ).rejects.toMatchObject({ code: 'report_resolved' });
    expect((await domain.getSubmission(student, submission.submissionId)).visibility).toBe(
      'published'
    );
    expect(
      (await domain.getDashboard(reporter)).notifications.some(
        (item) => item.event_key === `report:${report.id}`
      )
    ).toBe(true);
  });
  it('reopens a rejected review on uploader reconsideration without another reward', async () => {
    const student = await user(),
      other = await user(),
      lecture = await domain.createLecture(admin, `Reconsideration ${randomUUID()}`);
    const submission = await readySubmission(student, lecture.id);
    await review(submission.revisionId, submission.version, 'base', 'rejected');
    await expect(
      domain.requestReconsideration(other, submission.submissionId, 'Another account.')
    ).rejects.toMatchObject({ code: 'not_found' });
    const request = await domain.requestReconsideration(
      student,
      submission.submissionId,
      'Please reconsider the original explanation.'
    );
    const pending = await domain.getSubmission(student, submission.submissionId);
    expect(pending.review_state).toBe('awaiting_review');
    expect(pending.visibility).toBe('unpublished');
    expect(pending.revisions[0].reconsiderations[0].id).toBe(request.id);
    expect(await balance(student)).toBe(8);
    await expect(
      domain.requestReconsideration(student, submission.submissionId, 'Duplicate reconsideration.')
    ).rejects.toMatchObject({ code: 'reconsideration_unavailable' });
    await review(submission.revisionId, pending.version, 'excellent');
    const accepted = await domain.getSubmission(student, submission.submissionId);
    expect(accepted.visibility).toBe('published');
    expect(accepted.revisions[0].reconsiderations[0].status).toBe('resolved');
    expect(await balance(student)).toBe(8);
  });
  it('increments safety generations and blocks stale reprocessing completions', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Reprocessing ${randomUUID()}`);
    const submission = await readySubmission(student, lecture.id);
    await review(submission.revisionId, submission.version, 'none');
    await expect(domain.reprocessFile(student, submission.submissionId)).rejects.toMatchObject({
      code: 'admin_required'
    });
    const check = await domain.reprocessFile(admin, submission.submissionId);
    expect(check.generation).toBe(2);
    await expect(domain.getDownload(student, submission.revisionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect(
      await domain.completeFileCheck({
        fileId: check.fileId,
        generation: 1,
        status: 'clean',
        detail: 'Stale worker result.'
      })
    ).toBe(false);
    expect(
      await domain.completeFileCheck({
        fileId: check.fileId,
        generation: 2,
        status: 'clean',
        detail: 'Current worker result.'
      })
    ).toBe(true);
    await expect(domain.getDownload(student, submission.revisionId)).resolves.toHaveProperty(
      'storageKey'
    );
    const current = await domain.getSubmission(student, submission.submissionId);
    expect(current.visibility).toBe('published');
    expect(current.review_state).toBe('accepted');
  });
  it('keeps proposed lectures private until approval and reuses free-text examiners', async () => {
    const student = await user(),
      reader = await user(),
      lecture = await domain.createLecture(admin, `Existing ${randomUUID()}`);
    const proposedName = `Proposed ${randomUUID()}`,
      examinerName = `Examiner ${randomUUID()}`;
    const request = { ...input(lecture.id), newLectureNames: [proposedName], examinerName };
    const submitted = await domain.submitProtocol(student, request);
    const own = await domain.getSubmission(student, submitted.submissionId);
    expect(own.revisions[0].examiner_name).toBe(examinerName);
    const proposed = (await domain.listUploadLectures(student)).find(
      (item) => item.name === proposedName
    );
    expect(proposed.approval_status).toBe('pending');
    expect((await domain.listLectures(student)).some((item) => item.id === proposed.id)).toBe(
      false
    );
    expect((await domain.listLectures(admin)).some((item) => item.id === proposed.id)).toBe(false);
    expect(
      (await domain.listLectures(admin, '', true)).some((item) => item.id === proposed.id)
    ).toBe(true);
    expect((await domain.listUploadLectures(reader)).some((item) => item.id === proposed.id)).toBe(
      false
    );
    await expect(domain.getLecture(reader, proposed.id)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect((await domain.getLecture(student, proposed.id)).protocols).toHaveLength(0);
    await expect(
      domain.purchaseLectureAccess(student, proposed.id, randomUUID())
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(domain.listPublishedProtocols(reader, proposed.id)).rejects.toMatchObject({
      code: 'not_found'
    });
    await expect(
      domain.submitProtocol({ ...reader, isAdmin: true }, input(proposed.id))
    ).rejects.toMatchObject({ code: 'invalid_lecture' });
    await domain.completeFileCheck({
      fileId: own.revisions[0].file_id,
      generation: 1,
      status: 'clean',
      detail: 'Dummy test file.'
    });
    const ready = await domain.getSubmission(student, submitted.submissionId);
    await expect(review(submitted.revisionId, ready.version, 'none')).rejects.toMatchObject({
      code: 'lecture_approval_required'
    });
    await expect(
      domain.updateLecture(student, proposed.id, 1, { name: proposedName, aliases: [] })
    ).rejects.toMatchObject({ code: 'admin_required' });
    const renamed = await domain.updateLecture(admin, proposed.id, 1, {
      name: `Approved ${randomUUID()}`,
      aliases: [proposedName]
    });
    await expect(
      domain.decideLecture(student, proposed.id, renamed.version, 'approved')
    ).rejects.toMatchObject({ code: 'admin_required' });
    await domain.decideLecture(admin, proposed.id, renamed.version, 'approved');
    expect((await domain.listLectures(reader, proposedName)).map((item) => item.id)).toEqual([
      proposed.id
    ]);
    expect(await domain.listLectures(reader, proposedName, false, true)).toHaveLength(0);
    await review(submitted.revisionId, ready.version, 'none');
    expect(await domain.listLectures(reader, proposedName, false, true)).toHaveLength(1);
    const suggestions = await domain.listExaminerSuggestions(reader);
    expect(suggestions.find((item) => item.name === examinerName).lectureIds.sort()).toEqual(
      [lecture.id, proposed.id].sort()
    );
    const same = await domain.submitProtocol(student, {
      ...input(lecture.id),
      examinerName: examinerName.toUpperCase()
    });
    expect((await domain.getSubmission(student, same.submissionId)).revisions[0].examiner_id).toBe(
      own.revisions[0].examiner_id
    );
    const approved = (await domain.listLectures(admin, '', true)).find(
      (item) => item.id === proposed.id
    );
    await domain.purchaseLectureAccess(reader, lecture.id, randomUUID());
    await domain.decideLecture(admin, proposed.id, approved.version, 'rejected');
    await expect(domain.getDownload(reader, submitted.revisionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect(await domain.listPublishedProtocols(reader, lecture.id)).toHaveLength(0);
  });
  it('requires canonical semesters in the Berlin-year range without changing existing terms', async () => {
    const fixed = new Date('2026-12-31T23:30:00Z');
    expect(termOptions(fixed)[0].value).toBe('WS2028/29');
    expect(isValidTerm('SS2017', fixed)).toBe(true);
    expect(isValidTerm('SS2016', fixed)).toBe(false);
    expect(isValidTerm('WS2026/28', fixed)).toBe(false);
    const student = await user(),
      lecture = await domain.createLecture(admin, `Semester ${randomUUID()}`);
    await expect(
      domain.submitProtocol(student, { ...input(lecture.id), term: '' })
    ).rejects.toMatchObject({ code: 'invalid_term' });
    await expect(
      domain.submitProtocol(student, { ...input(lecture.id), term: 'Sommersemester 2026' })
    ).rejects.toMatchObject({ code: 'invalid_term' });
    const first = await domain.submitProtocol(student, input(lecture.id));
    await expect(
      domain.reviseProtocol(student, first.submissionId, { ...input(lecture.id), term: 'SS9999' })
    ).rejects.toMatchObject({ code: 'invalid_term' });
    expect((await domain.getSubmission(student, first.submissionId)).revisions[0].term).toBe(
      input(lecture.id).term
    );
  });
  it('blocks every file operation after tombstoning while retaining metadata', async () => {
    const student = await user(),
      lecture = await domain.createLecture(admin, `Deleted files ${randomUUID()}`);
    const first = await readySubmission(student, lecture.id);
    await review(first.revisionId, first.version, 'none');
    const own = await domain.getSubmission(student, first.submissionId);
    await db.transaction(async (client) => {
      await client.query('UPDATE stored_file SET deleted_at=now() WHERE id=$1', [
        own.revisions[0].file_id
      ]);
      await client.query('UPDATE submission SET files_deleted_at=now() WHERE id=$1', [
        first.submissionId
      ]);
    });
    await expect(domain.getDownload(admin, first.revisionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    await expect(
      domain.reviseProtocol(student, first.submissionId, input(lecture.id))
    ).rejects.toMatchObject({ code: 'files_deleted' });
    await expect(review(first.revisionId, own.version, 'none')).rejects.toMatchObject({
      code: 'files_deleted'
    });
    await expect(domain.reprocessFile(admin, first.submissionId)).rejects.toMatchObject({
      code: 'not_found'
    });
    expect(
      await domain.completeFileCheck({
        fileId: own.revisions[0].file_id,
        generation: 1,
        status: 'clean',
        detail: 'Late result.'
      })
    ).toBe(false);
    const retained = await domain.getSubmission(admin, first.submissionId);
    expect(retained.revisions[0].original_name).toBe('dummy.txt');
    expect(retained.revisions[0].file_deleted_at).toBeTruthy();
    expect(await domain.listPublishedProtocols(student, lecture.id)).toHaveLength(0);
    expect(
      (await domain.listReviewQueue(admin)).some((item) => item.id === first.submissionId)
    ).toBe(false);
    expect(
      (await domain.listReviewQueue(admin, true)).find((item) => item.id === first.submissionId)
        .files_deleted_at
    ).toBeTruthy();
    await expect(domain.listReviewQueue(student, true)).rejects.toMatchObject({
      code: 'admin_required'
    });
  });
  it('scopes examiner management to one lecture and retains historical names', async () => {
    const student = await user(),
      reader = await user();
    const first = await domain.createLecture(admin, `Examiner scope A ${randomUUID()}`),
      second = await domain.createLecture(admin, `Examiner scope B ${randomUUID()}`);
    const originalName = `Original examiner ${randomUUID()}`;
    const original = await domain.addLectureExaminer(admin, first.id, originalName);
    expect((await domain.addLectureExaminer(admin, second.id, originalName.toUpperCase())).id).toBe(
      original.id
    );
    await expect(
      domain.addLectureExaminer(student, first.id, 'Unauthorized')
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(
      domain.renameLectureExaminer(student, first.id, original.id, 'Unauthorized')
    ).rejects.toMatchObject({ code: 'admin_required' });
    await expect(
      domain.removeLectureExaminer(student, first.id, original.id)
    ).rejects.toMatchObject({ code: 'admin_required' });
    const submitted = await domain.submitProtocol(student, {
      ...input(first.id),
      examinerId: original.id
    });
    const old = await domain.getSubmission(student, submitted.submissionId);
    const replacement = await domain.renameLectureExaminer(
      admin,
      first.id,
      original.id,
      `Renamed examiner ${randomUUID()}`
    );
    expect(
      (await domain.listLectureExaminers(reader, first.id)).map((examiner) => examiner.id)
    ).toEqual([replacement.id]);
    expect(
      (await domain.listLectureExaminers(reader, second.id)).map((examiner) => examiner.id)
    ).toEqual([original.id]);
    expect(
      (await domain.getSubmission(student, submitted.submissionId)).revisions[0].examiner_name
    ).toBe(originalName);
    expect(
      (await domain.getSubmission(student, submitted.submissionId)).revisions[0].examiner_id
    ).toBe(old.revisions[0].examiner_id);
    const suggestions = await domain.listExaminerSuggestions(reader);
    expect(suggestions.find((examiner) => examiner.id === original.id).lectureIds).toEqual([
      second.id
    ]);
    expect(suggestions.find((examiner) => examiner.id === replacement.id).lectureIds).toEqual([
      first.id
    ]);
    await domain.removeLectureExaminer(admin, first.id, replacement.id);
    expect(await domain.listLectureExaminers(reader, first.id)).toHaveLength(0);
    expect(await domain.listLectureExaminers(reader, second.id)).toHaveLength(1);
    const both = await domain.submitProtocol(student, {
      ...input(first.id),
      lectureIds: [first.id, second.id],
      examinerName: `Both lectures ${randomUUID()}`
    });
    const bothExaminer = (await domain.getSubmission(student, both.submissionId)).revisions[0]
      .examiner_id;
    expect(
      (await domain.listExaminerSuggestions(reader))
        .find((examiner) => examiner.id === bothExaminer)
        .lectureIds.sort()
    ).toEqual([first.id, second.id].sort());
    const privateSubmission = await domain.submitProtocol(student, {
      ...input(first.id),
      lectureIds: [],
      newLectureNames: [`Private lecture ${randomUUID()}`],
      examinerName: `Private examiner ${randomUUID()}`
    });
    const privateRevision = (await domain.getSubmission(student, privateSubmission.submissionId))
      .revisions[0];
    expect(
      (await domain.listExaminerSuggestions(student)).some(
        (examiner) => examiner.id === privateRevision.examiner_id
      )
    ).toBe(true);
    expect(
      (await domain.listExaminerSuggestions(reader)).some(
        (examiner) => examiner.id === privateRevision.examiner_id
      )
    ).toBe(false);
    await expect(
      domain.listLectureExaminers(reader, privateRevision.lecture_ids[0])
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      domain.submitProtocol(reader, { ...input(first.id), examinerId: privateRevision.examiner_id })
    ).rejects.toMatchObject({ code: 'invalid_examiner' });
  });
});
