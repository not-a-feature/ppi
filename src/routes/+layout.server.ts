export const load = ({ locals }: { locals: App.Locals }) => ({
  actor: locals.actor,
  preferences: locals.preferences
});
