import { redirect } from '@sveltejs/kit';
export const load = ({ locals }: { locals: App.Locals }) =>
  redirect(303, locals.actor ? '/lectures' : '/login');
