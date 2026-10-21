import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { pool } from '../../src/lib/server/db.js';
import * as domain from '../../src/lib/server/domain/index.js';
import * as archives from '../../src/lib/server/archives.js';
import { storeUpload } from '../../src/lib/server/storage.js';
import { termOptions } from '../../src/lib/terms.js';
import { login, password } from './support.js';

test.afterAll(() => pool.end());

async function account(zx: string) {
  return (
    await pool.query('SELECT id FROM "user" WHERE email=$1', [`${zx}@student.uni-tuebingen.de`])
  ).rows[0].id as string;
}

async function emailLink(zx: string, marker: string) {
  const email = `${zx}@student.uni-tuebingen.de`;
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            'SELECT count(*)::integer n FROM email_outbox WHERE recipient=$1 AND strpos(body,$2)>0',
            [email, marker]
          )
        ).rows[0].n
    )
    .toBeGreaterThan(0);
  const body = (
    await pool.query(
      'SELECT body FROM email_outbox WHERE recipient=$1 AND strpos(body,$2)>0 ORDER BY created_at DESC LIMIT 1',
      [email, marker]
    )
  ).rows[0].body as string;
  return body.match(/http:\/\/[^\s]+/)![0];
}

test('registration, email verification, password reset and immediate account deletion', async ({
  page
}) => {
  await page.goto('/register');
  await page.getByLabel('zx-Kennung').fill('zxbrw01');
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByRole('status')).toContainText('Bestätigungs-E-Mail');
  const verify = await emailLink('zxbrw01', '/verify-email?');
  await page.goto(verify);
  await login(page, 'zxbrw01');
  const id = await account('zxbrw01');
  await page.goto('/forgot-password');
  await page.getByLabel('zx-Kennung').fill('zxbrw01');
  await page.getByRole('button', { name: 'Link anfordern' }).click();
  await expect(page.getByRole('status')).toContainText('Zurücksetzen');
  await page.goto(await emailLink('zxbrw01', '/reset-password/'));
  const changed = 'Browser-reset-fixture-2026!';
  await page.locator('#password').fill(changed);
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Passwort wurde geändert');
  await login(page, 'zxbrw01', changed);
  expect(await account('zxbrw01')).toBe(id);
  expect(
    (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [id])).rows[0].balance
  ).toBe(5);
  await page.goto('/account');
  await page.locator('summary').filter({ hasText: 'Konto löschen' }).click();
  await page.getByLabel('Zur Bestätigung LÖSCHEN eingeben').fill('LÖSCHEN');
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const deleted = (
    await pool.query(
      'SELECT p.status,u.email FROM ppi_user p JOIN "user" u ON u.id=p.user_id WHERE p.user_id=$1',
      [id]
    )
  ).rows[0];
  expect(deleted.status).toBe('deleted');
  expect(deleted.email).toMatch(/@accounts\.invalid$/);
  expect(
    (await pool.query('SELECT count(*)::integer n FROM account WHERE "userId"=$1', [id])).rows[0].n
  ).toBe(0);
});

