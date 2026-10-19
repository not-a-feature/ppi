import { describe, expect, it } from 'vitest';
import { namedAction } from '../src/lib/form-actions';

describe('named form actions', () => {
  it('preserves filters and pagination when posting without JavaScript', () => {
    const current = new URL(
      'https://example.test/admin/catalogue?q=Pr%C3%BCfung+%26+Biologie&status=pending&page=2'
    );
    const posted = new URL(namedAction(current, 'lecture'), current);

    expect(posted.pathname).toBe('/admin/catalogue');
    expect([...posted.searchParams]).toEqual([
      ['/lecture', ''],
      ['q', 'Prüfung & Biologie'],
      ['status', 'pending'],
      ['page', '2']
    ]);
    expect(current.searchParams.has('/lecture')).toBe(false);
  });

  it('replaces all previous action selectors after a failed or successful post', () => {
    const current = new URL(
      'https://example.test/admin/jobs?/retry&/cancel=&q=PDF&state=failed&page=3&scope=all&tag=a&tag=b'
    );
    const posted = new URL(namedAction(current, 'queue'), current);

    expect([...posted.searchParams]).toEqual([
      ['/queue', ''],
      ['q', 'PDF'],
      ['state', 'failed'],
      ['page', '3'],
      ['scope', 'all'],
      ['tag', 'a'],
      ['tag', 'b']
    ]);
    expect(current.searchParams.has('/retry')).toBe(true);
  });

  it('uses an ordinary named action on an unfiltered page', () => {
    expect(namedAction(new URL('https://example.test/admin/settings'), 'settings')).toBe(
      '?/settings'
    );
  });
});
