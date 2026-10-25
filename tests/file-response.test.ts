import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({ getDownload: vi.fn(), readStoredFile: vi.fn() }));
vi.mock('#lib/server/domain/index.js', () => ({
  getDownload: doubles.getDownload,
  DomainError: class extends Error {}
}));
vi.mock('#lib/server/download-delivery.js', () => ({ getDeliveryBytes: doubles.readStoredFile }));
import { GET } from '../src/routes/files/[id]/+server';

function event(preview = true, actor: object | null = { id: 'reader' }) {
  return {
    locals: { actor },
    params: { id: 'revision' },
    url: new URL(`http://localhost/files/revision${preview ? '?preview=1' : ''}`)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.getDownload.mockResolvedValue({
    storageKey: 'private-file',
    originalName: 'Prüfung.pdf',
    mediaType: 'application/pdf'
  });
  doubles.readStoredFile.mockResolvedValue(Buffer.from('%PDF-test'));
});

describe('private file previews', () => {
  it('previews authorized PDFs inline without caching and preserves attachment downloads', async () => {
    const preview = await GET(event() as never);
    expect(doubles.getDownload).toHaveBeenCalledWith({ id: 'reader' }, 'revision');
    expect(preview.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(preview.headers.get('Content-Type')).toBe('application/pdf');
    expect(preview.headers.get('Cache-Control')).toBe('private, no-store');
    expect(preview.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
    expect(await preview.text()).toBe('%PDF-test');
    const download = await GET(event(false) as never);
    expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  });

  it('serves UTF-8 text as sandboxed plain text rather than executable HTML', async () => {
    doubles.getDownload.mockResolvedValue({
      storageKey: 'text',
      originalName: 'exam.txt',
      mediaType: 'text/plain'
    });
    doubles.readStoredFile.mockResolvedValue(Buffer.from('<script>alert("test")</script> Prüfung'));
    const response = await GET(event() as never);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox;');
    expect(await response.text()).toContain('<script>');
  });

  it('does not read private file bytes when authorization fails', async () => {
    const denied = new Error('File unavailable');
    doubles.getDownload.mockRejectedValue(denied);
    await expect(GET(event() as never)).rejects.toBe(denied);
    expect(doubles.readStoredFile).not.toHaveBeenCalled();
  });

  it('requires a signed-in account before looking up a preview', async () => {
    await expect(GET(event(true, null) as never)).rejects.toMatchObject({ status: 401 });
    expect(doubles.getDownload).not.toHaveBeenCalled();
  });
  it('rechecks access after preparing the response so revoked access cannot deliver buffered bytes', async () => {
    doubles.getDownload.mockReset();
    const denied = new Error('Access revoked');
    doubles.getDownload
      .mockResolvedValueOnce({
        storageKey: 'private',
        mediaType: 'text/plain',
        originalName: 'exam.txt'
      })
      .mockRejectedValueOnce(denied);
    await expect(GET(event() as never)).rejects.toBe(denied);
    expect(doubles.getDownload).toHaveBeenCalledTimes(2);
  });
});