test('student uploads, admin approves with the default reward, student purchases and downloads', async ({
  page,
  browser
}) => {
  await login(page, 'zxbrw02');
  await page.goto('/upload');
  await page.locator('input[type=file]').setInputFiles({
    name: 'wrong.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('blocked')
  });
  await expect(page.getByRole('alert')).toHaveText('Nur PDF- und TXT-Dateien sind erlaubt.');
  expect(await page.locator('input[type=file]').inputValue()).toBe('');
  const text = 'Synthetic browser protocol. This file contains invented test data only.\n';
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'protocol.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('combobox', { name: 'Vorlesung suchen' }).fill('Browser test lecture');
  await page.getByRole('option', { name: 'Browser test lecture', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Prüfende Person', exact: true })
    .fill('Browser Examiner');
  await page.locator('#term').selectOption({ index: 1 });
  await page.locator('#examDate').fill('2026-10-20');
  await page.getByLabel('Ich habe an diesem Protokoll mitgewirkt und darf es teilen.').check();
  await page.getByRole('button', { name: 'Protokoll hochladen', exact: true }).click();
  await expect(page).toHaveURL(/\/submissions\/[a-f0-9-]+$/);
  const submissionId = new URL(page.url()).pathname.split('/').at(-1)!;
  const admin = (await domain.getActor(await account('zxbrw00')))!;
  let submission = await domain.getSubmission(admin, submissionId);
  const revision = submission.revisions[0];
  // Background safety results are deterministic fixtures; publication still uses the real review UI.
  await domain.completeFileCheck({
    fileId: revision.file_id,
    generation: 1,
    status: 'clean',
    detail: 'Browser test fixture.'
  });
  const context = await browser.newContext();
  const adminPage = await context.newPage();
  await login(adminPage, 'zxbrw00');
  await adminPage.goto(`/admin/review/${submissionId}`);
  const decision = adminPage.locator('form[action*="/decide"]');
  await expect(decision.locator('[name=reward]')).toHaveValue('base');
  await decision.locator('[name=confirmed]').check();
  await decision.getByRole('button', { name: 'Entscheidung speichern', exact: true }).click();
  await expect
    .poll(async () => (await domain.getSubmission(admin, submissionId)).visibility)
    .toBe('published');
  submission = await domain.getSubmission(admin, submissionId);
  const lectureId = submission.revisions[0].lecture_ids[0];
  await page.goto(`/lectures/${lectureId}`);
  await page.getByRole('button', { name: 'Zugang freischalten', exact: true }).click();
  await expect(page.getByText('Freigeschaltet', { exact: true })).toBeVisible();
  const studentId = await account('zxbrw02');
  expect(
    (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [studentId])).rows[0]
      .balance
  ).toBe(7);
  const fileDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Protokoll herunterladen', exact: true }).click();
  const downloaded = await fileDownload;
  expect(await readFile((await downloaded.path())!, 'utf8')).toContain(text.trim());
  const queued = (
    await pool.query(
      'SELECT id FROM lecture_archive WHERE requester_id=$1 AND lecture_id=$2 ORDER BY created_at DESC LIMIT 1',
      [studentId, lectureId]
    )
  ).rows[0];
  await archives.prepareArchive(queued.id);
  await page.reload();
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await zipDownload).suggestedFilename()).toBe('Browser test lecture.zip');
  await adminPage.goto('/admin/users');
  await adminPage.locator('select[name=role]').selectOption('admin');
  await expect(adminPage.locator('.account-card h2')).toHaveText(['zxbrw00']);
  await adminPage.locator('select[name=role]').selectOption('');
  await adminPage.locator('select[name=status]').selectOption('unverified');
  await expect(adminPage.locator('.account-card h2')).toHaveText(['zxbrw04']);
  await adminPage.locator('select[name=status]').selectOption('');
  await adminPage.getByRole('searchbox').fill('zxbrw02');
  await adminPage.getByRole('link', { name: 'Beiträge und Zugänge', exact: true }).click();
  await expect(
    adminPage.getByRole('heading', { name: 'Eingereichte Protokolle (1)' })
  ).toBeVisible();
  await expect(adminPage.getByRole('heading', { name: 'Veranstaltungszugänge (1)' })).toBeVisible();
  await context.close();
});

test('blocking a signed-in student revokes individual and cached ZIP downloads', async ({
  page,
  browser
}) => {
  const admin = (await domain.getActor(await account('zxbrw00')))!;
  const student = (await domain.getActor(await account('zxbrw03')))!;
  const lecture = (
    await pool.query('SELECT id FROM lecture WHERE name=$1', ['Browser test lecture'])
  ).rows[0];
  const uploaded = await domain.submitProtocol(student, {
    file: await storeUpload(
      new File(['Synthetic blocked-access protocol.'], 'blocked.txt', { type: 'text/plain' }),
      student.id
    ),
    lectureIds: [lecture.id],
    examinerName: 'Browser Examiner',
    term: termOptions()[0].value,
    examDate: '2026-10-20',
    remarks: '',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  });
  let submission = await domain.getSubmission(admin, uploaded.submissionId);
  await domain.completeFileCheck({
    fileId: submission.revisions[0].file_id,
    generation: 1,
    status: 'clean',
    detail: 'Browser fixture.'
  });
  submission = await domain.getSubmission(admin, uploaded.submissionId);
  await domain.decideSubmission(admin, {
    revisionId: uploaded.revisionId,
    expectedVersion: submission.version,
    outcome: 'accepted',
    reward: 'none',
    publicFeedback: 'Synthetic fixture.',
    requestKey: randomUUID()
  });
  const archive = await archives.requestArchive(student, lecture.id);
  await archives.prepareArchive(archive.id);
  await login(page, 'zxbrw03');
  expect((await page.request.get(`/files/${uploaded.revisionId}`)).status()).toBe(200);
  expect((await page.request.get(`/archives/${archive.id}/download`)).status()).toBe(200);
  const context = await browser.newContext();
  const adminPage = await context.newPage();
  await login(adminPage, 'zxbrw00');
  await adminPage.goto('/admin/users?q=zxbrw03');
  const card = adminPage.locator('.account-card');
  await card.getByText('Konto und Rechte verwalten', { exact: true }).click();
  const status = card.locator('form[action*="/status"]');
  await status.getByRole('checkbox').check();
  await status.getByRole('button', { name: 'Konto sperren', exact: true }).click();
  await expect(adminPage.getByRole('status')).toContainText('Kontostatus wurde aktualisiert');
  for (const path of [`/files/${uploaded.revisionId}`, `/archives/${archive.id}/download`]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  }
  await page.goto(`/lectures/${lecture.id}`);
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});

