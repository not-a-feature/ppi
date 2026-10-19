import { admin } from '../_helpers';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals }) => ({ admin: admin(locals) });
