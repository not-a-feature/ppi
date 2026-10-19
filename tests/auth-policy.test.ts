import { describe, expect, it } from 'vitest';
import { studentEmail, studentEmailPattern } from '../src/lib/server/auth/policy';

describe('student registration boundary', () => {
  it('normalizes a complete identifier before constructing its address', () => {
    expect(studentEmail('  ZXabc01  ')).toBe('zxabc01@student.uni-tuebingen.de');
  });

  it.each([
    'zxabc01@student.uni-tuebingen.de.attacker.example',
    'zxabc01+alias@student.uni-tuebingen.de',
    'prefixzxabc01@student.uni-tuebingen.de',
    'zxabc01@uni-tuebingen.de',
    'zxabc01@student.uni-tuebingen.de\n',
    'admin@student.uni-tuebingen.de',
    'zxabc01@studentXuni-tuebingenXde',
    'zxabc01@attacker.example'
  ])('rejects %s', (email) => {
    expect(studentEmailPattern.test(email)).toBe(false);
    expect(() => studentEmail(email)).toThrow();
  });
});
