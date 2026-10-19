import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { watermarkDocument, downloadDay } from '../src/lib/server/download-watermark.js';
import { extractDocumentText } from '../src/lib/server/document-text.js';

describe('personal download watermarks', () => {
  it('preserves source text and page geometry, including rotated cropped pages', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const rotation of [0, 90, 180, 270]) {
      const page = pdf.addPage([595, 842]);
      page.setCropBox(20, 30, 550, 780);
      page.setRotation(degrees(rotation));
      page.drawText('Original exam question and answer.', { x: 60, y: 400, font, size: 12 });
    }
    const original = await pdf.save();
    const bytes = await watermarkDocument(original, 'application/pdf', 'zxabc02', '2026-10-19');
    const result = await PDFDocument.load(bytes);
    expect(result.getPages().map((p) => [p.getCropBox(), p.getRotation().angle])).toEqual(
      pdf.getPages().map((p) => [p.getCropBox(), p.getRotation().angle])
    );
    const text = await extractDocumentText(bytes, 'application/pdf');
    expect(text.text.match(/PPI - zxabc02 - 19.10.2026/g)).toHaveLength(4);
    expect(text.text.match(/Original exam question and answer/g)).toHaveLength(4);
    expect((await extractDocumentText(original, 'application/pdf')).text).not.toContain('zxabc02');
  });
  it('marks TXT files and separates the downloader identities', async () => {
    const source = Buffer.from('Original text.');
    const first = await watermarkDocument(source, 'text/plain', 'zxabc02', '2026-10-19');
    const second = await watermarkDocument(source, 'text/plain', 'zxabc03', '2026-10-19');
    expect(first.toString()).toBe('PPI - zxabc02 - 19.10.2026\n\nOriginal text.');
    expect(second.toString()).not.toContain('zxabc02');
    expect(source.toString()).toBe('Original text.');
  });
  it('uses the Berlin download date across UTC day boundaries', () => {
    expect(downloadDay(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19');
    expect(downloadDay(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
});
