import { json } from '@sveltejs/kit';
import { getContentChecks } from '$lib/server/content-checks';
import { admin, loadResult } from '../../../../_helpers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const report = await loadResult(() => getContentChecks(admin(locals), params.id));
  return json(report, { headers: { 'Cache-Control': 'private, no-store' } });
};
