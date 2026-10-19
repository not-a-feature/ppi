import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ building: false }));
vi.mock('$lib/server/auth', () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get('x-test-user');
        return id ? { user: { id, emailVerified: true }, session: { id } } : null;
      }
    }
  }
}));
vi.mock('$lib/server/db', () => ({ pool: {} }));
vi.mock('$lib/server/auth/session', () => ({
  currentAccount: async (id: string) => ({
    actor: { id, email: 'zxabc01@student.uni-tuebingen.de', isAdmin: false },
    preferences: { language: id === 'english' ? 'en' : 'de', theme: 'auto' }
  })
}));
vi.mock('$lib/server/auth/rate-limit', () => ({ allowAuthForm: async () => true }));
vi.mock('$lib/server/auth/client-address', () => import('../src/lib/server/auth/client-address'));
vi.mock('$lib/server/upload-concurrency', () => import('../src/lib/server/upload-concurrency'));
vi.mock('$lib/server/preferences', () => ({
  defaultPreferences: { language: 'de', theme: 'auto' }
}));
vi.mock('better-auth/svelte-kit', () => ({
  svelteKitHandler: ({
    event,
    resolve
  }: {
    event: unknown;
    resolve: (event: unknown) => unknown;
  }) => resolve(event)
}));

import { handle } from '../src/hooks.server';

function requestEvent(userId: string, routeId = '/upload', query = '') {
  const url = new URL(`http://localhost:5173${routeId}${query}`);
  return {
    route: { id: routeId },
    params: {},
    url,
    request: new Request(url, {
      method: 'POST',
      headers: userId ? { 'x-test-user': userId } : {},
      body: new URLSearchParams({ example: 'body parsed only after admission' })
    }),
    locals: {},
    getClientAddress: () => '192.0.2.1'
  };
}

async function holdUpload(userId: string) {
  let entered!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const waiting = new Promise<void>((resolve) => (finish = resolve));
  const response = handle({
    event: requestEvent(userId),
    resolve: async ({ request }: { request: Request }) => {
      await request.formData();
      entered();
      await waiting;
      return new Response('uploaded');
    }
  } as never);
  await started;
  return { response, finish };
}

describe('upload admission before multipart parsing', () => {
  it('allows four accounts, rejects duplicate improvements and a fifth body, and releases completed slots', async () => {
    const held: Awaited<ReturnType<typeof holdUpload>>[] = [];
    try {
      for (const user of ['english', 'second', 'third', 'fourth'])
        held.push(await holdUpload(user));
      const parse = vi.fn(async ({ request }: { request: Request }) => {
        await request.formData();
        return new Response('uploaded');
      });
      const duplicate = await handle({
        event: requestEvent('english', '/submissions/[id]', '?/improve'),
        resolve: parse
      } as never);
      expect(duplicate.status).toBe(429);
      expect(duplicate.headers.get('retry-after')).toBe('2');
      expect(await duplicate.text()).toContain('Uploads are busy');
      const fifth = await handle({ event: requestEvent('fifth'), resolve: parse } as never);
      expect(fifth.status).toBe(429);
      expect(await fifth.text()).toContain('Dateien hochgeladen');
      expect(parse).not.toHaveBeenCalled();

      const otherPage = await handle({
        event: requestEvent('english', '/lectures'),
        resolve: async () => new Response('unaffected')
      } as never);
      expect(otherPage.status).toBe(200);
      const anonymous = await handle({
        event: requestEvent(''),
        resolve: async () => new Response(null, { status: 303, headers: { Location: '/login' } })
      } as never);
      expect(anonymous.status).toBe(303);
      expect(anonymous.headers.get('location')).toBe('/login');

      held[0].finish();
      await held[0].response;
      const retry = await handle({ event: requestEvent('fifth'), resolve: parse } as never);
      expect(retry.status).toBe(200);
      expect(parse).toHaveBeenCalledOnce();
    } finally {
      for (const upload of held) upload.finish();
      await Promise.all(held.map((upload) => upload.response));
    }
  });

  it.each([new Error('processing failed'), { status: 303, location: '/submissions/next' }])(
    'releases the account slot when request processing throws %j',
    async (failure) => {
      await expect(
        handle({
          event: requestEvent('release-test'),
          resolve: async () => {
            throw failure;
          }
        } as never)
      ).rejects.toEqual(failure);
      const retry = await handle({
        event: requestEvent('release-test'),
        resolve: async () => new Response('uploaded')
      } as never);
      expect(retry.status).toBe(200);
    }
  );
});
