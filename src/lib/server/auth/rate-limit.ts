import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../db';

const formLimits: Record<string, { window: number; max: number }> = {
  '/login': { window: 60, max: 10 },
  '/register': { window: 3600, max: 5 },
  '/verify-email': { window: 60, max: 2 },
  '/forgot-password': { window: 60, max: 3 },
  '/reset-password': { window: 60, max: 5 },
  '/account': { window: 60, max: 5 }
};

export async function allowAuthForm(path: string, clientAddress: string): Promise<boolean> {
  const rule = formLimits[path];
  if (!rule) return true;
  const key = `form:${path}:${createHash('sha256').update(clientAddress).digest('hex')}`;
  const now = Date.now();
  const result = await pool.query<{ count: number }>(
    `INSERT INTO "rateLimit"(id,key,count,"lastRequest") VALUES($1,$2,1,$3)
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN "rateLimit"."lastRequest" <= $4 THEN 1 ELSE "rateLimit".count+1 END,
       "lastRequest"=CASE WHEN "rateLimit"."lastRequest" <= $4 THEN $3 ELSE "rateLimit"."lastRequest" END
     RETURNING count`,
    [randomUUID(), key, now, now - rule.window * 1000]
  );
  return result.rows[0].count <= rule.max;
}
