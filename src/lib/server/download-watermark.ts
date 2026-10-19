import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { zxId } from './domain/shared.js';

export function downloadDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function watermarkDocument(
  bytes: Uint8Array,
  mediaType: 'application/pdf' | 'text/plain',
  identifier: string,
  day = downloadDay()
) {
  assert(zxId.test(identifier), 'A student identifier is required for the download watermark');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day), 'A download date is required');
  const [year, month, date] = day.split('-');
  const label = `PPI - ${identifier} - ${date}.${month}.${year}`;
  if (mediaType === 'text/plain')
    return Buffer.concat([Buffer.from(label + '\n\n', 'utf8'), bytes]);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const box = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const width = rotation % 180 ? box.height : box.width;
    const size = Math.min(8, (width - 16) / font.widthOfTextAtSize(label, 1));
    const u = (width - font.widthOfTextAtSize(label, size)) / 2;
    const v = Math.min(10, (rotation % 180 ? box.width : box.height) / 20);
    const [x, y] =
      rotation === 90
        ? [box.x + box.width - v, box.y + u]
        : rotation === 180
          ? [box.x + box.width - u, box.y + box.height - v]
          : rotation === 270
            ? [box.x + v, box.y + box.height - u]
            : [box.x + u, box.y + v];
    page.drawText(label, {
      x,
      y,
      size,
      font,
      color: rgb(0.25, 0.25, 0.25),
      opacity: 0.65,
      rotate: degrees(rotation)
    });
  }
  return Buffer.from(await pdf.save());
}
