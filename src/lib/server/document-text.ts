import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { MAX_CONTENT_CHARACTERS } from './content-fingerprints.js';

export type DocumentText = {
  text: string;
  pageCount: number | null;
  textlessPages: number;
  ocrPages: number[];
  pageWordCounts: number[];
  reason: string;
};

export async function extractDocumentText(
  bytes: Uint8Array,
  mediaType: string
): Promise<DocumentText> {
  if (mediaType === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      text,
      pageCount: null,
      textlessPages: 0,
      ocrPages: [],
      pageWordCounts: [],
      reason: text.length > MAX_CONTENT_CHARACTERS ? 'text_limit' : ''
    };
  }
  const timeout = Number(process.env.PDF_EXTRACT_TIMEOUT_MS ?? 10000);
  assert(
    Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 30000,
    'PDF_EXTRACT_TIMEOUT_MS must be between 1 and 30000'
  );
  return new Promise<DocumentText>((resolveResult, reject) => {
    const child = fork(resolve('worker/extract-pdf.mjs'), [], {
      execArgv: ['--max-old-space-size=192'],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP
      }
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    let received = false;
    child.once('message', (result: DocumentText | { error: string }) => {
      received = true;
      if ('error' in result) reject(new Error('PDF extraction failed'));
      else resolveResult(result);
    });
    child.once('error', () => reject(new Error('PDF extraction could not start')));
    child.once('exit', () => {
      clearTimeout(timer);
      if (!received) reject(new Error('PDF extraction exceeded its resource limit or failed'));
    });
    child.send({ bytes, maxCharacters: MAX_CONTENT_CHARACTERS });
  });
}
