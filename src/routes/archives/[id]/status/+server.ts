import { error, json } from '@sveltejs/kit';
import { getArchive } from '$lib/server/archives';
import { loadResult } from '../../../_helpers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.actor) error(401, 'Bitte anmelden.');
  const archive = await loadResult(() => getArchive(locals.actor!, params.id));
  return json(archive, { headers: { 'Cache-Control': 'private, no-store' } });
};
