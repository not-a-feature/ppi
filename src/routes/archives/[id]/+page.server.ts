import { getArchive } from '$lib/server/archives';
import { redirect } from '@sveltejs/kit';
import { actor, loadResult } from '../../_helpers';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const archive = await loadResult(() => getArchive(actor(locals), params.id));
  redirect(303, `/lectures/${archive.lecture_id}#course-access`);
};
