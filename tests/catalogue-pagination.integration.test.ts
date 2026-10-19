import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/server/domain/index.js';
import { termOptions } from '../src/lib/terms';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const schema = `ppi_test_${randomUUID().replaceAll('-', '')}`;
let adminPool: pg.Pool;
let db: typeof import('../src/lib/server/db.js');
let domain: typeof import('../src/lib/server/domain/index.js');
let listAdminEntries: (typeof import('../src/lib/server/domain/admin-lists.js'))['listAdminEntries'];
let admin: Actor;
let reader: Actor;
let lectureId: string;
let proposalId: string;

describe.skipIf(!testUrl)('Catalogue and account pagination beyond 100 entries', () => {
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
    ({ listAdminEntries } = await import('../src/lib/server/domain/admin-lists.js'));
    for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await db.pool.query(
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      );
    admin = { id: randomUUID(), email: 'zxaaa01@student.uni-tuebingen.de', isAdmin: true };
    reader = { id: randomUUID(), email: 'zxaaa02@student.uni-tuebingen.de', isAdmin: false };
    for (const actor of [admin, reader]) {
      await db.pool.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [actor.id, 'Catalogue fixture', actor.email]
      );
      await domain.activateAccount(actor.id);
    }
    await db.pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [admin.id]);
    await db.pool.query(
      `INSERT INTO lecture(name,normalized_name) SELECT 'Course '||lpad(n::text,3,'0'),'course '||n FROM generate_series(1,105) n`
    );
    lectureId = (await db.pool.query("SELECT id FROM lecture WHERE name='Course 001'")).rows[0].id;
    proposalId = (
      await db.pool.query(
        "INSERT INTO lecture(name,normalized_name,aliases,approval_status,proposed_by) VALUES('ZZ proposal','zz proposal',ARRAY['Missing course'],'pending',$1) RETURNING id",
        [reader.id]
      )
    ).rows[0].id;
    await db.pool.query('INSERT INTO lecture_proposer(lecture_id,user_id) VALUES($1,$2)', [
      proposalId,
      reader.id
    ]);
    await db.transaction(async (client) => {
      for (let index = 0; index < 106; index++) {
        const fileId = randomUUID(),
          submissionId = randomUUID(),
          revisionId = randomUUID();
        await client.query(
          `INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name,safety_status)
          VALUES($1,$2,$3,12,'text/plain',$4,$5)`,
          [
            fileId,
            randomUUID(),
            'a'.repeat(64),
            `protocol-${index}.txt`,
            index === 105 ? 'blocked' : 'clean'
          ]
        );
        await client.query(
          `INSERT INTO submission(id,uploader_id,current_revision_id,published_revision_id,review_state,visibility,created_at)
          VALUES($1,$2,$3,$3,'accepted','published',timestamp '2026-01-01'+$4*interval '1 minute')`,
          [submissionId, admin.id, revisionId, index]
        );
        await client.query(
          `INSERT INTO submission_revision(id,submission_id,revision_number,file_id,remarks,attested,exam_date)
          VALUES($1,$2,1,$3,'Pagination fixture',true,date '2026-06-01'-$4::integer)`,
          [revisionId, submissionId, fileId, index]
        );
        await client.query('INSERT INTO revision_lecture(revision_id,lecture_id) VALUES($1,$2)', [
          revisionId,
          lectureId
        ]);
      }
    });
    await db.pool.query(
      "INSERT INTO lecture_access(user_id,lecture_id,starts_at,policy_version,expires_at) VALUES($1,$2,now(),1,now()+interval '1 day')",
      [reader.id, lectureId]
    );
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
  it('counts and reaches every course, including the last proposal in admin search', async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => domain.listLecturesPage(reader, { page }))
    );
    expect(pages[0]).toMatchObject({ total: 105, page: 1, pageSize: 30 });
    expect(new Set(pages.flatMap((page) => page.items.map((row) => row.id))).size).toBe(105);
    expect(pages[3].items).toHaveLength(15);
    const proposal = await domain.listLecturesPage(admin, {
      search: 'Missing course',
      includeProposals: true
    });
    expect(proposal.total).toBe(1);
    expect(proposal.items[0].id).toBe(proposalId);
    expect(
      (await domain.listLecturesPage(admin, { includeProposals: true, page: 4 })).items.some(
        (row) => row.id === proposalId
      )
    ).toBe(true);
    expect((await domain.getLecturesByIds(admin, [proposalId]))[0].id).toBe(proposalId);
    expect(await domain.listLecturesPage(reader, { onlyWithProtocols: true })).toMatchObject({
      total: 1
    });
    await expect(domain.listLecturesPage(reader, { includeProposals: true })).rejects.toMatchObject(
      { status: 403 }
    );
    const all = await domain.listLecturesPage(reader, { paginate: false });
    const comparable = (items: Record<string, any>[]) =>
      items.map((row) => ({
        ...row,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null
      }));
    expect(comparable(all.items)).toEqual(comparable(pages.flatMap((page) => page.items)));
    expect(
      comparable(
        (await domain.listLecturesPage(reader, { onlyWithProtocols: true, paginate: false })).items
      )
    ).toEqual(
      comparable((await domain.listLecturesPage(reader, { onlyWithProtocols: true })).items)
    );
  });
  it('filters pending proposals across the full catalogue before pagination', async () => {
    const pending = await domain.listLecturesPage(admin, {
      includeProposals: true,
      approvalStatus: 'pending',
      page: 4
    });
    expect(pending).toMatchObject({ page: 1, total: 1 });
    expect(pending.items.map((lecture) => lecture.id)).toEqual([proposalId]);
    const searched = await domain.listLecturesPage(admin, {
      includeProposals: true,
      approvalStatus: 'pending',
      search: 'Missing course'
    });
    expect(searched.items.map((lecture) => lecture.id)).toEqual([proposalId]);
    expect(
      (await domain.listLecturesPage(admin, { includeProposals: true, approvalStatus: 'approved' }))
        .total
    ).toBe(105);
  });
  it('pages and searches all administrator users with deterministic ordering and fresh authorization', async () => {
    await db.pool.query(`INSERT INTO "user"(id,name,email,"emailVerified")
      SELECT 'admin-page-'||n,'Admin pagination fixture','zxpag'||lpad(n::text,2,'0')||'@student.uni-tuebingen.de',true
      FROM generate_series(1,65) n`);
    await db.pool.query(`INSERT INTO ppi_user(user_id,status)
      SELECT id,'active' FROM "user" WHERE id LIKE 'admin-page-%'`);
    const pages = await Promise.all(
      [1, 2, 3].map((page) => domain.listAdminUsersPage(admin, { search: 'admin-page-', page }))
    );
    expect(pages[0]).toMatchObject({ total: 65, page: 1, pageSize: 30 });
    expect(new Set(pages.flatMap((page) => page.entries.map((row) => row.id))).size).toBe(65);
    expect(pages[2].entries).toHaveLength(5);
    expect((await domain.listAdminUsersPage(admin, { search: 'ZXPAG65' })).entries[0].id).toBe(
      'admin-page-65'
    );
    expect(
      (await domain.listAdminUsersPage(admin, { search: 'admin-page-', page: 999 })).page
    ).toBe(3);
    await expect(domain.listAdminUsersPage(reader)).rejects.toMatchObject({ status: 403 });
  });
  it('filters the complete review queue in SQL before pagination and keeps deleted files in all scope', async () => {
    await db.pool.query(`UPDATE submission SET review_state='awaiting_review'
      WHERE id IN (SELECT id FROM submission ORDER BY id LIMIT 65)`);
    const pages = await Promise.all(
      [1, 2, 3].map((page) => domain.listReviewQueuePage(admin, { page }))
    );
    expect(pages[0]).toMatchObject({ total: 65, page: 1, pageSize: 30 });
    expect(new Set(pages.flatMap((page) => page.entries.map((row) => row.id))).size).toBe(65);
    expect(pages.flatMap((page) => page.entries).map((row) => row.lecture_names)).toEqual(
      Array.from({ length: 65 }, () => ['Course 001'])
    );
    expect((await domain.listReviewQueuePage(admin, { search: 'COURSE 001' })).total).toBe(65);
    const last = pages[2].entries.at(-1)!;
    const found = await domain.listReviewQueuePage(admin, {
      search: last.original_name.toUpperCase(),
      page: 999
    });
    expect(found).toMatchObject({ total: 1, page: 1 });
    expect(found.entries[0].id).toBe(last.id);
    await db.pool.query('UPDATE submission SET files_deleted_at=now() WHERE id=$1', [last.id]);
    expect((await domain.listReviewQueuePage(admin)).total).toBe(64);
    expect(
      (await domain.listReviewQueuePage(admin, { includeAll: true, search: last.original_name }))
        .entries[0].files_deleted_at
    ).toBeTruthy();
    const summary = await domain.listReviewQueuePage(admin, { pageSize: 5 });
    expect(summary.entries).toHaveLength(5);
    expect(summary.total).toBe(64);
    await expect(domain.listReviewQueuePage(reader, { includeAll: true })).rejects.toMatchObject({
      status: 403
    });
    await db.pool.query('UPDATE submission SET files_deleted_at=NULL WHERE id=$1', [last.id]);
  });
  it('uses all current lecture names without duplicating multi-lecture queue entries', async () => {
    const uploader: Actor = {
      id: randomUUID(),
      email: 'zxque03@student.uni-tuebingen.de',
      isAdmin: false
    };
    await db.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
      uploader.id,
      'Queue title fixture',
      uploader.email
    ]);
    await domain.activateAccount(uploader.id);
    const second = await domain.createLecture(admin, `Queue second lecture ${randomUUID()}`);
    const input = {
      file: {
        storageKey: randomUUID(),
        sha256: 'a'.repeat(64),
        byteCount: 12,
        mediaType: 'text/plain' as const,
        originalName: 'queue-test.txt'
      },
      lectureIds: [lectureId, second.id],
      term: termOptions()[0].value,
      examDate: '2026-10-19',
      remarks: 'Queue title fixture',
      collaboratorZx: [],
      attested: true,
      requestKey: randomUUID()
    };
    const submitted = await domain.submitProtocol(uploader, input);
    const before = await domain.listReviewQueuePage(admin, { search: second.name });
    expect(before.total).toBe(1);
    expect(before.entries[0].id).toBe(submitted.submissionId);
    expect(before.entries[0].lecture_names).toEqual(['Course 001', second.name]);
    await domain.reviseProtocol(uploader, submitted.submissionId, {
      ...input,
      lectureIds: [second.id],
      requestKey: randomUUID(),
      file: { ...input.file, storageKey: randomUUID() }
    });
    const after = await domain.listReviewQueuePage(admin, { search: submitted.submissionId });
    expect(after.entries[0].lecture_names).toEqual([second.name]);
    expect((await domain.listReviewQueuePage(admin, { search: 'Course 001' })).total).toBe(65);
  });

  it('filters native token and report status and searches older records beyond the first page', async () => {
    await db.pool.query(
      `INSERT INTO token_request(user_id,explanation,status,created_at)
      SELECT $1,'admin token fixture '||n,CASE WHEN n=35 THEN 'denied' ELSE 'pending' END,
      now()-n*interval '1 minute' FROM generate_series(1,35) n`,
      [reader.id]
    );
    await db.pool.query(
      `INSERT INTO content_report(reporter_id,lecture_id,category,explanation,created_at)
      SELECT $1,$2,'metadata','admin report fixture '||n,now()-n*interval '1 minute'
      FROM generate_series(1,35) n`,
      [reader.id, lectureId]
    );
    const tokens = await listAdminEntries(admin, 'credits', {
      search: 'admin token fixture',
      scope: 'pending',
      page: 999
    });
    expect(tokens).toMatchObject({ total: 34, page: 2 });
    expect(tokens.entries).toHaveLength(4);
    expect(
      (
        await listAdminEntries(admin, 'credits', {
          search: 'admin token fixture 35',
          scope: 'pending'
        })
      ).total
    ).toBe(0);
    expect(
      (await listAdminEntries(admin, 'credits', { search: 'admin token fixture 35' })).total
    ).toBe(1);
    const reports = await listAdminEntries(admin, 'reports', {
      search: 'admin report fixture',
      scope: 'open',
      page: 2
    });
    expect(reports).toMatchObject({ total: 35, page: 2 });
    expect(reports.entries).toHaveLength(5);
    expect(reports.entries.at(-1).explanation).toBe('admin report fixture 35');
  });
  it('searches audit entries older than the first 100 and restricts pagination to admins', async () => {
    await db.pool.query(
      `INSERT INTO audit_event(actor_id,action,entity_id,detail,created_at)
      SELECT $1,'pagination.fixture',gen_random_uuid()::text,
      jsonb_build_object('message',CASE WHEN n=105 THEN 'Older audit target' ELSE 'Recent audit fixture' END),
      now()-n*interval '1 minute' FROM generate_series(1,105) n`,
      [admin.id]
    );
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) =>
        listAdminEntries(admin, 'audit', { search: 'pagination.fixture', page })
      )
    );
    expect(pages[0]).toMatchObject({ page: 1, pageSize: 30, total: 105 });
    expect(new Set(pages.flatMap((page) => page.entries.map((entry) => entry.id))).size).toBe(105);
    expect(pages[3].entries).toHaveLength(15);
    const target = await listAdminEntries(admin, 'audit', { search: 'OLDER AUDIT TARGET' });
    expect(target.total).toBe(1);
    expect(target.entries[0].id).toBe(pages[3].entries.at(-1)!.id);
    await expect(listAdminEntries(reader, 'audit')).rejects.toMatchObject({ status: 403 });
  });
  it('keeps the full token history accessible, ordered and scoped to the current account', async () => {
    const id = randomUUID();
    await db.pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Ledger fixture\',\'zxled01@student.uni-tuebingen.de\',true)',
      [id]
    );
    await domain.activateAccount(id);
    const actor = (await domain.getActor(id))!;
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,reason)
         SELECT $1,1,'manual_adjustment','ledger-fixture:'||n,1,'History fixture'
         FROM generate_series(1,105) n`,
        [id]
      );
      await client.query('UPDATE credit_account SET balance=balance+105 WHERE user_id=$1', [id]);
    });
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => domain.getCreditsDashboard(actor, page))
    );
    expect(pages[0].ledgerPagination).toEqual({ page: 1, total: 106, pageSize: 30 });
    const entries = pages.flatMap((page) => page.ledger);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(106);
    expect(entries.at(-1).kind).toBe('activation');
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(pages[0].balance);
    expect((await domain.getCreditsDashboard(actor, 2)).ledger.map((entry) => entry.id)).toEqual(
      pages[1].ledger.map((entry) => entry.id)
    );
    expect((await domain.getCreditsDashboard(actor, 999)).ledgerPagination.page).toBe(4);
    expect((await domain.getCreditsDashboard(reader)).ledgerPagination.total).toBe(1);
    await expect(domain.getCreditsDashboard(actor, 0)).rejects.toMatchObject({ status: 400 });
  });
  it('provides the true total and individual access to the oldest protocols beyond the ZIP limit', async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => domain.listPublishedProtocolsPage(reader, lectureId, page))
    );
    expect(pages[0]).toMatchObject({ total: 105, pageSize: 30 });
    expect(pages[0].items[0].original_name).toBe('protocol-104.txt');
    expect(new Set(pages.flatMap((page) => page.items.map((row) => row.id))).size).toBe(105);
    const oldest = pages[3].items.at(-1)!;
    expect(oldest.original_name).toBe('protocol-0.txt');
    expect(oldest.has_access).toBe(true);
    const download = await domain.getDownload(reader, oldest.revision_id);
    expect(download.originalName).toBe('protocol-0.txt');
    const lecture = await domain.getLecture(reader, lectureId, 4);
    expect(lecture.protocolsPage.total).toBe(105);
    expect(lecture.protocols).toHaveLength(15);
    expect((await domain.listPublishedProtocolsPage(reader, lectureId, 999)).page).toBe(4);
    await expect(domain.listPublishedProtocolsPage(reader, lectureId, 0)).rejects.toMatchObject({
      status: 400
    });
  });
  it('pages all own submissions with stable ties and excludes other uploaders', async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => domain.listOwnSubmissionsPage(admin, page))
    );
    expect(pages[0].pagination).toEqual({ page: 1, total: 106, pageSize: 30 });
    const submissions = pages.flatMap((page) => page.submissions);
    expect(new Set(submissions.map((submission) => submission.id)).size).toBe(106);
    expect(submissions.every((submission) => submission.uploader_id === admin.id)).toBe(true);
    expect(
      (await domain.listOwnSubmissionsPage(admin, 2)).submissions.map((row) => row.id)
    ).toEqual(pages[1].submissions.map((row) => row.id));
    expect((await domain.listOwnSubmissionsPage(admin, 999)).pagination.page).toBe(4);
    expect(await domain.listOwnSubmissionsPage(reader)).toEqual({
      submissions: [],
      pagination: { page: 1, total: 0, pageSize: 30 }
    });
    await expect(domain.listOwnSubmissionsPage(reader, 0)).rejects.toMatchObject({ status: 400 });
  });
  it('resolves only unambiguous legacy purchases for the correct account and timestamp', async () => {
    const reasons = ['Lecture access', 'Veranstaltungszugang', 'Recorded course name', ''];
    const entryIds: string[] = [];
    for (let index = 0; index < reasons.length; index++) {
      const timestamp = new Date(Date.UTC(2025, 0, index + 1));
      const entry = await db.pool.query(
        `INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,reason,created_at)
         VALUES($1,0,'purchase',$2,1,$3,$4) RETURNING id`,
        [reader.id, randomUUID(), reasons[index], timestamp]
      );
      entryIds.push(entry.rows[0].id);
      if (index < 3)
        await db.pool.query(
          `INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'lecture.purchased',$2,$3)`,
          [reader.id, lectureId, timestamp]
        );
      await db.pool.query(
        `INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'lecture.purchased',$2,$3)`,
        [admin.id, proposalId, timestamp]
      );
      if (index === 1)
        await db.pool.query(
          `INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'lecture.purchased',$2,$3)`,
          [reader.id, proposalId, timestamp]
        );
    }
    const dashboard = await domain.getCreditsDashboard(reader);
    expect(
      entryIds.map((id) => dashboard.ledger.find((entry) => entry.id === id).lecture_name)
    ).toEqual(['Course 001', null, 'Recorded course name', null]);
    expect(dashboard.ledger.reduce((sum, entry) => sum + entry.amount, 0)).toBe(dashboard.balance);
    expect(dashboard.access.map((access) => access.lecture_id)).toEqual([lectureId]);
  });
  it('attaches ordered moderation history to its revision and protects private notes', async () => {
    const submissionId = randomUUID();
    const revisionIds = [randomUUID(), randomUUID(), randomUUID()];
    await db.transaction(async (client) => {
      await client.query(
        'INSERT INTO submission(id,uploader_id,current_revision_id) VALUES($1,$2,$3)',
        [submissionId, reader.id, revisionIds[2]]
      );
      for (let index = 0; index < revisionIds.length; index++) {
        const fileId = randomUUID();
        await client.query(
          `INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name)
           VALUES($1,$2,$3,12,'text/plain','history.txt')`,
          [fileId, randomUUID(), 'b'.repeat(64)]
        );
        await client.query(
          `INSERT INTO submission_revision(id,submission_id,revision_number,file_id,remarks,attested)
           VALUES($1,$2,$3,$4,'History fixture',true)`,
          [revisionIds[index], submissionId, index + 1, fileId]
        );
        if (index === 2) continue;
        for (const day of [2, 1]) {
          const decision = await client.query(
            `INSERT INTO moderation_decision(revision_id,actor_id,outcome,public_feedback,internal_note,created_at)
             VALUES($1,$2,'changes_requested',$3,'Private note',$4) RETURNING id`,
            [
              revisionIds[index],
              admin.id,
              `revision ${index + 1} day ${day}`,
              new Date(Date.UTC(2025, 0, day))
            ]
          );
          await client.query(
            `INSERT INTO reconsideration(submission_id,revision_id,decision_id,requester_id,explanation,created_at)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [
              submissionId,
              revisionIds[index],
              decision.rows[0].id,
              reader.id,
              `revision ${index + 1} day ${day}`,
              new Date(Date.UTC(2025, 0, day))
            ]
          );
        }
      }
    });
    const ownerView = await domain.getSubmission(reader, submissionId);
    expect(ownerView.revisions.map((revision: { id: string }) => revision.id)).toEqual(
      [...revisionIds].reverse()
    );
    expect(ownerView.revisions[0].decisions).toEqual([]);
    expect(ownerView.revisions[0].reconsiderations).toEqual([]);
    for (const revision of ownerView.revisions.slice(1)) {
      const expected = [1, 2].map((day) => `revision ${revision.revision_number} day ${day}`);
      expect(
        revision.decisions.map((decision: { public_feedback: string }) => decision.public_feedback)
      ).toEqual(expected);
      expect(
        revision.reconsiderations.map((request: { explanation: string }) => request.explanation)
      ).toEqual(expected);
      expect(revision.decisions.every((decision: object) => !('internal_note' in decision))).toBe(
        true
      );
    }
    const adminView = await domain.getSubmission(admin, submissionId);
    expect(
      adminView.revisions[1].decisions.every(
        (decision: { internal_note: string }) => decision.internal_note === 'Private note'
      )
    ).toBe(true);
    const otherSubmission = (await domain.listOwnSubmissionsPage(admin)).submissions[0];
    await expect(domain.getSubmission(reader, otherSubmission.id)).rejects.toMatchObject({
      status: 404
    });
  });
});
