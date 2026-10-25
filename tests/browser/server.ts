import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { password } from './support.js';
import { pool } from '../../src/lib/server/db.js';
import {
  activateAccount,
  createLecture,
  getActor,
  purchaseLectureAccess
} from '../../src/lib/server/domain/index.js';

const schema = process.env.PPI_E2E_SCHEMA!;
assert(/^ppi_e2e_[a-f0-9]{32}$/.test(schema));
const database = new URL(process.env.DATABASE_URL!);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname));
const root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
await root.query(`CREATE SCHEMA ${schema}`);
await root.end();
for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort())
  await pool.query(await readFile(`migrations/${name}`, 'utf8'));
await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
const hash = await hashPassword(password);
for (const zx of ['zxbrw00', 'zxbrw02', 'zxbrw03']) {
  const id = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    id,
    zx,
    `${zx}@student.uni-tuebingen.de`
  ]);
  await pool.query(
    `INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)`,
    [randomUUID(), id, hash]
  );
  await activateAccount(id);
}
const adminId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxbrw00@student.uni-tuebingen.de'])
).rows[0].id;
await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [
  randomUUID(),
  'Unverified browser fixture',
  'zxbrw04@student.uni-tuebingen.de'
]);
function bootstrap(email: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/bootstrap-admin.ts'], {
    env: { ...process.env, BOOTSTRAP_ADMIN_EMAIL: email },
    encoding: 'utf8',
    windowsHide: true
  });
}
assert.notEqual(bootstrap('').status, 0, 'Bootstrap requires an explicit environment setting.');
assert.notEqual(
  bootstrap('zxbrw04@student.uni-tuebingen.de').status,
  0,
  'Unverified accounts cannot be administrators.'
);
assert.equal(
  bootstrap('zxbrw00@student.uni-tuebingen.de').status,
  0,
  'The verified first administrator can be promoted.'
);
assert.notEqual(
  bootstrap('zxbrw02@student.uni-tuebingen.de').status,
  0,
  'A second bootstrap must not promote another account.'
);
const admin = (await getActor(adminId))!;
assert(admin.isAdmin);
const lecture = await createLecture(admin, 'Browser test lecture');
const readerId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxbrw03@student.uni-tuebingen.de'])
).rows[0].id;
await purchaseLectureAccess((await getActor(readerId))!, lecture.id, randomUUID());
Object.assign(process.env, {
  NODE_ENV: 'production',
  ADDRESS_HEADER: 'x-forwarded-for',
  XFF_DEPTH: '1',
  PROTOCOL_HEADER: 'x-forwarded-proto',
  FILE_SCAN_MODE: 'clamav'
});
const { handler } = await import(pathToFileURL(resolve('build/handler.js')).href);
createServer((request, response) => {
  request.headers['x-forwarded-for'] = request.socket.remoteAddress;
  request.headers['x-forwarded-proto'] = 'http';
  handler(request, response);
}).listen(4174, '127.0.0.1');
