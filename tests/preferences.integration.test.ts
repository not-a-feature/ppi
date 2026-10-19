import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/server/domain';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Account preferences', () => {
  const schema = `preferences_test_${randomUUID().replaceAll('-', '')}`;
  let root: pg.Pool;
  let pool: pg.Pool;
  let preferences: typeof import('../src/lib/server/preferences');
  let currentAccount: typeof import('../src/lib/server/auth/session').currentAccount;
  let first: Actor;
  let second: Actor;

  beforeAll(async () => {
    root = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ pool } = await import('../src/lib/server/db'));
    for (const name of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await pool.query(await readFile(`migrations/${name}`, 'utf8'));
    }
    const domain = await import('../src/lib/server/domain');
    preferences = await import('../src/lib/server/preferences');
    ({ currentAccount } = await import('../src/lib/server/auth/session'));
    for (const [index, email] of [
      'zxpre01@student.uni-tuebingen.de',
      'zxpre02@student.uni-tuebingen.de'
    ].entries()) {
      const id = randomUUID();
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
        id,
        'Synthetic Preferences Test',
        email
      ]);
      await domain.activateAccount(id);
      const actor = await domain.getActor(id);
      expect(actor).not.toBe(null);
      if (index === 0) first = actor!;
      else second = actor!;
    }
  });

  afterAll(async () => {
    await pool?.end();
    await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root?.end();
  });

  it('defaults to German and automatic appearance, and persists changes only for the current account', async () => {
    expect((await currentAccount(first.id))!.preferences).toEqual({
      language: 'de',
      theme: 'auto'
    });
    expect(await preferences.updatePreferences(first, { language: 'en', theme: 'dark' })).toEqual({
      language: 'en',
      theme: 'dark'
    });
    expect((await currentAccount(first.id))!.preferences).toEqual({
      language: 'en',
      theme: 'dark'
    });
    expect((await currentAccount(second.id))!.preferences).toEqual({
      language: 'de',
      theme: 'auto'
    });
    expect((await pool.query('SELECT user_id,language,theme FROM user_preference')).rows).toEqual([
      { user_id: first.id, language: 'en', theme: 'dark' }
    ]);
  });

  it('rejects unsupported values without changing saved preferences', async () => {
    for (const input of [
      { language: 'en-US', theme: 'dark' },
      { language: 'de', theme: 'system' },
      { language: '<script>', theme: 'auto' }
    ]) {
      await expect(preferences.updatePreferences(first, input)).rejects.toMatchObject({
        status: 400,
        code: 'invalid_preferences'
      });
    }
    expect((await currentAccount(first.id))!.preferences).toEqual({
      language: 'en',
      theme: 'dark'
    });
    expect(await preferences.updatePreferences(second, { language: 'de', theme: 'light' })).toEqual(
      { language: 'de', theme: 'light' }
    );
  });

  it('rechecks current account status rather than trusting a previously obtained actor', async () => {
    expect(await currentAccount(first.id)).toEqual({
      actor: first,
      preferences: { language: 'en', theme: 'dark' }
    });
    await pool.query('UPDATE ppi_user SET is_admin=true WHERE user_id=$1', [first.id]);
    expect((await currentAccount(first.id))?.actor.isAdmin).toBe(true);
    await pool.query('UPDATE ppi_user SET is_admin=false WHERE user_id=$1', [first.id]);
    expect((await currentAccount(first.id))?.actor.isAdmin).toBe(false);
    await pool.query("UPDATE ppi_user SET status='suspended' WHERE user_id=$1", [first.id]);
    expect(await currentAccount(first.id)).toBeNull();
    await expect(
      preferences.updatePreferences(first, { language: 'de', theme: 'auto' })
    ).rejects.toMatchObject({ status: 403, code: 'account_ineligible' });
    expect(
      (await pool.query('SELECT language,theme FROM user_preference WHERE user_id=$1', [first.id]))
        .rows[0]
    ).toEqual({ language: 'en', theme: 'dark' });
  });
});
