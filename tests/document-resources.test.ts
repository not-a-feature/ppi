import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDocumentText } from '../src/lib/server/document-text.js';

async function validPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('A valid protocol after a failed extraction.', { font });
  return pdf.save();
}

function compressedPdf() {
  const stream = deflateSync(
    Buffer.from(`BT /F1 12 Tf 10 750 Td ${'(word) Tj 0 -0.001 Td\n'.repeat(3_000_000)} ET`)
  );
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from('\nendstream')
    ])
  ];
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offsets: number[] = [];
  let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n')
    ]);
    offsets.push(length);
    parts.push(part);
    length += part.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`
    )
  );
  return Buffer.concat(parts);
}

afterEach(() => vi.unstubAllEnvs());

describe('isolated PDF extraction resource limits', () => {
  it('kills an extraction at its deadline and can parse the next PDF', async () => {
    const bytes = await validPdf();
    vi.stubEnv('PDF_EXTRACT_TIMEOUT_MS', '1');
    await expect(extractDocumentText(bytes, 'application/pdf')).rejects.toThrow(
      'PDF extraction exceeded its resource limit or failed'
    );
    vi.stubEnv('PDF_EXTRACT_TIMEOUT_MS', '10000');
    const result = await extractDocumentText(bytes, 'application/pdf');
    expect(result.reason).toBe('');
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('A valid protocol after a failed extraction.');
  });

  it('contains a small compressed PDF with excessive text operations', async () => {
    const bytes = compressedPdf();
    expect(bytes.length).toBeLessThan(170_000);
    vi.stubEnv('PDF_EXTRACT_TIMEOUT_MS', '2000');
    await expect(extractDocumentText(bytes, 'application/pdf')).rejects.toThrow(
      'PDF extraction exceeded its resource limit or failed'
    );
    vi.stubEnv('PDF_EXTRACT_TIMEOUT_MS', '10000');
    expect((await extractDocumentText(await validPdf(), 'application/pdf')).text).toContain(
      'A valid protocol after a failed extraction.'
    );
  });
});
