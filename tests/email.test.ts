import { describe, expect, it } from 'vitest';
import { renderEmailHtml } from '../src/lib/server/email';

describe('email HTML rendering', () => {
  it('escapes subject and message text and links only secure same-origin auth URLs', () => {
    const html = renderEmailHtml(
      'PPI <img src=x onerror=alert(1)>',
      'Bestätigen / Verify email:\nhttps://ppi.example.test/api/auth/verify-email?token=abc&callbackURL=%2Flectures\n\nReset password:\nhttps://ppi.example.test/api/auth/reset-password/abc123?callbackURL=%2Freset-password\n\n<img src=x onerror=alert(1)>\nhttps://evil.example.test/steal\n\nhttp://ppi.example.test/api/auth/verify-email?token=abc\n\nhttps://ppi.example.test/profile',
      'https://ppi.example.test'
    );

    expect(html).toContain('PPI &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain(
      'href="https://ppi.example.test/api/auth/verify-email?token=abc&amp;callbackURL=%2Flectures"'
    );
    expect(html).toContain(
      'href="https://ppi.example.test/api/auth/reset-password/abc123?callbackURL=%2Freset-password"'
    );
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('href="https://evil.example.test/steal"');
    expect(html).not.toContain('href="http://ppi.example.test/api/auth/verify-email?token=abc"');
    expect(html).not.toContain('href="https://ppi.example.test/profile"');
  });
});
