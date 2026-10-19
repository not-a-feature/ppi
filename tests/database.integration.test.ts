import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const schema = `ppi_db_${randomUUID().replaceAll('-', '')}`;
let root: pg.Pool;
let db: typeof import('../src/lib/server/db.js');

describe.skipIf(!testUrl)('database connection boundaries', () => {
  beforeAll(async () => {
    assert(testUrl);
    const url = new URL(testUrl);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/ppi_test');
    root = new pg.Pool({ connectionString: testUrl });
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../src/lib/server/db.js');
    await db.pool.query('CREATE TABLE timeout_fixture(id integer PRIMARY KEY,value integer)');
    await db.pool.query('INSERT INTO timeout_fixture VALUES(1,0)');
  });

  afterAll(async () => {
    if (db) await db.pool.end();
    if (root) {
      assert(/^ppi_db_[a-f0-9]{32}$/.test(schema));
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('applies server timeouts without losing search-path options and allows longer migrations', async () => {
    const settings = await db.pool.query(`SELECT current_schema() schema,
      current_setting('statement_timeout') statement,
      current_setting('lock_timeout') lock,
      current_setting('idle_in_transaction_session_timeout') idle`);
    expect(settings.rows[0]).toEqual({ schema, statement: '30s', lock: '5s', idle: '15s' });
    const migration = db.createDatabasePool('migration');
    try {
      expect((await migration.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe(
        '5min'
      );
      expect((await migration.query('SHOW lock_timeout')).rows[0].lock_timeout).toBe('30s');
    } finally {
      await migration.end();
    }
  });

  it('bounds waiting for an exhausted pool and recovers once clients are returned', async () => {
    const held: PoolClient[] = [];
    try {
      for (let index = 0; index < 10; index++) held.push(await db.pool.connect());
      await expect(db.pool.connect()).rejects.toThrow('timeout exceeded when trying to connect');
    } finally {
      for (const client of held) client.release();
    }
    expect((await db.pool.query('SELECT 1 ready')).rows[0].ready).toBe(1);
  });

  it('rolls back a lock timeout and keeps the connection usable', async () => {
    const holder = await root.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT * FROM ${schema}.timeout_fixture WHERE id=1 FOR UPDATE`);
      await expect(
        db.transaction(async (client) => {
          await client.query('UPDATE timeout_fixture SET value=1 WHERE id=1');
        })
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    await db.transaction(async (client) => {
      await client.query('UPDATE timeout_fixture SET value=value+1 WHERE id=1');
    });
    expect(
      (await db.pool.query('SELECT value FROM timeout_fixture WHERE id=1')).rows[0].value
    ).toBe(1);
  });

  it('survives a real idle connection failure and logs only a diagnostic code', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const client = await db.pool.connect();
      const pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      client.release();
      const failed = new Promise<void>((resolve) => db.pool.once('error', () => resolve()));
      await root.query('SELECT pg_terminate_backend($1)', [pid]);
      await failed;
      expect(log).toHaveBeenCalledWith('Database connection failed', { code: '57P01' });
      db.pool.emit(
        'error',
        Object.assign(new Error('password=do-not-log; SELECT private_data'), { code: 'ECONNRESET' })
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('do-not-log');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private_data');
      expect((await db.pool.query('SELECT 1 ready')).rows[0].ready).toBe(1);
    } finally {
      log.mockRestore();
    }
  });
});
