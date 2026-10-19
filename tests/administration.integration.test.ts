import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/server/domain';
import { termOptions } from '../src/lib/terms';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'Administrative file deletion and statistics',
  () => {
    const schema = `admin_test_${randomUUID().replaceAll('-', '')}`;
    let root: pg.Pool, pool: pg.Pool, directory: string;
    let domain: typeof import('../src/lib/server/domain');
    let storage: typeof import('../src/lib/server/storage');
    let archives: typeof import('../src/lib/server/archives');
    let deletion: typeof import('../src/lib/server/deletion');
    let statistics: typeof import('../src/lib/server/statistics');
    let admin: Actor, student: Actor;
    let submissionId: string,
      revisionIds: string[],
      fileKeys: string[],
      archiveId: string,
      archiveKey: string,
      version: number,
      balance: number;

    beforeAll(async () => {
      root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
      await root.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      process.env.DATABASE_URL = url.toString();
      directory = await mkdtemp(join(tmpdir(), 'ppi-administration-test-'));
      process.env.UPLOAD_DIR = directory;
      ({ pool } = await import('../src/lib/server/db'));
      for (const name of (await readdir('migrations'))
        .filter((name) => name.endsWith('.sql'))
        .sort())
        await pool.query(await readFile(`migrations/${name}`, 'utf8'));
      domain = await import('../src/lib/server/domain');
      storage = await import('../src/lib/server/storage');
      archives = await import('../src/lib/server/archives');
      deletion = await import('../src/lib/server/deletion');
      statistics = await import('../src/lib/server/statistics');
      for (const [email, isAdmin] of [
        ['zxdel01@student.uni-tuebingen.de', true],
        ['zxdel02@student.uni-tuebingen.de', false]
      ] as const) {
        const id = randomUUID();
        await pool.query(
          'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
          [id, 'Synthetic administration test', email]
        );
        await domain.activateAccount(id);
        await pool.query('UPDATE ppi_user SET is_admin=$2 WHERE user_id=$1', [id, isAdmin]);
        if (isAdmin) admin = (await domain.getActor(id))!;
        else student = (await domain.getActor(id))!;
      }
      const lecture = await domain.createLecture(admin, 'Deletion test lecture');
      await domain.purchaseLectureAccess(student, lecture.id, randomUUID());
      const first = await storage.storeUpload(new File(['Synthetic first version.'], 'first.txt'));
      const input = {
        file: first,
        lectureIds: [lecture.id],
        term: termOptions()[0].value,
        remarks: 'Synthetic deletion fixture.',
        collaboratorZx: [],
        attested: true,
        requestKey: randomUUID()
      };
      const submitted = await domain.submitProtocol(student, input);
      submissionId = submitted.submissionId;
      let current = await domain.getSubmission(admin, submissionId);
      await domain.completeFileCheck({
        fileId: current.revisions[0].file_id,
        generation: 1,
        status: 'clean',
        detail: 'Synthetic test.'
      });
      current = await domain.getSubmission(admin, submissionId);
      const preview = await domain.getRewardPreview(admin, submitted.revisionId, 'base');
      await domain.decideSubmission(admin, {
        revisionId: submitted.revisionId,
        expectedVersion: current.version,
        outcome: 'accepted',
        reward: 'base',
        rewardPolicyVersion: preview.policyVersion,
        rewardRecipientIds: preview.recipientIds,
        publicFeedback: 'Synthetic accepted protocol.',
        requestKey: randomUUID()
      });
      archiveId = (await archives.requestArchive(student, lecture.id)).id;
      await archives.prepareArchive(archiveId);
      archiveKey = (await archives.getArchiveDownload(student, archiveId)).storageKey;
      const second = await storage.storeUpload(
        new File(['Synthetic improved version.'], 'second.txt')
      );
      const revised = await domain.reviseProtocol(student, submissionId, {
        ...input,
        file: second,
        requestKey: randomUUID()
      });
      current = await domain.getSubmission(admin, submissionId);
      version = current.version;
      revisionIds = [submitted.revisionId, revised.revisionId];
      fileKeys = [first.storageKey, second.storageKey];
      balance = (await domain.getCreditsDashboard(student)).balance;
    });

    afterAll(async () => {
      await pool?.end();
      await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root?.end();
      if (directory) {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        await rm(directory, { recursive: true, force: true });
      }
    });

    it('counts actionable overview items and excludes processing from ready reviews', async () => {
      await expect(
        statistics.getAdminOverview({ ...student, isAdmin: true })
      ).rejects.toMatchObject({ status: 403 });
      const before = await statistics.getAdminOverview(admin);
      expect(before).toMatchObject({ processing: 1, uploadsWeek: 1, activationsWeek: 2 });
      expect((await domain.listReviewQueuePage(admin, { readyOnly: true })).total).toBe(0);
      const report = (
        await pool.query(
          "INSERT INTO content_report(reporter_id,submission_id,category,explanation) VALUES($1,$2,'other','Overview fixture') RETURNING id",
          [student.id, submissionId]
        )
      ).rows[0].id;
      const request = (
        await pool.query(
          "INSERT INTO token_request(user_id,explanation) VALUES($1,'Overview fixture') RETURNING id",
          [student.id]
        )
      ).rows[0].id;
      const lecture = (
        await pool.query(
          "INSERT INTO lecture(name,normalized_name,approval_status) VALUES('Overview fixture','overview fixture','pending') RETURNING id"
        )
      ).rows[0].id;
      const after = await statistics.getAdminOverview(admin);
      expect(after.openReports).toBe(before.openReports + 1);
      expect(after.pendingTokens).toBe(before.pendingTokens + 1);
      expect(after.pendingLectures).toBe(before.pendingLectures + 1);
      await pool.query('DELETE FROM content_report WHERE id=$1', [report]);
      await pool.query('DELETE FROM token_request WHERE id=$1', [request]);
      await pool.query('DELETE FROM lecture WHERE id=$1', [lecture]);
    });

    it('blocks the owner and cached downloads without changing ownership, rewards or purchased access', async () => {
      const storedBalance = (
        await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [student.id])
      ).rows[0].balance;
      const accessBefore = (
        await pool.query('SELECT * FROM lecture_access WHERE user_id=$1', [student.id])
      ).rows;
      await domain.setAccountStatus(admin, student.id, 'suspended');
      await expect(domain.getDownload(student, revisionIds[0])).rejects.toMatchObject({
        status: 403
      });
      await expect(archives.getArchiveDownload(student, archiveId)).rejects.toMatchObject({
        status: 403
      });
      expect((await domain.getDownload(admin, revisionIds[0])).storageKey).toBe(fileKeys[0]);
      expect((await domain.getSubmission(admin, submissionId)).uploader_id).toBe(student.id);
      expect(
        (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [student.id]))
          .rows[0].balance
      ).toBe(storedBalance);
      expect(
        (await pool.query('SELECT * FROM lecture_access WHERE user_id=$1', [student.id])).rows
      ).toEqual(accessBefore);
      await domain.setAccountStatus(admin, student.id, 'active');
      expect((await domain.getDownload(student, revisionIds[0])).storageKey).toBe(fileKeys[0]);
      expect((await archives.getArchiveDownload(student, archiveId)).storageKey).toBe(archiveKey);
    });

    it('rejects student escalation and stale deletion without changing files', async () => {
      await expect(
        deletion.requestProtocolFileDeletion(
          { ...student, isAdmin: true },
          { submissionId, expectedVersion: version, reason: 'Unauthorized test.' }
        )
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        deletion.requestProtocolFileDeletion(admin, {
          submissionId,
          expectedVersion: version - 1,
          reason: 'Stale test.'
        })
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await pool.query('SELECT files_deleted_at FROM submission WHERE id=$1', [submissionId]))
          .rows[0].files_deleted_at
      ).toBe(null);
      for (const key of [...fileKeys, archiveKey])
        expect((await stat(storage.filePath(key))).size).toBeGreaterThan(0);
    });

    it('blocks every file and cached archive immediately while retaining metadata and rewards', async () => {
      const accessBefore = (
        await pool.query('SELECT * FROM lecture_access WHERE user_id=$1', [student.id])
      ).rows;
      await deletion.requestProtocolFileDeletion(admin, {
        submissionId,
        expectedVersion: version,
        reason: 'Remove synthetic files while preserving history.'
      });
      for (const actor of [admin, student])
        for (const id of revisionIds)
          await expect(domain.getDownload(actor, id)).rejects.toMatchObject({ status: 404 });
      await expect(archives.getArchiveDownload(student, archiveId)).rejects.toMatchObject({
        status: 410
      });
      expect((await domain.getSubmission(admin, submissionId)).revisions).toHaveLength(2);
      expect((await domain.getCreditsDashboard(student)).balance).toBe(balance);
      expect(
        (await pool.query('SELECT * FROM lecture_access WHERE user_id=$1', [student.id])).rows
      ).toEqual(accessBefore);
      expect(
        (await pool.query('SELECT count(*)::integer AS count FROM moderation_decision')).rows[0]
          .count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::integer AS count FROM reward_allocation')).rows[0].count
      ).toBe(1);
      for (const key of [...fileKeys, archiveKey])
        expect((await stat(storage.filePath(key))).size).toBeGreaterThan(0);
      await deletion.requestProtocolFileDeletion(admin, {
        submissionId,
        expectedVersion: version,
        reason: 'Idempotent retry.'
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM core_job WHERE type='delete_files'"
          )
        ).rows[0].count
      ).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM audit_event WHERE action='submission.files_deleted'"
          )
        ).rows[0].count
      ).toBe(1);
    });

    it('physically removes all revision files and cached ZIPs with idempotent cleanup', async () => {
      await deletion.cleanupDeletedProtocolFiles(submissionId);
      await deletion.cleanupDeletedProtocolFiles(submissionId);
      for (const key of [...fileKeys, archiveKey])
        await expect(stat(storage.filePath(key))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        (await pool.query('SELECT count(*)::integer AS count FROM stored_file')).rows[0].count
      ).toBe(2);
      expect(
        (await pool.query('SELECT count(*)::integer AS count FROM submission_revision')).rows[0]
          .count
      ).toBe(2);
      expect((await domain.getCreditsDashboard(student)).balance).toBe(balance);
    });

    it('restricts statistics to current admins and counts only the requested thirty-day audit window', async () => {
      await expect(
        statistics.getAdminStatisticsPeriods({ ...student, isAdmin: true })
      ).rejects.toMatchObject({ status: 403 });
      await pool.query(
        "INSERT INTO audit_event(actor_id,action,entity_id) VALUES($1,'auth.login',$2)",
        [student.id, randomUUID()]
      );
      await pool.query(
        "INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'auth.login',$2,now()-interval '40 days')",
        [student.id, randomUUID()]
      );
      const result = (await statistics.getAdminStatisticsPeriods(admin))['30d'];
      expect(result.series).toHaveLength(30);
      expect(result.totals.logins).toBe(1);
      expect(result.totals.submissions).toBe(1);
      expect(result.totals.decisions).toBe(1);
      expect(result.series.reduce((sum, day) => sum + day.events, 0)).toBe(result.totals.events);
      expect(result.timezone).toBe('Europe/Berlin');
    });

    it('returns cumulative registered zx users and protocol totals for every period', async () => {
      await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)`, [
        randomUUID(),
        'Unverified statistics fixture',
        'zxsta99@student.uni-tuebingen.de'
      ]);
      const periods = await statistics.getAdminStatisticsPeriods(admin);
      for (const range of ['30d', '6m', '1y', 'max'] as const) {
        const result = periods[range];
        expect(result.series.length).toBeGreaterThan(0);
        expect(result.series.at(-1)?.cumulativeRegisteredUsers).toBe(
          (
            await pool.query(
              `SELECT count(*)::integer AS count FROM "user"
               WHERE email ~ '^zx[a-z]{3}[0-9]{2}@student[.]uni-tuebingen[.]de$'
                 AND "createdAt"<((($1::date+1)::timestamp) AT TIME ZONE 'Europe/Berlin')`,
              [result.endDate]
            )
          ).rows[0].count
        );
        expect(result.series.at(-1)?.cumulativeSubmittedProtocols).toBe(
          (
            await pool.query(
              `SELECT count(*)::integer AS count FROM submission
               WHERE created_at<((($1::date+1)::timestamp) AT TIME ZONE 'Europe/Berlin')`,
              [result.endDate]
            )
          ).rows[0].count
        );
        expect(
          result.series.every(
            (point, index, series) =>
              index === 0 ||
              (point.cumulativeRegisteredUsers >= series[index - 1].cumulativeRegisteredUsers &&
                point.cumulativeSubmittedProtocols >=
                  series[index - 1].cumulativeSubmittedProtocols)
          )
        ).toBe(true);
      }
    });

    it('aggregates longer recorded history without a large daily payload', async () => {
      const periods = await statistics.getAdminStatisticsPeriods(admin);
      const months = periods['6m'];
      expect(months.series.length).toBeGreaterThan(150);
      expect(months.series.length).toBeLessThanOrEqual(185);
      expect(months.totals.logins).toBe(2);
      const year = periods['1y'];
      expect(year.series.length).toBeGreaterThanOrEqual(365);
      expect(year.series.length).toBeLessThanOrEqual(366);
      expect(year.granularity).toBe('day');
      await pool.query(
        "INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'auth.login',$2,now()-interval '2 years')",
        [student.id, randomUUID()]
      );
      const all = (await statistics.getAdminStatisticsPeriods(admin)).max;
      expect(all.granularity).toBe('month');
      expect(all.series.length).toBeLessThanOrEqual(26);
      expect(all.totals.logins).toBe(3);
      await pool.query(
        "INSERT INTO audit_event(actor_id,action,entity_id,created_at) VALUES($1,'auth.login',$2,now()-interval '25 years')",
        [student.id, randomUUID()]
      );
      const long = (await statistics.getAdminStatisticsPeriods(admin)).max;
      expect(long.granularity).toBe('year');
      expect(long.series.length).toBeLessThanOrEqual(27);
      expect(long.totals.logins).toBe(4);
    });

    it('keeps Berlin midnight boundaries when aggregating all periods together', async () => {
      await pool.query('DELETE FROM audit_event');
      await pool.query(
        `WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS day)
         INSERT INTO audit_event(actor_id,action,entity_id,created_at)
         SELECT $1,'auth.login',$2,boundary FROM today CROSS JOIN LATERAL (
           VALUES (((day-29)::timestamp AT TIME ZONE 'Europe/Berlin')-interval '1 microsecond'),
             ((day-29)::timestamp AT TIME ZONE 'Europe/Berlin'),
             (((day+1)::timestamp AT TIME ZONE 'Europe/Berlin')-interval '1 microsecond'),
             ((day+1)::timestamp AT TIME ZONE 'Europe/Berlin')
         ) AS events(boundary)`,
        [student.id, randomUUID()]
      );
      const periods = await statistics.getAdminStatisticsPeriods(admin);
      expect(periods['30d'].totals.logins).toBe(2);
      expect(periods['30d'].series[0].logins).toBe(1);
      expect(periods['30d'].series.at(-1)?.logins).toBe(1);
      expect(periods['6m'].totals.logins).toBe(3);
    });
  }
);
