import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { verifyPassword } from 'better-auth/crypto';
import { betterAuth } from 'better-auth';
import { account, hash, id } from './legacy-data.mjs';

assert(process.env.TEST_DATABASE_URL, 'Set a local TEST_DATABASE_URL');
const url = new URL(process.env.TEST_DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.pathname, '/ppi_test', 'Use the disposable ppi_test database');
const pool = new pg.Pool({ connectionString: url.toString() });
const schema = 'legacy_test_' + randomUUID().replaceAll('-', '');
const root = await mkdtemp(join(tmpdir(), 'ppi-legacy-'));
url.searchParams.set('options', `-c search_path=${schema},public`);
async function runScript(script, args = []) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script, root, ...args], {
      env: { ...process.env, DATABASE_URL: url.toString(), UPLOAD_DIR: join(root, 'stored') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (output += b));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveResult(output) : reject(new Error(output))));
  });
}
const run = (apply = false, addOnly = false) =>
  runScript('scripts/import-legacy.mjs', [
    ...(apply ? ['--apply'] : []),
    ...(addOnly ? ['--add-only'] : [])
  ]);
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.query(await readFile(join('migrations', name), 'utf8'));
    await mkdir(join(root, 'files'));
    const content = Buffer.from('Exam protocol fixture');
    await writeFile(join(root, 'files/1.txt'), content);
    const data = {
      version: 1,
      users: [
        account({ id: '2', username: 'zxabc12', role: 'ADMIN', tokens: '10', comment: 'private' })
      ],
      lectures: [{ sourceId: '1', name: 'Logic', archived: false }],
      protocols: [
        {
          sourceId: '1',
          owner: '2',
          status: 'ACCEPTED',
          uploadedDate: '2024-01-01 12:00:00.000',
          remarks: '',
          originalName: '1.txt',
          lectures: ['1'],
          metadata: { examiners: ['Examiner'], exam_date: '2023-12-01', term: 'WS2023/24' },
          file: { id: 1, path: 'files/1.txt', bytes: content.length, sha256: hash(content) }
        }
      ]
    };
    async function save() {
      const text = JSON.stringify(data, null, 2);
      await writeFile(join(root, 'prepared.json'), text);
      await writeFile(join(root, 'prepared.sha256'), hash(text));
    }
    // Prepare the actual raw scrape format without any private developer directories.
    await writeFile(
      join(root, 'snapshot.json'),
      JSON.stringify({ version: 1, users: 1, protocols: 1 })
    );
    await writeFile(
      join(root, 'users.json'),
      JSON.stringify([
        { id: '2', username: 'zxabc12', role: 'ADMIN', tokens: '10', comment: 'private' }
      ])
    );
    await writeFile(
      join(root, 'lectures.json'),
      JSON.stringify([{ id: '1', name: 'Logic', status: 'OK' }])
    );
    await writeFile(
      join(root, 'protocols.json'),
      JSON.stringify([
        {
          id: '1',
          uploadedByUserID: '2',
          status: 'ACCEPTED',
          uploadedDate: data.protocols[0].uploadedDate,
          examiner: 'Examiner',
          lectures: 'Logic',
          remark: '',
          fileName: '1.txt'
        }
      ])
    );
    await writeFile(join(root, 'file-manifest.json'), JSON.stringify([data.protocols[0].file]));
    await writeFile(
      join(root, 'corrections.json'),
      JSON.stringify([
        {
          legacy_id: 1,
          sha256: hash(content),
          before: { examiners: ['Examiner'] },
          after: data.protocols[0].metadata
        }
      ])
    );
    await runScript('scripts/prepare-legacy.mjs');
    assert.deepEqual(JSON.parse(await readFile(join(root, 'prepared.json'), 'utf8')), data);
    await save();
    await run();
    assert.equal((await db.query('SELECT count(*)::int n FROM "user"')).rows[0].n, 0);
    await run(true);
    const target = id('user', '2');
    const user = (await db.query('SELECT * FROM ppi_user WHERE user_id=$1', [target])).rows[0];
    assert(user.is_admin);
    assert.equal(user.admin_note, 'private');
    const password = (await db.query('SELECT password FROM account WHERE "userId"=$1', [target]))
      .rows[0].password;
    assert.equal(await verifyPassword({ hash: password, password: 'legacy-password' }), false);
    const authPool = new pg.Pool({ connectionString: url.toString() });
    let resetToken;
    try {
      const auth = betterAuth({
        database: authPool,
        baseURL: 'http://localhost:5173',
        secret: 'test-only-secret-for-legacy-password-recovery-12345',
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          sendResetPassword: async ({ token }) => {
            resetToken = token;
          }
        }
      });
      await auth.api.requestPasswordReset({ body: { email: data.users[0].email } });
      assert(resetToken, 'Imported account did not receive a password reset token');
      await auth.api.resetPassword({
        body: { token: resetToken, newPassword: 'recovered-password-12345' }
      });
      const changed = (await db.query('SELECT password FROM account WHERE "userId"=$1', [target]))
        .rows[0].password;
      assert(await verifyPassword({ hash: changed, password: 'recovered-password-12345' }));
    } finally {
      await authPool.end();
    }
    await db.query('UPDATE credit_account SET balance=7 WHERE user_id=$1', [target]);
    await run(true);
    assert.equal(
      (await db.query('SELECT balance FROM credit_account WHERE user_id=$1', [target])).rows[0]
        .balance,
      7
    );
    assert.equal((await db.query('SELECT count(*)::int n FROM credit_entry')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM submission')).rows[0].n, 1);
    assert.equal(
      (await db.query('SELECT safety_status FROM stored_file')).rows[0].safety_status,
      'pending'
    );
    assert.equal((await db.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n, 0);
    await writeFile(join(root, 'files/1.txt'), 'Changed document bytes');
    await assert.rejects(run(true), /File changed/);
    await writeFile(join(root, 'files/1.txt'), content);
    data.users[0].balance = 99;
    await save();
    await assert.rejects(run(true), /Changed legacy user/);
    assert.equal(
      (await db.query('SELECT balance FROM credit_account WHERE user_id=$1', [target])).rows[0]
        .balance,
      7
    );
    data.users.push(
      account({
        id: '3',
        username: 'zxdef34',
        role: 'BLOCKED',
        tokens: '4',
        comment: 'new account'
      })
    );
    data.protocols.push({
      ...structuredClone(data.protocols[0]),
      sourceId: '2',
      owner: '3',
      file: { ...data.protocols[0].file, id: 2, path: 'files/2.txt' }
    });
    await writeFile(join(root, 'files/2.txt'), content);
    await save();
    await run(true, true);
    assert.equal(
      (await db.query('SELECT balance FROM credit_account WHERE user_id=$1', [target])).rows[0]
        .balance,
      7
    );
    assert.equal((await db.query('SELECT count(*)::int n FROM credit_entry')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int n FROM submission')).rows[0].n, 2);
    assert.equal(
      (await db.query('SELECT status FROM ppi_user WHERE user_id=$1', [id('user', '3')])).rows[0]
        .status,
      'suspended'
    );
    console.log(
      'PASS: raw scrape preparation, hash validation, dry-run rollback, admin flags, Better Auth password recovery, repeat imports, preserved live balances, conflict rollback, additive users/protocols, pending scanning, no mail'
    );
  } finally {
    await db.end();
  }
} finally {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  // Only the exact temporary directory created by mkdtemp is removed.
  assert(
    resolve(root).startsWith(resolve(tmpdir()) + '\\') ||
      resolve(root).startsWith(resolve(tmpdir()) + '/')
  );
  await rm(root, { recursive: true, force: true });
}
