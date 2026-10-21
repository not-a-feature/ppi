import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
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
  if (zx === 'zxbrw00')
    await pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [id]);
}
const adminId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxbrw00@student.uni-tuebingen.de'])
).rows[0].id;
await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [
  randomUUID(),
  'Unverified browser fixture',
  'zxbrw04@student.uni-tuebingen.de'
]);
const admin = (await getActor(adminId))!;
const lecture = await createLecture(admin, 'Browser test lecture');
const readerId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxbrw03@student.uni-tuebingen.de'])
).rows[0].id;
await purchaseLectureAccess((await getActor(readerId))!, lecture.id, randomUUID());
Object.assign(process.env, {
  NODE_ENV: 'production',
  ADDRESS_HEADER: 'x-forwarded-for',
  XFF_DEPTH: '1',
  FILE_SCAN_MODE: 'clamav'
});
const { handler } = await import(pathToFileURL(resolve('build/handler.js')).href);
createServer((request, response) => {
  request.headers['x-forwarded-for'] = request.socket.remoteAddress;
  handler(request, response);
}).listen(4174, '127.0.0.1');
