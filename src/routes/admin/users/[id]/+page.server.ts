import { getAdminUser } from '#lib/server/domain/index.js';
import { admin, loadResult } from '../../../_helpers';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) =>
  loadResult(() => getAdminUser(admin(locals), params.id));
