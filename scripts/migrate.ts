import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabasePool, pool, transaction } from '../src/lib/server/db.js';
import { getBoss } from '../src/lib/server/jobs.js';

const migrationPool = createDatabasePool('migration');
await transaction(async (client) => {
  await client.query('SELECT pg_advisory_xact_lock(8172026)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
  );
  for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`migrations/${name}`, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT sha256 FROM schema_migration WHERE name=$1', [
      name
    ]);
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO schema_migration(name,sha256) VALUES($1,$2)', [name, hash]);
    console.log(`Applied ${name}`);
  }
}, migrationPool);
const boss = await getBoss('migration');
await boss.stop();
await migrationPool.end();
await pool.end();
