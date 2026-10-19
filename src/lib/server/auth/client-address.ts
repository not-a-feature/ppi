import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { getIP } from 'better-auth/api';

export const clientAddressHeader = 'x-ppi-client-ip';

export function validateProxyConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV === 'production') {
    assert.equal(
      environment.ADDRESS_HEADER,
      'x-forwarded-for',
      'Production web requires ADDRESS_HEADER=x-forwarded-for behind the private nginx ingress.'
    );
    assert.equal(environment.XFF_DEPTH ?? '1', '1', 'Production web requires XFF_DEPTH=1.');
  } else {
    assert(
      !environment.ADDRESS_HEADER,
      'Direct development web must leave ADDRESS_HEADER unset so client headers cannot spoof addresses.'
    );
  }
}

export function requestWithClientAddress(request: Request, address: string): Request {
  assert(isIP(address), 'The web adapter must resolve a valid client IP address.');
  const options = { advanced: { ipAddress: { ipAddressHeaders: [clientAddressHeader] } } };
  const normalized = getIP(new Headers({ [clientAddressHeader]: address }), options);
  assert(normalized, 'The web adapter client address could not be normalized.');
  const headers = new Headers(request.headers);
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  headers.set(clientAddressHeader, normalized);
  return new Request(request, { headers });
}
