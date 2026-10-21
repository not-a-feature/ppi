import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

export default async function teardown() {
  const schema = process.env.PPI_E2E_SCHEMA!;
  assert(/^ppi_e2e_[a-f0-9]{32}$/.test(schema));
  const root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
  await rm(resolve('.data', schema), { recursive: true, force: true });
}
