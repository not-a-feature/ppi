import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, SubmissionInput } from '../src/lib/server/domain/index.js';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const schema = `ppi_metadata_test_${randomUUID().replaceAll('-', '')}`;
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let updateProtocolMetadata: typeof import('../src/lib/server/domain/metadata.js').updateProtocolMetadata;
let admin: Actor;
let fixtureNumber = 0;

async function user(): Promise<Actor> {
  fixtureNumber++;
  assert(fixtureNumber < 100);
  const id = randomUUID();
  const email = `zxmet${String(fixtureNumber).padStart(2, '0')}@student.uni-tuebingen.de`;
  await db.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    id,
    'Metadata fixture',
    email
  ]);
  await domain.activateAccount(id);
  return { id, email, isAdmin: false };
}

async function publishedFixture() {
  const student = await user();
  const firstLecture = await domain.createLecture(admin, `Metadata lecture A ${randomUUID()}`);
  const secondLecture = await domain.createLecture(admin, `Metadata lecture B ${randomUUID()}`);
  const unapprovedLecture = await domain.createLecture(admin, `Metadata lecture C ${randomUUID()}`);
  await db.pool.query("UPDATE lecture SET approval_status='pending' WHERE id=$1", [
    unapprovedLecture.id
  ]);
  await domain.decideLecture(admin, firstLecture.id, 1, 'approved');
  await domain.decideLecture(admin, secondLecture.id, 1, 'approved');
  const input: SubmissionInput = {
    file: {
      storageKey: randomUUID(),
      sha256: 'b'.repeat(64),
      byteCount: 12,
      mediaType: 'text/plain',
      originalName: 'source.txt'
    },
    lectureIds: [firstLecture.id],
    term: 'SS2025',
    remarks: 'Initial remarks.',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  };
  const submitted = await domain.submitProtocol(student, input);
  const file = (
    await db.pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [
      submitted.revisionId
    ])
  ).rows[0];
  await domain.completeFileCheck({
    fileId: file.file_id,
    generation: 1,
    status: 'clean',
    detail: 'Test file.'
  });
  const preview = await domain.getRewardPreview(admin, submitted.revisionId, 'base');
  const current = await domain.getSubmission(admin, submitted.submissionId);
  await domain.decideSubmission(admin, {
    revisionId: submitted.revisionId,
    expectedVersion: current.version,
    reward: 'base',
    outcome: 'accepted',
    publicFeedback: 'Reviewed fixture.',
    requestKey: randomUUID(),
    rewardPolicyVersion: preview.policyVersion,
    rewardRecipientIds: preview.recipientIds
  });
  const afterReview = await domain.getSubmission(admin, submitted.submissionId);
  return {
    student,
    firstLecture,
    secondLecture,
    unapprovedLecture,
    submissionId: submitted.submissionId,
    revisionId: submitted.revisionId,
    fileId: file.file_id as string,
    version: afterReview.version
  };
}

