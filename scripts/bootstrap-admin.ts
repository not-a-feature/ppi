import assert from 'node:assert/strict';
import { pool, transaction } from '../src/lib/server/db.js';
import { studentEmailPattern } from '../src/lib/server/auth/policy.js';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
assert(email, 'Set BOOTSTRAP_ADMIN_EMAIL in .env to the verified first administrator email.');
assert(studentEmailPattern.test(email), 'Nominate a complete lowercase zx student email.');

await transaction(async (client) => {
  await client.query('SELECT pg_advisory_xact_lock(8172027)');
  const administrators = await client.query(
    'SELECT user_id FROM ppi_user WHERE is_admin FOR UPDATE'
  );
  assert.equal(
    administrators.rowCount,
    0,
    'An administrator already exists. Use the admin website for further promotions.'
  );
  const nominated = (
    await client.query(
      `SELECT u.id,u."emailVerified",p.status FROM "user" u JOIN ppi_user p ON p.user_id=u.id WHERE u.email=$1 FOR UPDATE OF u,p`,
      [email]
    )
  ).rows[0];
  assert(
    nominated && nominated.emailVerified && nominated.status === 'active',
    'The nominated account must already be verified and active.'
  );
  await client.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [nominated.id]);
  await client.query(
    `INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES(NULL,'admin.bootstrap',$1,$2)`,
    [nominated.id, JSON.stringify({ email, source: 'operator environment' })]
  );
});

console.log(`Initial administrator assigned to ${email}.`);
await pool.end();
