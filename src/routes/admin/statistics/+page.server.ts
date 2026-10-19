import { getAdminStatistics } from '$lib/server/statistics';
import { admin, loadResult } from '../../_helpers';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => ({
  statistics: await loadResult(() =>
    getAdminStatistics(admin(locals), url.searchParams.get('range') ?? '30d')
  )
});
