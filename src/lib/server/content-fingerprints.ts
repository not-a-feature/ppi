import { createHash } from 'node:crypto';

export const MIN_CONTENT_WORDS = 100;
export const MIN_SIMILARITY_WORDS = 50;
export const SIMILARITY_THRESHOLD = 0.8;
export const REPETITION_THRESHOLD = 0.5;
export const MAX_CONTENT_CHARACTERS = 500_000;

export function fingerprintText(text: string) {
  const words =
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const shingles = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i++)
    shingles.add(
      createHash('sha256')
        .update(words.slice(i, i + 5).join(' '))
        .digest('hex')
        .slice(0, 16)
    );
  const sequenceCount = Math.max(0, words.length - 4);
  return {
    wordCount: words.length,
    textHash: words.length ? createHash('sha256').update(words.join(' ')).digest('hex') : '',
    shingles: [...shingles].sort(),
    repeatedFraction: sequenceCount ? 1 - shingles.size / sequenceCount : 0
  };
}
