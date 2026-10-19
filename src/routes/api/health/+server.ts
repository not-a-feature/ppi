import { json } from '@sveltejs/kit';
import { pool } from '$lib/server/db.js';
export async function GET() {
  await pool.query('SELECT 1');
  return json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
