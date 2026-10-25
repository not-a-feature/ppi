import { listOwnSubmissionsPage } from '#lib/server/domain/index.js';
import { actor } from '../_helpers';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  return listOwnSubmissionsPage(actor(locals), Number.isSafeInteger(page) && page > 0 ? page : 1);
};
