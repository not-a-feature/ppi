import { listReviewQueuePage } from '#lib/server/domain/moderation.js';
import { getJobsSummary } from '#lib/server/jobs.js';
import { getAdminOverview } from '#lib/server/statistics.js';
import { admin } from '../_helpers';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
  const current = admin(locals);
  const [reviews, jobs, overview] = await Promise.all([
    listReviewQueuePage(current, { pageSize: 5, readyOnly: true }),
    getJobsSummary(current),
    getAdminOverview(current)
  ]);
  return { reviews: reviews.entries, reviewTotal: reviews.total, jobs, overview };
};
