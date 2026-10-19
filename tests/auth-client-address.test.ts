import { describe, expect, it } from 'vitest';
import { getIP } from 'better-auth/api';
import {
  clientAddressHeader,
  requestWithClientAddress,
  validateProxyConfiguration
} from '../src/lib/server/auth/client-address';

describe('authentication client address boundary', () => {
  it('replaces forged IP headers with the adapter address without changing form data or origin', async () => {
    const request = requestWithClientAddress(
      new Request('http://localhost:5173/login', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
          [clientAddressHeader]: '203.0.113.3'
        },
        body: new URLSearchParams({ zx: 'zxabc12', password: 'Test-password-2026!' })
      }),
      '192.0.2.10'
    );
    expect(request.headers.get(clientAddressHeader)).toBe('192.0.2.10');
    expect(request.headers.has('x-forwarded-for')).toBe(false);
    expect(request.headers.has('x-real-ip')).toBe(false);
    expect(request.headers.get('origin')).toBe('https://attacker.example');
    expect((await request.formData()).get('zx')).toBe('zxabc12');
    expect(
      getIP(request, { advanced: { ipAddress: { ipAddressHeaders: [clientAddressHeader] } } })
    ).toBe('192.0.2.10');
  });

  it('keeps different resolved clients separate and groups equivalent IPv6 and mapped IPv4 addresses', () => {
    const request = new Request('http://localhost:5173/api/auth/sign-in/email');
    const resolved = (address: string) =>
      requestWithClientAddress(request, address).headers.get(clientAddressHeader);
    expect(resolved('192.0.2.10')).not.toBe(resolved('192.0.2.11'));
    expect(resolved('::ffff:192.0.2.10')).toBe(resolved('192.0.2.10'));
    expect(resolved('2001:db8:1234:5678::1')).toBe(resolved('2001:db8:1234:5678::2'));
    expect(resolved('2001:db8:1234:5678::1')).not.toBe(resolved('2001:db8:1234:5679::1'));
    expect(() => resolved('')).toThrow('valid client IP');
  });

  it('requires the documented production proxy mode and rejects forwarded-IP trust in direct development', () => {
    expect(() => validateProxyConfiguration({ NODE_ENV: 'development' })).not.toThrow();
    expect(() =>
      validateProxyConfiguration({ NODE_ENV: 'development', ADDRESS_HEADER: 'x-forwarded-for' })
    ).toThrow('Direct development');
    expect(() => validateProxyConfiguration({ NODE_ENV: 'production' })).toThrow('ADDRESS_HEADER');
    expect(() =>
      validateProxyConfiguration({
        NODE_ENV: 'production',
        ADDRESS_HEADER: 'x-forwarded-for',
        XFF_DEPTH: '2'
      })
    ).toThrow('XFF_DEPTH');
    expect(() =>
      validateProxyConfiguration({
        NODE_ENV: 'production',
        ADDRESS_HEADER: 'x-forwarded-for',
        XFF_DEPTH: '1'
      })
    ).not.toThrow();
  });
});
