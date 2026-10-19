import { describe, expect, it } from 'vitest';
import { isValidTerm, termOptions } from '../src/lib/terms';

describe('semester options', () => {
  it('shows the eight semesters from six before to one after the April summer semester', () => {
    expect(termOptions(new Date('2026-04-01T10:00:00Z')).map(({ value }) => value)).toEqual([
      'SS2023',
      'WS2023/24',
      'SS2024',
      'WS2024/25',
      'SS2025',
      'WS2025/26',
      'SS2026',
      'WS2026/27'
    ]);
  });

  it('uses the winter semester from October through March, including January', () => {
    const october = termOptions(new Date('2026-10-01T10:00:00Z')).map(({ value }) => value);
    const january = termOptions(new Date('2027-01-15T10:00:00Z')).map(({ value }) => value);
    const expected = [
      'WS2023/24',
      'SS2024',
      'WS2024/25',
      'SS2025',
      'WS2025/26',
      'SS2026',
      'WS2026/27',
      'SS2027'
    ];

    expect(october).toEqual(expected);
    expect(january).toEqual(expected);
    expect(october).toHaveLength(8);
  });

  it('validates canonical legacy terms while allowing an explicitly inherited older term', () => {
    const now = new Date('2026-12-31T23:30:00Z');

    expect(isValidTerm('SS2017', now)).toBe(true);
    expect(isValidTerm('SS2010', now)).toBe(false);
    expect(isValidTerm('SS2010', now, 'SS2010')).toBe(true);
    expect(isValidTerm('', now)).toBe(false);
    expect(isValidTerm('', now, '')).toBe(true);
    expect(isValidTerm('WS2026/28', now, 'WS2026/28')).toBe(false);
  });
});
