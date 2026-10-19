import pg, { type PoolClient } from 'pg';

export type DatabaseMode = 'runtime' | 'migration';

export function databaseConnectionOptions(mode: DatabaseMode = 'runtime'): pg.PoolConfig {
  const migration = mode === 'migration';
  const connectionString = process.env.DATABASE_URL;
  const url = connectionString ? new URL(connectionString) : undefined;
  const timeouts = `-c statement_timeout=${migration ? 300000 : 30000} -c lock_timeout=${migration ? 30000 : 5000} -c idle_in_transaction_session_timeout=${migration ? 60000 : 15000}`;
  // Keep deployment SSL/search-path options while applying the same bounds to every client.
  const options = [url?.searchParams.get('options'), timeouts].filter(Boolean).join(' ');
  if (url) url.searchParams.set('options', options);
  return {
    connectionString: url?.toString(),
    options,
    connectionTimeoutMillis: 5000,
    query_timeout: migration ? 330000 : 35000,
    keepAlive: true
  };
}

export function logDatabaseError(error: Error & { code?: string }) {
  const code = error.code && /^[A-Z0-9_]{1,20}$/.test(error.code) ? error.code : 'unknown';
  console.error('Database connection failed', { code });
}

export function createDatabasePool(mode: DatabaseMode = 'runtime') {
  const databasePool = new pg.Pool({ ...databaseConnectionOptions(mode), max: 10 });
  databasePool.on('error', logDatabaseError);
  return databasePool;
}

export const pool = createDatabasePool();

export async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  databasePool = pool
): Promise<T> {
  const client = await databasePool.connect();
  // Checked-out clients do not have the pool's idle error listener attached.
  client.on('error', logDatabaseError);
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.removeListener('error', logDatabaseError);
    client.release();
  }
}
