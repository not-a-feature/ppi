import { beforeEach, describe, expect, it, vi } from 'vitest';

const domain = vi.hoisted(() => ({
  listLecturesPage: vi.fn(),
  getSubmission: vi.fn(),
  getLecturesByIds: vi.fn(),
  listAdminLectureExaminers: vi.fn(async () => []),
  createLecture: vi.fn(),
  updateLecture: vi.fn(),
  decideLecture: vi.fn(),
  addLectureExaminer: vi.fn(),
  renameLectureExaminer: vi.fn(),
  removeLectureExaminer: vi.fn(),
  archiveLecture: vi.fn()
}));
vi.mock('$lib/server/domain', () => domain);
vi.mock('../src/routes/_helpers', () => ({
  admin: () => ({ id: 'admin', isAdmin: true }),
  loadResult: (operation: () => unknown) => operation(),
  actionResult: vi.fn(),
  field: vi.fn()
}));

import { load } from '../src/routes/admin/catalogue/+page.server';
import { namedAction } from '../src/lib/form-actions';

const reviewId = '11111111-1111-4111-8111-111111111111';
function loadCatalogue(query: string) {
  return load({
    locals: {},
    url: new URL(`https://example.test/admin/catalogue${query}`)
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  domain.getSubmission.mockResolvedValue({
    id: reviewId,
    current_revision_id: 'current',
    revisions: [
      { id: 'old', lecture_ids: ['old-lecture'] },
      { id: 'current', lecture_ids: ['pending-lecture', 'approved-lecture'] }
    ]
  });
  domain.getLecturesByIds.mockResolvedValue([
    { id: 'pending-lecture', approval_status: 'pending' },
    { id: 'approved-lecture', approval_status: 'approved' }
  ]);
});

describe('review catalogue context', () => {
  it('loads only the current revision lectures independently of filters and pagination', async () => {
    const result = await loadCatalogue(`?review=${reviewId}&q=unrelated&status=rejected&page=3`);
    expect(domain.getLecturesByIds).toHaveBeenCalledWith({ id: 'admin', isAdmin: true }, [
      'pending-lecture',
      'approved-lecture'
    ]);
    expect(domain.listLecturesPage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reviewHref: `/admin/review/${reviewId}`,
      reviewReady: false,
      page: 1
    });
  });

  it('offers return after approval while retaining the reviewed entries', async () => {
    domain.getLecturesByIds.mockResolvedValue([
      { id: 'pending-lecture', approval_status: 'approved' },
      { id: 'approved-lecture', approval_status: 'approved' }
    ]);
    const result = await loadCatalogue(`?review=${reviewId}&returnTo=https://other.test`);
    expect(result).toMatchObject({ reviewHref: `/admin/review/${reviewId}`, reviewReady: true });
    expect(result).toMatchObject({ entries: [expect.any(Object), expect.any(Object)] });
    const current = new URL(`https://example.test/admin/catalogue?review=${reviewId}`);
    expect(new URL(namedAction(current, 'decideLecture'), current).searchParams.get('review')).toBe(
      reviewId
    );
  });

  it('does not replace an invalid review reference with a generic catalogue', async () => {
    domain.getSubmission.mockRejectedValue(new Error('Unknown submission'));
    await expect(loadCatalogue('?review=unknown')).rejects.toThrow('Unknown submission');
    expect(domain.listLecturesPage).not.toHaveBeenCalled();
  });

  it('keeps ordinary catalogue searches paginated', async () => {
    domain.listLecturesPage.mockResolvedValue({ items: [], page: 2, pageSize: 30, total: 40 });
    const result = await loadCatalogue('?q=Biology&status=pending&page=2');
    expect(domain.listLecturesPage).toHaveBeenCalledWith(
      { id: 'admin', isAdmin: true },
      { search: 'Biology', page: 2, includeProposals: true, approvalStatus: 'pending' }
    );
    expect(domain.getSubmission).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reviewHref: null, reviewReady: false, page: 2 });
  });
});
