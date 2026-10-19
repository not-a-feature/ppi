import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  purchaseLectureAccess: vi.fn(),
  requestArchive: vi.fn(),
  getArchive: vi.fn(),
  getLectureArchive: vi.fn(),
  getLecture: vi.fn(),
  reportContent: vi.fn(),
  DomainError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  }
}));
vi.mock('$lib/server/domain', () => mocks);
vi.mock('$lib/server/archives', () => mocks);
import { actions } from '../src/routes/lectures/[id]/+page.server';
import { GET } from '../src/routes/archives/[id]/status/+server';

const actor = { id: 'student', isAdmin: false };
function event() {
  return {
    locals: { actor, preferences: { language: 'de' } },
    params: { id: 'lecture' },
    request: new Request('http://localhost/lectures/lecture', {
      method: 'POST',
      body: new URLSearchParams({ requestKey: 'purchase-key' })
    })
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.purchaseLectureAccess.mockResolvedValue({ charged: 1 });
  mocks.requestArchive.mockResolvedValue({ id: 'archive', status: 'queued' });
});

it('automatically queues a ZIP only after access is purchased, without redirecting away', async () => {
  const result = await actions.purchase(event() as never);
  expect(result).toEqual({ message: 'Zugang freigeschaltet.' });
  expect(mocks.purchaseLectureAccess).toHaveBeenCalledWith(actor, 'lecture', 'purchase-key');
  expect(mocks.requestArchive).toHaveBeenCalledWith(actor, 'lecture');
  expect(mocks.purchaseLectureAccess.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.requestArchive.mock.invocationCallOrder[0]
  );
});

it('does not queue a ZIP after a failed purchase', async () => {
  mocks.purchaseLectureAccess.mockRejectedValue(
    new mocks.DomainError(409, 'insufficient_credits', 'Insufficient credits')
  );
  expect(await actions.purchase(event() as never)).toMatchObject({ status: 409 });
  expect(mocks.requestArchive).not.toHaveBeenCalled();
});

it('keeps the purchase successful if ZIP limits prevent preparation', async () => {
  mocks.requestArchive.mockRejectedValue(
    new mocks.DomainError(413, 'archive_too_large', 'Download individual files instead.')
  );
  expect(await actions.purchase(event() as never)).toEqual({
    message: 'Zugang freigeschaltet.',
    error: 'Download individual files instead.'
  });
  expect(mocks.purchaseLectureAccess).toHaveBeenCalledTimes(1);
});

it('prepares a replacement download on the same lecture page without charging', async () => {
  expect(await actions.archive(event() as never)).toEqual({});
  expect(mocks.requestArchive).toHaveBeenCalledWith(actor, 'lecture');
  expect(mocks.purchaseLectureAccess).not.toHaveBeenCalled();
});

it('serves private status to the current account and rejects anonymous polling', async () => {
  mocks.getArchive.mockResolvedValue({ id: 'archive', status: 'ready' });
  const response = await GET({ locals: { actor }, params: { id: 'archive' } } as never);
  expect(mocks.getArchive).toHaveBeenCalledWith(actor, 'archive');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ id: 'archive', status: 'ready' });
  mocks.getArchive.mockClear();
  await expect(
    GET({ locals: { actor: null }, params: { id: 'archive' } } as never)
  ).rejects.toMatchObject({ status: 401 });
  expect(mocks.getArchive).not.toHaveBeenCalled();
});
