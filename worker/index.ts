import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import nodemailer from 'nodemailer';
import { renderEmailHtml } from '../src/lib/server/email.js';
import { pool, transaction } from '../src/lib/server/db.js';
import { completeFileCheck, processPeriodicGrant } from '../src/lib/server/domain/index.js';
import {
  cleanupExpiredAuthData,
  currentGrantPeriod,
  dispatchOutbox,
  getBoss,
  queueNames
} from '../src/lib/server/jobs.js';
import { detectFile, filePath, readStoredFile } from '../src/lib/server/storage.js';
import { cleanupExpiredArchives, prepareArchive } from '../src/lib/server/archives.js';
import { cleanupDeletedProtocolFiles } from '../src/lib/server/deletion.js';
import { analyzeFileContent, markContentCheckFailed } from '../src/lib/server/content-checks.js';
import { processPdfOcr } from '../src/lib/server/pdf-processing.js';

const development = process.env.FILE_SCAN_MODE === 'development';
assert(
  !development || process.env.NODE_ENV === 'development',
  'Development file checks are forbidden outside development.'
);
assert(process.env.SMTP_HOST, 'SMTP_HOST is required.');
assert(
  !development || ['localhost', '127.0.0.1', 'mail'].includes(process.env.SMTP_HOST),
  'Development mail must go to a local inbox.'
);
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  requireTLS: Boolean(process.env.SMTP_USER),
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined,
  connectionTimeout: 15000,
  socketTimeout: 30000,
  disableFileAccess: true,
  disableUrlAccess: true
});
const boss = await getBoss();
const workerId = randomUUID();
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

