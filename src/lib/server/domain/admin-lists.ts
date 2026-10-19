import { transaction } from '../db.js';
import { currentActor, requireCondition, type Actor } from './shared.js';

const queries = {
  audit: 'SELECT * FROM audit_event',
  credits: `SELECT t.*,u.email FROM token_request t JOIN "user" u ON u.id=t.user_id`,
  reports: `SELECT c.*,u.email reporter_email,l.name lecture_name,f.original_name
    FROM content_report c JOIN "user" u ON u.id=c.reporter_id
    LEFT JOIN lecture l ON l.id=c.lecture_id
    LEFT JOIN submission s ON s.id=c.submission_id
    LEFT JOIN submission_revision r ON r.id=s.current_revision_id
    LEFT JOIN stored_file f ON f.id=r.file_id`
};
const searchFields = {
  audit: ['id::text', 'actor_id', 'action', 'entity_id', 'detail::text', 'created_at::text'],
  credits: [
    'id::text',
    'user_id',
    'email',
    'explanation',
    'status',
    'amount::text',
    'resolved_by',
    'reason',
    'created_at::text'
  ],
  reports: [
    'id::text',
    'reporter_id',
    'reporter_email',
    'lecture_id::text',
    'submission_id::text',
    'lecture_name',
    'original_name',
    'category',
    'explanation',
    'status',
    'resolved_by',
    'resolution',
    'created_at::text'
  ]
};

export async function listAdminEntries(
  actor: Actor,
  section: keyof typeof queries,
  options: { search?: string; page?: number; scope?: string; paginate?: boolean } = {}
) {
  const { search = '', page: requestedPage = 1, scope = 'all' } = options;
  requireCondition(
    Number.isSafeInteger(requestedPage) && requestedPage > 0,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  requireCondition(search.length <= 200, 400, 'invalid_search', 'Search is too long.');
  const pageSize = 30;
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await currentActor(client, actor, true);
    const values: unknown[] = [];
    const filters: string[] = [];
    if (search) {
      values.push(search);
      filters.push(
        `(${searchFields[section].map((field) => `strpos(lower(${field}),lower($1))>0`).join(' OR ')})`
      );
    }
    if (scope !== 'all')
      filters.push(
        section === 'audit' ? 'false' : `status='${section === 'credits' ? 'pending' : 'open'}'`
      );
    const filter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total =
      options.paginate === false
        ? 0
        : Number(
            (
              await client.query(
                `SELECT count(*) FROM (${queries[section]}) entry ${filter}`,
                values
              )
            ).rows[0].count
          );
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const entries = (
      await client.query(
        `SELECT * FROM (${queries[section]}) entry ${filter} ORDER BY created_at DESC,id DESC ${options.paginate === false ? '' : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`}`,
        options.paginate === false ? values : [...values, pageSize, (page - 1) * pageSize]
      )
    ).rows;
    return { entries, page, total: options.paginate === false ? entries.length : total, pageSize };
  });
}
