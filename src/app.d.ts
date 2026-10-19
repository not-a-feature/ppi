import type { auth } from '$lib/server/auth';
import type { Preferences } from '$lib/server/preferences';

declare global {
  namespace App {
    interface Locals {
      user: typeof auth.$Infer.Session.user | null;
      session: typeof auth.$Infer.Session.session | null;
      actor: { id: string; email: string; isAdmin: boolean } | null;
      preferences: Preferences;
    }
    interface PageData {
      preferences: Preferences;
    }
  }
}

export {};
