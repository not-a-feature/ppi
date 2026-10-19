import { getAdminStatistics } from '$lib/server/statistics';
import { admin, loadResult } from '../../_helpers';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, url }) => {
  const range = url.searchParams.get('range') ?? '30d';
  if (!['30d', '6m', '1y', 'max'].includes(range)) error(400, 'Invalid statistics period.');
  const current = admin(locals);
  const [month, halfYear, year, all] = await Promise.all(
    ['30d', '6m', '1y', 'max'].map((value) => loadResult(() => getAdminStatistics(current, value)))
  );
  return { range, periods: { '30d': month, '6m': halfYear, '1y': year, max: all } };
};