function scan(path: string): Promise<'clean' | 'blocked'> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.CLAMSCAN_PATH ?? 'clamscan',
      ['--no-summary', path],
      { timeout: 120000, maxBuffer: 65536, windowsHide: true },
      (error) => {
        if (!error) return resolve('clean');
        if (error.code === 1) return resolve('blocked');
        reject(new Error('The virus scanner is unavailable or failed.'));
      }
    );
  });
}
async function verifyScannerDatabase() {
  const version = await new Promise<string>((resolve, reject) => {
    execFile(
      process.env.CLAMSCAN_PATH ?? 'clamscan',
      ['--version'],
      { timeout: 10000, maxBuffer: 8192, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))
    );
  });
  const signatureDate = version.match(/\/\d+\/(.+)$/)?.[1];
  const timestamp = signatureDate ? Date.parse(signatureDate) : NaN;
  if (!Number.isFinite(timestamp)) throw new Error('Virus signature date is unavailable.');
  if (Date.now() - timestamp > 7 * 86400000 || timestamp > Date.now() + 3600000)
    throw new Error(
      'Virus signatures are stale or have an invalid date. Update ClamAV before processing files.'
    );
  return version;
}
function inspectPdf(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.PDFINFO_PATH ?? 'pdfinfo',
      [path],
      { timeout: 15000, maxBuffer: 65536, windowsHide: true },
      (error, stdout) => {
        if (error) return reject(new Error('PDF structure check failed.'));
        const pages = Number([...stdout.matchAll(/^Pages:\s+(\d+)/gm)].at(-1)?.[1]);
        if (
          !Number.isInteger(pages) ||
          pages < 1 ||
          pages > 50 ||
          /^Encrypted:\s+yes/m.test(stdout)
        )
          return reject(new Error('PDF must be unencrypted and contain between 1 and 50 pages.'));
        resolve();
      }
    );
  });
}
async function handleFile(data: Record<string, unknown>) {
  const file = (await pool.query('SELECT * FROM stored_file WHERE id=$1', [data.fileId])).rows[0];
  assert(file, 'Stored file missing');
  if (
    file.safety_generation !== data.generation ||
    file.safety_status === 'clean' ||
    file.safety_status === 'blocked'
  )
    return;
  const bytes = await readStoredFile(file.storage_key);
  assert.equal(bytes.length, file.byte_count, 'Stored file size changed');
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.sha256,
    'Stored file hash changed'
  );
  const detected = detectFile(bytes, file.original_name);
  assert.equal(detected, file.media_type, 'Stored file type changed');
  if (!development && detected === 'application/pdf') await inspectPdf(filePath(file.storage_key));
  const scanner = development ? '' : await verifyScannerDatabase();
  const status = development ? 'clean' : await scan(filePath(file.storage_key));
  await completeFileCheck({
    fileId: file.id,
    generation: Number(data.generation),
    status,
    detail: development
      ? 'Development fixture check; no antivirus scan.'
      : status === 'clean'
        ? `Technical checks passed. ${scanner}`
        : 'File blocked by antivirus.'
  });
}
async function sendNotification(data: Record<string, unknown>) {
  let mail: { id: string; recipient: string; subject: string; body: string };
  if (data.emailId) {
    const item = (
      await pool.query(
        'SELECT * FROM email_outbox WHERE id=$1 AND sent_at IS NULL AND expires_at>now()',
        [data.emailId]
      )
    ).rows[0];
    if (!item) return;
    mail = item;
  } else {
    const item = (
      await pool.query(
        'SELECT n.id,u.email AS recipient,n.subject,n.message AS body FROM notification n JOIN "user" u ON u.id=n.user_id WHERE n.id=$1',
        [data.notificationId]
      )
    ).rows[0];
    assert(item, 'Notification missing');
    mail = item;
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? 'PPI <ppi@localhost>',
    to: mail.recipient,
    subject: mail.subject,
    text: mail.body,
    html: renderEmailHtml(mail.subject, mail.body, process.env.ORIGIN ?? 'http://localhost:5173'),
    messageId: `<ppi-${mail.id}@notifications.local>`
  });
  if (data.emailId)
    await pool.query("UPDATE email_outbox SET sent_at=now(),body='' WHERE id=$1", [data.emailId]);
}
async function runQueue(name: (typeof queueNames)[number]) {
  while (!stopping) {
    const job = await transaction(async (client) => {
      const paused = (
        await client.query('SELECT paused FROM queue_control WHERE name=$1 FOR SHARE', [name])
      ).rows[0].paused;
      if (paused) return null;
      const [next] = await boss.fetch<Record<string, unknown>>(name, {
        batchSize: 1,
        db: { executeSql: (text, values) => client.query(text, values) }
      });
      return next ?? null;
    });
    if (!job) {
      await delay(1000);
      continue;
    }
    const attempt = { id: job.id, retryCount: job.retryCount };
    try {
      if (job.data.outboxId)
        await pool.query("UPDATE core_job SET status='running',attempts=attempts+1 WHERE id=$1", [
          job.data.outboxId
        ]);
      if (name === 'file_check') await handleFile(job.data);
      if (name === 'content_check')
        await analyzeFileContent(String(job.data.fileId), Number(job.data.generation));
      if (name === 'pdf_ocr')
        await processPdfOcr(String(job.data.fileId), Number(job.data.generation));
      if (name === 'notification') await sendNotification(job.data);
      if (name === 'prepare_archive') await prepareArchive(String(job.data.archiveId));
      if (name === 'delete_files') await cleanupDeletedProtocolFiles(String(job.data.submissionId));
      if (name === 'periodic_grant') {
        const period = typeof job.data.period === 'string' ? job.data.period : currentGrantPeriod();
        let remaining = 1;
        while (remaining > 0) {
          const result = await processPeriodicGrant(period);
          remaining = result.remaining;
        }
      }
      if (job.data.outboxId)
        await pool.query(
          "UPDATE core_job SET status='completed',error='',finished_at=now() WHERE id=$1",
          [job.data.outboxId]
        );
      await boss.complete(name, attempt);
    } catch (error) {
      if (error instanceof AssertionError) throw error;
      if (name === 'content_check')
        await markContentCheckFailed(String(job.data.fileId), Number(job.data.generation));
      const message = error instanceof Error ? error.message : 'Job failed';
      console.error(`Job ${name}/${job.id}: ${message}`);
      if (job.data.outboxId)
        await pool.query("UPDATE core_job SET status='failed',error=$2 WHERE id=$1", [
          job.data.outboxId,
          message.slice(0, 500)
        ]);
      await boss.fail(name, attempt, { message: 'Task failed. Check worker logs and retry.' });
    }
  }
}
async function maintainWorker() {
  let nextCleanup = 0;
  while (!stopping) {
    await pool.query(
      'INSERT INTO worker_heartbeat(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET last_seen=now()',
      [workerId]
    );
    for (let batch = 0; batch < 10 && !stopping; batch++) {
      const dispatched = (await dispatchOutbox())!;
      if (dispatched < 50) break;
    }
    if (Date.now() >= nextCleanup) {
      const archives = await cleanupExpiredArchives();
      const auth = await cleanupExpiredAuthData();
      nextCleanup =
        Date.now() + (archives === 50 || Object.values(auth).includes(500) ? 1000 : 60000);
    }
    await delay(1000);
  }
}
console.log(`PPI worker ${workerId} started${development ? ' (development checks)' : ''}.`);
await Promise.all([maintainWorker(), ...queueNames.map(runQueue)]);
await boss.stop({ graceful: true, timeout: 30000 });
await pool.query('DELETE FROM worker_heartbeat WHERE id=$1', [workerId]);
await pool.end();
transport.close();
