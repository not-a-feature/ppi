import { describe, expect, it } from 'vitest';
import { classifyJobFailure, jobFailures } from '../src/lib/job-failures';
import { shingleSimilarity } from '../src/lib/server/content-fingerprints';
import { t } from '../src/lib/i18n';

describe('job failure explanations', () => {
  it.each([
    ['57014', 'timeout'],
    ['55P03', 'timeout'],
    ['ECONNREFUSED', 'connection'],
    ['EAUTH', 'mail'],
    ['ENOENT', 'file_missing'],
    ['ENOSPC', 'storage']
  ])('classifies %s safely', (code, expected) => {
    const failure = classifyJobFailure(
      Object.assign(new Error('private password and file path'), { code })
    );
    expect(failure).toBe(expected);
    expect(JSON.stringify(jobFailures[failure])).not.toContain('private password');
    expect(t('de', jobFailures[failure].message)).toBeTruthy();
    expect(t('en', jobFailures[failure].hint)).toBeTruthy();
  });
  it('recognizes historical timeout messages without exposing their contents', () => {
    expect(classifyJobFailure('canceling statement due to statement timeout')).toBe('timeout');
    expect(classifyJobFailure('Unknown private details')).toBe('unknown');
  });
});

describe('sorted shingle similarity', () => {
  it('preserves Jaccard scores at the moderation threshold and for empty or disjoint sets', () => {
    expect(shingleSimilarity(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e'])).toBe(0.8);
    expect(shingleSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(shingleSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
    expect(shingleSimilarity([], [])).toBe(0);
  });
});
