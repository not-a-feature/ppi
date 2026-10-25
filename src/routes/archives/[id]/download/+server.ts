import { Readable } from 'node:stream';
import { error, redirect } from '@sveltejs/kit';
import { getArchive, getArchiveDownload } from '#lib/server/archives.js';
import { DomainError } from '#lib/server/domain/index.js';
import { errorMessage } from '../../../_helpers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.actor) error(401, 'Bitte anmelden.');
  try {
    const file = await getArchiveDownload(locals.actor, params.id, true);
    const stream = Readable.toWeb(file.handle!.createReadStream());
    return new Response(stream as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': file.mediaType,
        'Content-Length': String(file.byteCount),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'"
      }
    });
  } catch (cause) {
    if (cause instanceof DomainError && cause.code === 'archive_invalidated') {
      const archive = await getArchive(locals.actor, params.id);
      redirect(303, `/lectures/${archive.lecture_id}#course-access`);
    }
    if (cause instanceof DomainError) error(cause.status, errorMessage(cause));
    throw cause;
  }
};
