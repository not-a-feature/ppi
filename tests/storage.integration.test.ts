import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Private upload cleanup', () => {
  const schema = `storage_test_${randomUUID().replaceAll('-', '')}`;
  let root: pg.Pool;
  let pool: pg.Pool;
  let directory: string;
  let storage: typeof import('../src/lib/server/storage');

  beforeAll(async () => {
    root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    directory = await mkdtemp(join(tmpdir(), 'ppi-storage-test-'));
    process.env.UPLOAD_DIR = directory;
    ({ pool } = await import('../src/lib/server/db'));
    await pool.query('CREATE TABLE stored_file(storage_key text PRIMARY KEY)');
    await pool.query('CREATE TABLE lecture_archive(storage_key text PRIMARY KEY)');
    await pool.query('CREATE TABLE pdf_derivative(storage_key text PRIMARY KEY)');
    storage = await import('../src/lib/server/storage');
  });

  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root?.end();
    if (directory) {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unsupported extensions before reading bytes and stores no invalid files', async () => {
    const before = await readdir(directory);
    const word = new File(['Unsupported document.'], 'protocol.docx');
    const readBytes = vi.spyOn(word, 'arrayBuffer');
    await expect(storage.storeUpload(word)).rejects.toMatchObject({
      status: 400,
      message: 'Nur PDF- und TXT-Dateien sind erlaubt.'
    });
    expect(readBytes).not.toHaveBeenCalled();
    await expect(
      storage.storeUpload(new File(['Executable content'], 'renamed.pdf'))
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      storage.storeUpload(new File([new Uint8Array([0xff])], 'invalid.txt'))
    ).rejects.toMatchObject({ status: 400 });
    expect(await readdir(directory)).toEqual(before);
  });

  it('removes an unreferenced upload and rejects paths outside UUID storage keys', async () => {
    const uploaded = await storage.storeUpload(
      new File(['Synthetic unreferenced text.'], 'unused.txt')
    );
    await storage.cleanupUnreferencedUpload(uploaded.storageKey);
    await expect(stat(storage.filePath(uploaded.storageKey))).rejects.toMatchObject({
      code: 'ENOENT'
    });
    await storage.cleanupUnreferencedUpload(uploaded.storageKey);
    await expect(storage.cleanupUnreferencedUpload('../outside')).rejects.toThrow(
      'Invalid internal storage key'
    );
  });

  it('retains referenced files and leaves files untouched when database state is uncertain', async () => {
    const referenced = await storage.storeUpload(new File(['Referenced protocol.'], 'kept.txt'));
    await pool.query('INSERT INTO stored_file(storage_key) VALUES($1)', [referenced.storageKey]);
    await storage.cleanupUnreferencedUpload(referenced.storageKey);
    expect((await readFile(storage.filePath(referenced.storageKey))).toString()).toBe(
      'Referenced protocol.'
    );
    const archive = await storage.storeUpload(
      new File(['Referenced archive fixture.'], 'archive-fixture.txt')
    );
    await pool.query('INSERT INTO lecture_archive(storage_key) VALUES($1)', [archive.storageKey]);
    await storage.cleanupUnreferencedUpload(archive.storageKey);
    expect((await readFile(storage.filePath(archive.storageKey))).toString()).toBe(
      'Referenced archive fixture.'
    );
    const derivative = await storage.storeUpload(
      new File(['Referenced searchable PDF fixture.'], 'derivative-fixture.txt')
    );
    await pool.query('INSERT INTO pdf_derivative(storage_key) VALUES($1)', [derivative.storageKey]);
    await storage.cleanupUnreferencedUpload(derivative.storageKey);
    expect((await readFile(storage.filePath(derivative.storageKey))).toString()).toBe(
      'Referenced searchable PDF fixture.'
    );
    const orphan = await storage.storeUpload(
      new File(['Retain until reconciliation.'], 'uncertain.txt')
    );
    const query = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(storage.cleanupUnreferencedUpload(orphan.storageKey)).rejects.toThrow(
      'database unavailable'
    );
    query.mockRestore();
    expect((await readFile(storage.filePath(orphan.storageKey))).toString()).toBe(
      'Retain until reconciliation.'
    );
    await storage.cleanupUnreferencedUpload(orphan.storageKey);
  });
});
