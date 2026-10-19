import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitProtocol: vi.fn(),
  reviseProtocol: vi.fn(),
  listUploadLectures: vi.fn(),
  listExaminerSuggestions: vi.fn(),
  getSubmission: vi.fn(),
  requestReconsideration: vi.fn(),
  storeUpload: vi.fn(),
  cleanupUnreferencedUpload: vi.fn(),
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
vi.mock('$lib/server/storage', () => mocks);
vi.mock('$lib/terms', () => import('../src/lib/terms'));
import { actions as upload } from '../src/routes/upload/+page.server';
import { actions as submission } from '../src/routes/submissions/[id]/+page.server';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storeUpload.mockResolvedValue({ storageKey: 'test-file' });
  mocks.cleanupUnreferencedUpload.mockResolvedValue(undefined);
  mocks.submitProtocol.mockResolvedValue({ submissionId: 'submission' });
});

function event(examinerName: string, examDate: string) {
  const form = new FormData();
  form.set('file', new File(['Test exam'], 'exam.txt'));
  form.set('attested', 'on');
  form.set('examinerName', examinerName);
  form.set('examDate', examDate);
  form.set('term', 'WS2026/27');
  return {
    locals: { actor: { id: 'student' } },
    params: { id: 'submission' },
    request: new Request('http://localhost/upload', { method: 'POST', body: form })
  };
}

describe('upload required details', () => {
  const action = upload.default;
  it.each([
    ['   ', '2026-10-18'],
    ['Dr. Example', ''],
    ['Dr. Example', '2026-02-30'],
    ['Dr. Example', 'not-a-date']
  ])('rejects missing or invalid details before storing bytes: %s / %s', async (name, date) => {
    const result = await action(event(name, date) as never);
    expect(result).toMatchObject({
      status: 400,
      data: { values: { examinerName: name.trim(), examDate: date } }
    });
    expect(mocks.storeUpload).not.toHaveBeenCalled();
    expect(mocks.submitProtocol).not.toHaveBeenCalled();
    expect(mocks.reviseProtocol).not.toHaveBeenCalled();
  });

  it('accepts complete details, including a valid leap day', async () => {
    await expect(action(event('Dr. Example', '2024-02-29') as never)).rejects.toMatchObject({
      status: 303,
      location: '/submissions/submission'
    });
    expect(mocks.storeUpload).toHaveBeenCalledTimes(1);
  });
});

describe('improvement exam details', () => {
  it('does not require or accept a replacement exam date', async () => {
    for (const date of ['', 'not-a-date', '2024-02-29']) {
      await expect(submission.improve(event('Dr. Example', date) as never)).rejects.toMatchObject({
        status: 303
      });
      expect(mocks.reviseProtocol).toHaveBeenLastCalledWith(
        expect.anything(),
        'submission',
        expect.not.objectContaining({ examDate: expect.anything() })
      );
    }
  });
  it('still requires an examiner before storing bytes', async () => {
    expect(await submission.improve(event('', '') as never)).toMatchObject({ status: 400 });
    expect(mocks.storeUpload).not.toHaveBeenCalled();
  });
});
