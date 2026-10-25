import { listAdminEntries } from '#lib/server/domain/admin-lists.js';
import { admin, loadResult } from '../../../_helpers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const current = admin(locals);
  const query = (url.searchParams.get('q') ?? '').trim();
  const { entries, page, pageSize, total } = await loadResult(() =>
    listAdminEntries(current, 'audit', {
      search: query,
      page: Number(url.searchParams.get('page') ?? 1)
    })
  );
  return new Response(
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        scope: 'displayed_entries',
        query,
        page,
        page_size: pageSize,
        total,
        entries
      },
      null,
      2
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ppi-log-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'private, no-store'
      }
    }
  );
};
