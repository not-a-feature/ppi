import { t } from '$lib/i18n';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { pool } from '$lib/server/db';
import { currentAccount } from '$lib/server/auth/session';
import { allowAuthForm } from '$lib/server/auth/rate-limit';
import { defaultPreferences } from '$lib/server/preferences';
import {
  clientAddressHeader,
  requestWithClientAddress,
  validateProxyConfiguration
} from '$lib/server/auth/client-address';
import { tryAcquireUpload } from '$lib/server/upload-concurrency';

if (!building) validateProxyConfiguration();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.actor = null;
  event.locals.user = null;
  event.locals.session = null;
  event.locals.preferences = { ...defaultPreferences };
  const action = [...event.url.searchParams.keys()].find((key) => key.startsWith('/'));
  if (!building) {
    event.request = requestWithClientAddress(event.request, event.getClientAddress());
    const formPath = event.route.id === '/(auth)/[flow]' ? `/${event.params.flow}` : event.route.id;
    if (
      event.request.method === 'POST' &&
      !(formPath === '/account' && (action === '/signout' || action === '/preferences'))
    ) {
      if (!(await allowAuthForm(formPath ?? '', event.request.headers.get(clientAddressHeader)!))) {
        return new Response('Too many requests. Please try again later.', {
          status: 429,
          headers: { 'Retry-After': '60' }
        });
      }
    }
    const current = await auth.api.getSession({ headers: event.request.headers });
    if (current?.user.emailVerified) {
      const account = await currentAccount(current.user.id);
      if (account) {
        event.locals.actor = account.actor;
        event.locals.user = current.user;
        event.locals.session = current.session;
        event.locals.preferences = account.preferences;
      } else {
        await pool.query('DELETE FROM session WHERE "userId" = $1', [current.user.id]);
      }
    }
  }
  let release: (() => void) | undefined;
  if (
    event.locals.actor &&
    event.request.method === 'POST' &&
    (event.route.id === '/upload' ||
      (event.route.id === '/submissions/[id]' && action === '/improve'))
  ) {
    const admitted = tryAcquireUpload(event.locals.actor.id);
    if (!admitted)
      return new Response(
        t(
          event.locals.preferences.language,
          'Es werden gerade Dateien hochgeladen. Bitte in wenigen Sekunden erneut versuchen.'
        ),
        {
          status: 429,
          headers: { 'Retry-After': '2', 'Content-Type': 'text/plain; charset=utf-8' }
        }
      );
    release = admitted;
  }
  try {
    const response = await svelteKitHandler({
      event,
      resolve: (event) =>
        resolve(event, {
          transformPageChunk: ({ html }) =>
            html
              .replace('%ppi.lang%', event.locals.preferences.language)
              .replace('%ppi.theme%', event.locals.preferences.theme)
        }),
      auth,
      building
    });
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    return response;
  } finally {
    release?.();
  }
};
