import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

process.once('message', async ({ bytes, maxCharacters }) => {
  const task = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    maxImageSize: 20_000_000,
    standardFontDataUrl: fileURLToPath(
      new URL('standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))
    ).replaceAll('\\', '/'),
    stopAtErrors: true
  });
  try {
    const pdf = await task.promise;
    const result = {
      text: '',
      pageCount: pdf.numPages,
      textlessPages: 0,
      ocrPages: [],
      pageWordCounts: [],
      reason: ''
    };
    if (pdf.numPages > 50) result.reason = 'page_limit';
    else {
      const pages = [];
      let length = 0;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('');
        length += text.length;
        if (length > maxCharacters) {
          result.reason = 'text_limit';
          break;
        }
        const wordCount = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
        if (!wordCount) {
          result.textlessPages++;
          const operators = await page.getOperatorList();
          if (
            operators.fnArray.some((op) =>
              [
                OPS.paintImageXObject,
                OPS.paintInlineImageXObject,
                OPS.paintImageMaskXObject
              ].includes(op)
            )
          )
            result.ocrPages.push(number);
        }
        result.pageWordCounts.push(wordCount);
        pages.push(text);
        page.cleanup();
      }
      if (!result.reason) result.text = pages.join('\n');
    }
    await task.destroy();
    process.send(result, () => process.disconnect());
  } catch {
    await task.destroy();
    process.send({ error: 'invalid_document' }, () => process.disconnect());
  }
});
