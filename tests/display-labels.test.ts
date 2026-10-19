import { describe, expect, it } from 'vitest';
import { termLabel } from '../src/lib/terms';
import { protocolCountLabel } from '../src/lib/i18n';

describe('semester labels', () => {
  it.each([
    ['de', 'SS2026', 'Sommer 26'],
    ['en', 'SS2026', 'Summer 26'],
    ['de', 'WS2026/27', 'Winter 26/27'],
    ['en', 'WS2026/27', 'Winter 26/27'],
    ['de', 'WS1999/00', 'Winter 99/00'],
    ['en', 'SS2000', 'Summer 00'],
    ['de', '', 'Nicht angegeben'],
    ['en', null, 'Not specified'],
    ['de', undefined, 'Nicht angegeben'],
    ['en', 'Summer 2020', 'Summer 2020'],
    ['de', 'WS2026', 'WS2026']
  ] as const)('formats %s %s as %s', (language, term, expected) => {
    expect(termLabel(language, term)).toBe(expected);
  });
});

describe('protocol counts', () => {
  it.each([
    ['de', 0, 'Protokolle'],
    ['de', 1, 'Protokoll'],
    ['de', '1', 'Protokoll'],
    ['de', 2, 'Protokolle'],
    ['en', '0', 'protocols'],
    ['en', 1, 'protocol'],
    ['en', '1', 'protocol'],
    ['en', 2, 'protocols']
  ] as const)('uses %s %s: %s', (language, count, expected) => {
    expect(protocolCountLabel(language, count)).toBe(expected);
  });
});
