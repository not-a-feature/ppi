import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { serializeSignedCookie } from 'better-call';

assert(
  process.env.TEST_DATABASE_URL,
  'Set TEST_DATABASE_URL to a disposable local ppi_test database.'
);
const rootUrl = new URL(process.env.TEST_DATABASE_URL);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(rootUrl.hostname));
assert.equal(rootUrl.pathname, '/ppi_test');
assert(process.env.BETTER_AUTH_SECRET);
const schema = 'ppi_load_100';
const root = new pg.Pool({ connectionString: rootUrl.toString(), max: 2 });
const isolatedUrl = new URL(rootUrl);
isolatedUrl.searchParams.set('options', `-c search_path=${schema},public`);
const db = new pg.Pool({ connectionString: isolatedUrl.toString(), max: 2 });
const base = 'http://127.0.0.1:5180';
const output = resolve(process.env.PERFORMANCE_OUTPUT ?? '.data/performance-100.json');
let server;
let created = false;
const report = {
  created_at: new Date().toISOString(),
  dataset: {
    users: 10000,
    lectures: 1000,
    submissions: 50000,
    revisions: 100000,
    credit_entries: 200000,
    lecture_access: 200000,
    audit_events: 500000
  },
  notes: [
    'Local compiled build with PostgreSQL in Docker.',
    'Distinct seeded authenticated sessions; password hashing, file transfer and workers excluded.',
    'No think time: concurrency measures active requests, not idle online users.',
    'Each load stage launches requests for 10 seconds, then drains in-flight requests.'
  ],
  phases: []
};
const round = (n) => Math.round(n * 10) / 10;
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    median_ms: round(s[Math.floor(s.length / 2)] ?? 0),
    p95_ms: round(s[Math.ceil(s.length * 0.95) - 1] ?? 0),
    max_ms: round(s.at(-1) ?? 0)
  };
}
async function save() {
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
try {
  await mkdir(dirname(output), { recursive: true });
  await root.query(`CREATE SCHEMA ${schema}`);
  created = true;
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.query(await readFile('migrations/' + file, 'utf8'));
  console.log('Seeding isolated load-test schema.');
  await db.query(await readFile('scripts/performance-seed.sql', 'utf8'));
  for (const { tablename } of (
    await db.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])
  ).rows)
    await db.query(`ANALYZE "${tablename}"`);
  const cookies = [];
  for (let i = 1; i <= 210; i++) {
    const token = randomUUID();
    await db.query(
      'INSERT INTO session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval \'1 day\')',
      [randomUUID(), token, 'load-user-' + i]
    );
    cookies.push(
      (
        await serializeSignedCookie(
          'better-auth.session_token',
          token,
          process.env.BETTER_AUTH_SECRET,
          { path: '/' }
        )
      ).split(';')[0]
    );
  }
  server = spawn(process.execPath, ['build/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: isolatedUrl.toString(),
      PGBOSS_SCHEMA: schema + '_jobs',
      ORIGIN: base,
      HOST: '127.0.0.1',
      PORT: '5180'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  server.stderr.on('data', (data) => process.stderr.write(data));
  await new Promise((ready, reject) => {
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Listening on')) ready();
    });
    server.once('exit', (code) => reject(new Error('Benchmark server exited: ' + code)));
    server.once('error', reject);
  });
  const lectureId = createHash('md5')
    .update('lecture-1')
    .digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  const studentPaths = [
    '/lectures',
    '/lectures',
    '/lectures?q=001',
    '/lectures?page=10',
    '/lectures/' + lectureId,
    '/account/credits',
    '/submissions',
    '/upload'
  ];
  const adminPaths = [
    '/admin',
    '/admin/review',
    '/admin/review?scope=all&q=protocol-499',
    '/admin/users?q=zxaaa',
    '/admin/audit',
    '/admin/audit?q=auth.login',
    '/admin/statistics?range=30d',
    '/admin/statistics?range=max',
    '/admin/catalogue'
  ];
  async function request(path, cookie) {
    const start = performance.now();
    const response = await fetch(base + path, {
      headers: { Cookie: cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    return {
      ms: performance.now() - start,
      bytes: Buffer.byteLength(body),
      error:
        response.status !== 200
          ? `${path}: HTTP ${response.status}`
          : !body.includes('<html')
            ? `${path}: expected HTML`
            : null
    };
  }
  assert.equal((await request('/lectures', cookies[100])).error, null);
  for (const path of [...new Set(studentPaths), ...adminPaths]) {
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const r = await request(path, path.startsWith('/admin') ? cookies[0] : cookies[100]);
      assert.equal(r.error, null);
      samples.push(r.ms);
      bytes = r.bytes;
    }
    const entry = { label: 'single ' + path, requests: 3, ...stats(samples), html_bytes: bytes };
    report.phases.push(entry);
    await save();
    console.log(JSON.stringify(entry));
  }
  for (const [label, levels] of [
    ['students', [10, 25, 50, 100]],
    ['admins', [5, 10]],
    ['mixed', [100]]
  ]) {
    for (const concurrency of levels) {
      const start = performance.now(),
        samples = [],
        errors = [],
        perPath = {};
      await Promise.all(
        Array.from({ length: concurrency }, async (_, worker) => {
          const isAdmin = label === 'admins' || (label === 'mixed' && worker < 10);
          const paths = isAdmin ? adminPaths : studentPaths;
          let sequence = worker;
          while (performance.now() - start < 10000) {
            const path = paths[sequence++ % paths.length];
            try {
              const r = await request(path, cookies[isAdmin ? worker % 10 : 100 + worker]);
              if (r.error) {
                errors.push(r.error);
                continue;
              }
              samples.push(r.ms);
              (perPath[path] ??= []).push(r.ms);
            } catch (error) {
              errors.push(String(error));
            }
          }
        })
      );
      const elapsed = performance.now() - start;
      const entry = {
        label,
        concurrency,
        duration_ms: round(elapsed),
        requests: samples.length,
        errors: errors.length,
        error_examples: [...new Set(errors)].slice(0, 4),
        requests_per_second: round(samples.length / (elapsed / 1000)),
        ...stats(samples),
        per_path: Object.fromEntries(
          Object.entries(perPath).map(([path, times]) => [
            path,
            { requests: times.length, ...stats(times) }
          ])
        )
      };
      report.phases.push(entry);
      await save();
      console.log(
        JSON.stringify({
          label,
          concurrency,
          requests: entry.requests,
          errors: entry.errors,
          rps: entry.requests_per_second,
          median_ms: entry.median_ms,
          p95_ms: entry.p95_ms
        })
      );
    }
  }
  console.log('RESULT ' + output);
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  await db.end();
  if (created) {
    await root.query(`DROP SCHEMA IF EXISTS ${schema}_jobs CASCADE`);
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    console.log('Isolated load-test data removed.');
  }
  await root.end();
}