test('an admin can approve a retained protocol after its uploader deletes their account', async ({
  page
}) => {
  const admin = (await domain.getActor(await account('zxbrw00')))!;
  const id = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    id,
    'Deleted uploader fixture',
    'zxbrw05@student.uni-tuebingen.de'
  ]);
  await domain.activateAccount(id);
  const contributor = (await domain.getActor(id))!;
  const lecture = (
    await pool.query('SELECT id FROM lecture WHERE name=$1', ['Browser test lecture'])
  ).rows[0];
  const uploaded = await domain.submitProtocol(contributor, {
    file: await storeUpload(
      new File(['Synthetic retained protocol.'], 'retained.txt', { type: 'text/plain' }),
      id
    ),
    lectureIds: [lecture.id],
    examinerName: 'Browser Examiner',
    term: termOptions()[0].value,
    examDate: '2026-10-20',
    remarks: '',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  });
  const submitted = await domain.getSubmission(admin, uploaded.submissionId);
  await domain.completeFileCheck({
    fileId: submitted.revisions[0].file_id,
    generation: 1,
    status: 'clean',
    detail: 'Browser fixture.'
  });
  await domain.requestAccountDeletion(contributor);
  const active = (await domain.getActor(await account('zxbrw02')))!;
  const preceding = await domain.submitProtocol(active, {
    file: await storeUpload(
      new File(['Synthetic next-review protocol.'], 'next.txt', { type: 'text/plain' }),
      active.id
    ),
    lectureIds: [lecture.id],
    examinerName: 'Browser Examiner',
    term: termOptions()[0].value,
    examDate: '2026-10-20',
    remarks: '',
    collaboratorZx: [],
    attested: true,
    requestKey: randomUUID()
  });
  const previous = await domain.getSubmission(admin, preceding.submissionId);
  await domain.completeFileCheck({
    fileId: previous.revisions[0].file_id,
    generation: 1,
    status: 'clean',
    detail: 'Browser fixture.'
  });
  await login(page, 'zxbrw00');
  await page.goto(`/admin/review/${preceding.submissionId}`);
  const firstDecision = page.locator('form[action*="/decide"]');
  await expect(firstDecision.locator('select[name=reward]')).toHaveValue('base');
  await firstDecision.locator('[name=confirmed]').check();
  await firstDecision.getByRole('button', { name: 'Entscheidung speichern', exact: true }).click();
  await page.getByRole('link', { name: 'Nächstes Protokoll', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/review/${uploaded.submissionId}$`));
  const decision = page.locator('form[action*="/decide"]');
  await expect(decision.locator('select[name=reward]')).toBeDisabled();
  await expect(decision.locator('input[name=reward]')).toHaveValue('none');
  await decision.locator('[name=confirmed]').check();
  await decision.getByRole('button', { name: 'Entscheidung speichern', exact: true }).click();
  await expect
    .poll(async () => (await domain.getSubmission(admin, uploaded.submissionId)).visibility)
    .toBe('published');
  expect(
    (await pool.query('SELECT balance FROM credit_account WHERE user_id=$1', [id])).rows[0].balance
  ).toBe(5);
});
