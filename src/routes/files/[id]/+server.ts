import { error } from '@sveltejs/kit';
import { DomainError, getDownload } from '$lib/server/domain/index.js';
import { getDeliveryBytes } from '$lib/server/download-delivery.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.actor) error(401, 'Bitte anmelden.');
  try {
    const file = await getDownload(locals.actor, params.id);
    const preview = url.searchParams.get('preview') === '1';
    const data = await getDeliveryBytes(file, locals.actor, { preview });
    await getDownload(locals.actor, params.id);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type':
          file.mediaType === 'text/plain' ? 'text/plain; charset=utf-8' : file.mediaType,
        'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'"
      }
    });
  } catch (cause) {
    if (cause instanceof DomainError) error(cause.status, cause.message);
    throw cause;
  }
};
