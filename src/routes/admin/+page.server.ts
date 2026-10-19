import { listReviewQueuePage } from '$lib/server/domain/moderation';
import { getJobsSummary } from '$lib/server/jobs';
import { admin } from '../_helpers';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
  const current = admin(locals);
  const [reviews, jobs] = await Promise.all([
    listReviewQueuePage(current, { pageSize: 5 }),
    getJobsSummary(current)
  ]);
  return { reviews: reviews.entries, reviewTotal: reviews.total, jobs };
};