describe.skipIf(!testUrl)('protocol metadata edits', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../src/lib/server/db.js');
    domain = await import('../src/lib/server/domain/index.js');
    ({ updateProtocolMetadata } = await import('../src/lib/server/domain/metadata.js'));
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
      assert(/^ppi_metadata_test_[a-f0-9]{32}$/.test(schema));
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('updates published metadata atomically while preserving file, review and reward history', async () => {
    const fixture = await publishedFixture();
    const fileBefore = (
      await db.pool.query(
        'SELECT storage_key,sha256,byte_count,media_type,original_name FROM stored_file WHERE id=$1',
        [fixture.fileId]
      )
    ).rows[0];
    await db.pool.query(
      `INSERT INTO lecture_archive(requester_id,lecture_id,revision_ids,status,expires_at,storage_key,byte_count,completed_at)
       VALUES($1,$2,ARRAY[$3::uuid],'ready',now()+interval '1 day',$4,10,now()),
             ($1,$2,ARRAY[$3::uuid],'queued',now()+interval '1 day',NULL,NULL,NULL)`,
      [fixture.student.id, fixture.firstLecture.id, fixture.revisionId, randomUUID()]
    );
    const allocationsBefore = await db.pool.query(
      'SELECT * FROM reward_allocation WHERE submission_id=$1',
      [fixture.submissionId]
    );
    const recipientsBefore = await db.pool.query(
      'SELECT * FROM reward_recipient WHERE submission_id=$1 ORDER BY user_id',
      [fixture.submissionId]
    );
    const decisionsBefore = await db.pool.query(
      'SELECT id,revision_id,actor_id,outcome,public_feedback,internal_note,created_at FROM moderation_decision WHERE revision_id=$1',
      [fixture.revisionId]
    );

    const result = await updateProtocolMetadata(admin, fixture.submissionId, {
      revisionId: fixture.revisionId,
      expectedVersion: fixture.version,
      lectureIds: [fixture.secondLecture.id],
      examinerNames: ['Examiner One', 'Examiner Two'],
      term: 'WS1998/99',
      examDate: '1999-01-12',
      remarks: 'Corrected metadata.'
    });
    expect(result.version).toBe(fixture.version + 1);
    const updated = (
      await db.pool.query(
        `SELECT s.version,s.review_state,s.visibility,s.published_revision_id,r.file_id,r.examiner_id,
                r.exam_date::text exam_date,r.term,r.remarks,f.original_name,f.storage_key,f.sha256,
                f.byte_count,f.media_type,
                ARRAY(SELECT lecture_id FROM revision_lecture WHERE revision_id=r.id) lecture_ids,
                ARRAY(SELECT e.name FROM revision_examiner re JOIN examiner e ON e.id=re.examiner_id
                      WHERE re.revision_id=r.id ORDER BY re.position) examiner_names
         FROM submission s JOIN submission_revision r ON r.id=$2 JOIN stored_file f ON f.id=r.file_id
         WHERE s.id=$1`,
        [fixture.submissionId, fixture.revisionId]
      )
    ).rows[0];
    expect(updated).toMatchObject({
      version: fixture.version + 1,
      review_state: 'accepted',
      visibility: 'published',
      published_revision_id: fixture.revisionId,
      file_id: fixture.fileId,
      exam_date: '1999-01-12',
      term: 'WS1998/99',
      remarks: 'Corrected metadata.',
      lecture_ids: [fixture.secondLecture.id],
      examiner_names: ['Examiner One', 'Examiner Two'],
      original_name: 'WS1998-99_1999-01-12_1.txt',
      storage_key: fileBefore.storage_key,
      sha256: fileBefore.sha256,
      byte_count: fileBefore.byte_count,
      media_type: fileBefore.media_type
    });
    expect(updated.examiner_id).toBe(
      (
        await db.pool.query(
          'SELECT examiner_id FROM revision_examiner WHERE revision_id=$1 AND position=1',
          [fixture.revisionId]
        )
      ).rows[0].examiner_id
    );
    expect(
      await db.pool.query('SELECT * FROM reward_allocation WHERE submission_id=$1', [
        fixture.submissionId
      ])
    ).toEqual(allocationsBefore);
    expect(
      await db.pool.query(
        'SELECT * FROM reward_recipient WHERE submission_id=$1 ORDER BY user_id',
        [fixture.submissionId]
      )
    ).toEqual(recipientsBefore);
    expect(
      await db.pool.query(
        'SELECT id,revision_id,actor_id,outcome,public_feedback,internal_note,created_at FROM moderation_decision WHERE revision_id=$1',
        [fixture.revisionId]
      )
    ).toEqual(decisionsBefore);
    expect(
      (
        await db.pool.query(
          'SELECT status FROM lecture_archive WHERE revision_ids @> ARRAY[$1::uuid] ORDER BY created_at',
          [fixture.revisionId]
        )
      ).rows.map((row) => row.status)
    ).toEqual(['invalidated', 'invalidated']);
    const audit = (
      await db.pool.query(
        "SELECT detail FROM audit_event WHERE entity_id=$1 AND action='submission.metadata_updated'",
        [fixture.submissionId]
      )
    ).rows[0].detail;
    expect(audit.before).toMatchObject({
      lectureIds: [fixture.firstLecture.id],
      term: 'SS2025',
      remarks: 'Initial remarks.'
    });
    expect(audit.after).toMatchObject({
      lectureIds: [fixture.secondLecture.id],
      examinerNames: ['Examiner One', 'Examiner Two'],
      term: 'WS1998/99',
      examDate: '1999-01-12',
      remarks: 'Corrected metadata.'
    });
    await domain.reviseProtocol(fixture.student, fixture.submissionId, {
      file: {
        storageKey: randomUUID(),
        sha256: 'c'.repeat(64),
        byteCount: 12,
        mediaType: 'text/plain',
        originalName: 'improvement.txt'
      },
      lectureIds: [fixture.secondLecture.id],
      examinerName: 'Examiner One',
      term: 'SS2026',
      examDate: '2026-10-19',
      remarks: 'Improved file.',
      collaboratorZx: [],
      attested: true,
      requestKey: randomUUID()
    });
    const improved = await domain.getSubmission(admin, fixture.submissionId);
    expect(improved.upload_number).toBe('1');
    expect(improved.revisions[0].term).toBe('WS1998/99');
    expect(
      (
        await db.pool.query('SELECT exam_date::text date FROM submission_revision WHERE id=$1', [
          improved.current_revision_id
        ])
      ).rows[0].date
    ).toBe('1999-01-12');
    const queue = await domain.listReviewQueuePage(admin, { includeAll: true });
    expect(queue.entries.find((entry) => entry.id === fixture.submissionId).upload_number).toBe(
      '1'
    );
  });

  it('requires a fresh admin and version and rejects unapproved published lecture assignments', async () => {
    const fixture = await publishedFixture();
    const input = {
      revisionId: fixture.revisionId,
      expectedVersion: fixture.version,
      lectureIds: [fixture.secondLecture.id],
      examinerNames: [],
      term: 'SS2000',
      examDate: null,
      remarks: 'Metadata.'
    };
    await expect(
      updateProtocolMetadata(fixture.student, fixture.submissionId, input)
    ).rejects.toMatchObject({
      status: 403,
      code: 'admin_required'
    });
    await expect(
      updateProtocolMetadata(admin, fixture.submissionId, {
        ...input,
        expectedVersion: fixture.version - 1
      })
    ).rejects.toMatchObject({ status: 409, code: 'stale_metadata' });
    await expect(
      updateProtocolMetadata(admin, fixture.submissionId, {
        ...input,
        lectureIds: [fixture.unapprovedLecture.id]
      })
    ).rejects.toMatchObject({ status: 409, code: 'lecture_approval_required' });
    expect((await domain.getSubmission(admin, fixture.submissionId)).version).toBe(fixture.version);
  });

  it('keeps revision file identity and attestation fields immutable in the database', async () => {
    const fixture = await publishedFixture();
    await expect(
      db.pool.query('UPDATE submission_revision SET file_id=$2 WHERE id=$1', [
        fixture.revisionId,
        randomUUID()
      ])
    ).rejects.toThrow('Revision identity and file fields are immutable');
    await expect(
      db.pool.query('UPDATE submission_revision SET attested=false WHERE id=$1', [
        fixture.revisionId
      ])
    ).rejects.toThrow('Revision identity and file fields are immutable');
  });
});
