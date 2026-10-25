import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getSession: vi.fn(async (_input: { headers: Headers }) => null),
  allowAuthForm: vi.fn(),
  recordSystemFailure: vi.fn(async () => {}),
  submissions: new Map<string, number>()
}));
vi.mock('$app/env', () => ({ building: false }));
vi.mock('#lib/server/auth/index.js', () => ({ auth: { api: doubles } }));
vi.mock('#lib/server/db.js', () => ({ pool: {} }));
vi.mock('#lib/server/admin-alerts.js', () => ({
  recordSystemFailure: doubles.recordSystemFailure
}));
vi.mock('#lib/server/auth/session.js', () => ({ currentAccount: vi.fn() }));
vi.mock('#lib/server/auth/rate-limit.js', () => ({ allowAuthForm: doubles.allowAuthForm }));
vi.mock(
  '#lib/server/auth/client-address.js',
  () => import('../src/lib/server/auth/client-address')
);
vi.mock('#lib/server/upload-concurrency.js', () => import('../src/lib/server/upload-concurrency'));
vi.mock('#lib/server/preferences.js', () => ({ defaultPreferences: {} }));
vi.mock('better-auth/svelte-kit', () => ({
  svelteKitHandler: ({
    event,
    resolve
  }: {
    event: unknown;
    resolve: (event: unknown) => unknown;
  }) => resolve(event)
}));
vi.mock('../src/routes/_helpers', () => ({
  field: (form: FormData, name: string) => String(form.get(name) ?? '').trim()
}));

import { handle, handleError } from '../src/hooks.server';
import { actions } from '../src/routes/(auth)/[flow]/+page.server';

function event(path: string, flow = 'login', routeId = '/(auth)/[flow]') {
  return {
    route: { id: routeId },
    params: { flow },
    url: new URL(`http://localhost:5173${path}`),
    request: new Request(`http://localhost:5173${path}`, {
      method: 'POST',
      body: new URLSearchParams({ zx: 'zxabc12', password: 'Wrong-password-2026!' })
    }),
    locals: {},
    getClientAddress: () => '192.0.2.10'
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.submissions.clear();
  doubles.signInEmail.mockRejectedValue(
    new APIError('UNAUTHORIZED', { message: 'Invalid credentials' })
  );
  doubles.signUpEmail.mockResolvedValue({});
  doubles.allowAuthForm.mockImplementation(async (path: string) => {
    const count = (doubles.submissions.get(path) ?? 0) + 1;
    doubles.submissions.set(path, count);
    return count <= (path === '/account' ? 5 : 10);
  });
});

describe('authentication request boundaries', () => {
  it('keeps the original error response when an administrator alert cannot be queued', async () => {
    doubles.recordSystemFailure.mockRejectedValueOnce(new Error('Notification unavailable'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('Unexpected failure');
    expect(
      await handleError({
        error: failure,
        event: event('/login'),
        kind: 'unknown'
      } as never)
    ).toBeUndefined();
    expect(doubles.recordSystemFailure).toHaveBeenCalledWith('web', failure, 'POST /(auth)/[flow]');
    logging.mockRestore();
  });
  it('shares the login throttle across encoded credential-form URLs before checking passwords', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const requestEvent = event(attempt % 2 ? '/%6cogin' : '/login');
      const response = await handle({
        event: requestEvent,
        resolve: async () => {
          const result = await actions.default(requestEvent as never);
          return new Response(JSON.stringify(result), { status: 400 });
        }
      } as never);
      expect(response.status).toBe(attempt < 10 ? 400 : 429);
    }
    expect(doubles.signInEmail).toHaveBeenCalledTimes(10);
    expect(doubles.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: 'zxabc12@student.uni-tuebingen.de', password: 'Wrong-password-2026!' }
      })
    );
    expect(doubles.allowAuthForm.mock.calls.every(([path]) => path === '/login')).toBe(true);
  });

  it('limits encoded account credential actions even when a later query parameter names preferences', async () => {
    const resolve = vi.fn(async () => new Response('password checked'));
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await handle({
        event: event('/%61ccount?/password&/preferences', '', '/account'),
        resolve
      } as never);
      expect(response.status).toBe(attempt < 5 ? 200 : 429);
    }
    expect(resolve).toHaveBeenCalledTimes(5);
    expect(doubles.allowAuthForm.mock.calls.every(([path]) => path === '/account')).toBe(true);
  });

  it.each(['/signout', '/preferences'])('exempts the actual account %s action', async (action) => {
    const response = await handle({
      event: event(`/%61ccount?${action}&/password`, '', '/account'),
      resolve: async () => new Response('saved')
    } as never);
    expect(response.status).toBe(200);
    expect(doubles.allowAuthForm).not.toHaveBeenCalled();
  });

  it('returns the same honest registration guidance without claiming that an account was created', async () => {
    const first = await actions.default(event('/register', 'register') as never);
    const duplicate = await actions.default(event('/register', 'register') as never);
    expect(duplicate).toEqual(first);
    expect(first).toEqual({
      message:
        'Für ein neues Konto wird eine Bestätigungs-E-Mail versendet. Bei einem bestehenden Konto kannst du einen neuen Link anfordern oder das Passwort zurücksetzen.',
      zx: 'zxabc12'
    });
  });

  it('uses the adapter address for forms and the raw API, regardless of supplied IP headers', async () => {
    for (const requestEvent of [event('/login'), event('/api/auth/sign-in/email', '', '')]) {
      requestEvent.request.headers.set('x-forwarded-for', '203.0.113.100');
      requestEvent.request.headers.set('x-ppi-client-ip', '203.0.113.101');
      await handle({
        event: requestEvent,
        resolve: async (received: typeof requestEvent) => {
          expect(received.request.headers.get('x-ppi-client-ip')).toBe('192.0.2.10');
          expect(received.request.headers.has('x-forwarded-for')).toBe(false);
          return new Response('checked');
        }
      } as never);
    }
    expect(doubles.allowAuthForm).toHaveBeenCalledWith('/login', '192.0.2.10');
    expect(
      doubles.getSession.mock.calls.every(
        ([input]) => input.headers.get('x-ppi-client-ip') === '192.0.2.10'
      )
    ).toBe(true);
  });
});
