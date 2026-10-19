import {
  type Actor,
  bounded,
  currentActor,
  requireCondition,
  audit,
  requireId,
  latestPolicy,
  uploadNumberSql
} from './shared.js';
import { transaction } from '../db.js';
import type { PoolClient } from 'pg';

const CATALOGUE_PAGE_SIZE = 30;

function cataloguePage(page = 1) {
  requireCondition(
    Number.isSafeInteger(page) && page >= 1 && page <= 1000000,
    400,
    'invalid_page',
    'Invalid page number.'
  );
  return page;
}

async function paginatedCatalogue(
  client: PoolClient,
  sql: string,
  values: unknown[],
  requestedPage: number,
  orderBy: string,
  enrichment = ''
) {
  const sizeIndex = values.length + 1,
    pageIndex = values.length + 2;
  const result = (
    await client.query(
      `WITH catalogue AS (${sql}),
    pagination AS (SELECT count(*)::integer total,
      least($${pageIndex}::integer,greatest(1,ceil(count(*)::numeric/$${sizeIndex})::integer)) page FROM catalogue)
    SELECT total,page,coalesce((SELECT json_agg(enriched) FROM
      (SELECT selected.*${enrichment ? `,${enrichment}` : ''} FROM
      (SELECT * FROM catalogue ORDER BY ${orderBy} LIMIT $${sizeIndex} OFFSET ((pagination.page-1)*$${sizeIndex})) selected) enriched),'[]'::json) items
    FROM pagination`,
      [...values, CATALOGUE_PAGE_SIZE, requestedPage]
    )
  ).rows[0];
  return {
    items: result.items as Record<string, any>[],
    page: result.page as number,
    total: result.total as number,
    pageSize: CATALOGUE_PAGE_SIZE
  };
}

const visibleLectureProtocols = `FROM revision_lecture rl JOIN submission s ON s.published_revision_id=rl.revision_id
  JOIN submission_revision r ON r.id=s.published_revision_id JOIN stored_file f ON f.id=r.file_id
  WHERE rl.lecture_id=l.id AND s.visibility='published' AND f.safety_status='clean'
  AND f.deleted_at IS NULL AND s.files_deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM revision_lecture other JOIN lecture ol ON ol.id=other.lecture_id
    WHERE other.revision_id=r.id AND ol.approval_status<>'approved')`;

export async function listLecturesPage(
  actor: Actor,
  options: {
    search?: string;
    page?: number;
    includeProposals?: boolean;
    onlyWithProtocols?: boolean;
    approvalStatus?: 'all' | 'pending' | 'approved' | 'rejected';
    paginate?: boolean;
  } = {}
) {
  const {
    search = '',
    page = 1,
    includeProposals = false,
    onlyWithProtocols = false,
    approvalStatus = 'all',
    paginate = true
  } = options;
  requireCondition(
    ['all', 'pending', 'approved', 'rejected'].includes(approvalStatus),
    400,
    'invalid_input',
    'Invalid approval status.'
  );
  bounded(search, 200, false);
  cataloguePage(page);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    requireCondition(
      !includeProposals || actual.isAdmin,
      403,
      'admin_required',
      'Administrator permission is required.'
    );
    if (!paginate) {
      const items = (
        await client.query(
          `WITH counts AS (
        SELECT rl.lecture_id,count(*)::integer protocol_count
        ${visibleLectureProtocols.replace('WHERE rl.lecture_id=l.id AND', 'WHERE')}
        GROUP BY rl.lecture_id
      ) SELECT l.*,coalesce(counts.protocol_count,0) protocol_count,a.expires_at
      FROM lecture l LEFT JOIN counts ON counts.lecture_id=l.id
      LEFT JOIN lecture_access a ON a.lecture_id=l.id AND a.user_id=$1 AND a.expires_at>now()
      WHERE ($2='' OR l.name ILIKE '%'||$2||'%' OR EXISTS(SELECT 1 FROM unnest(l.aliases) alias WHERE alias ILIKE '%'||$2||'%'))
      AND ($3 OR (l.approval_status='approved' AND NOT l.archived))
      AND (NOT $4 OR coalesce(counts.protocol_count,0)>0) AND ($5='all' OR l.approval_status=$5)
      ORDER BY l.name,l.id`,
          [actor.id, search, includeProposals, onlyWithProtocols, approvalStatus]
        )
      ).rows;
      return { items, page: 1, total: items.length, pageSize: CATALOGUE_PAGE_SIZE };
    }
    return paginatedCatalogue(
      client,
      `SELECT l.* FROM lecture l
      WHERE ($2='' OR l.name ILIKE '%'||$2||'%' OR EXISTS(SELECT 1 FROM unnest(l.aliases) alias WHERE alias ILIKE '%'||$2||'%'))
      AND ($3 OR (l.approval_status='approved' AND NOT l.archived))
      AND ($5='all' OR l.approval_status=$5)
      AND (NOT $4 OR (SELECT true ${visibleLectureProtocols} LIMIT 1))`,
      [actor.id, search, includeProposals, onlyWithProtocols, approvalStatus],
      page,
      'name,id',
      `(SELECT count(*)::integer ${visibleLectureProtocols.replace('rl.lecture_id=l.id', 'rl.lecture_id=selected.id')}) protocol_count,
       (SELECT a.expires_at FROM lecture_access a WHERE a.lecture_id=selected.id AND a.user_id=$1 AND a.expires_at>now()) expires_at`
    );
  });
}

export async function getLecturesByIds(actor: Actor, ids: string[]) {
  ids.forEach(requireId);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    return (
      await client.query(
        `SELECT l.* FROM lecture l WHERE l.id=ANY($1::uuid[]) AND
      ($3 OR l.approval_status='approved' OR EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$2))
      ORDER BY l.name,l.id`,
        [ids, actor.id, actual.isAdmin]
      )
    ).rows;
  });
}

export async function listAdminLectureExaminers(actor: Actor, lectureIds: string[]) {
  lectureIds.forEach(requireId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    return (
      await client.query(
        `SELECT le.lecture_id,e.id,e.name FROM lecture_examiner le
      JOIN examiner e ON e.id=le.examiner_id WHERE le.lecture_id=ANY($1::uuid[]) AND NOT e.archived
      ORDER BY e.name,e.id`,
        [lectureIds]
      )
    ).rows;
  });
}

export async function listUploadLectures(actor: Actor) {
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    return (
      await client.query(
        `SELECT l.id,l.name,l.archived,l.approval_status FROM lecture l WHERE NOT l.archived
      AND (l.approval_status='approved' OR (l.approval_status='pending' AND ($2 OR EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$1))))
      ORDER BY l.name`,
        [actor.id, actual.isAdmin]
      )
    ).rows;
  });
}

export async function listExaminerSuggestions(actor: Actor) {
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    return (
      await client.query(
        `SELECT e.id,e.name,array_agg(DISTINCT le.lecture_id) "lectureIds" FROM examiner e
      JOIN lecture_examiner le ON le.examiner_id=e.id JOIN lecture l ON l.id=le.lecture_id
      WHERE NOT e.archived AND NOT l.archived AND (l.approval_status='approved' OR (l.approval_status='pending'
        AND ($2 OR EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$1))))
      GROUP BY e.id ORDER BY e.name`,
        [actor.id, actual.isAdmin]
      )
    ).rows;
  });
}

export async function listLectureExaminers(actor: Actor, lectureId: string) {
  requireId(lectureId);
  return transaction(async (client) => {
    const actual = await currentActor(client, actor);
    const lecture = await client.query(
      `SELECT id FROM lecture l WHERE l.id=$1 AND ($3 OR l.approval_status='approved'
      OR (l.approval_status='pending' AND EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$2)))`,
      [lectureId, actor.id, actual.isAdmin]
    );
    requireCondition(lecture.rowCount, 404, 'not_found', 'Lecture not found.');
    return (
      await client.query(
        `SELECT e.id,e.name FROM examiner e JOIN lecture_examiner le ON le.examiner_id=e.id
      WHERE le.lecture_id=$1 AND NOT e.archived ORDER BY e.name`,
        [lectureId]
      )
    ).rows;
  });
}

export async function resolveExaminerName(client: PoolClient, rawName: string) {
  const name = bounded(rawName, 200),
    normalized = name.normalize('NFKC').toLocaleLowerCase('de-DE');
  await client.query(
    'INSERT INTO examiner(name,normalized_name) VALUES($1,$2) ON CONFLICT(normalized_name) DO NOTHING',
    [name, normalized]
  );
  const examiner = (
    await client.query('SELECT id,name,archived FROM examiner WHERE normalized_name=$1 FOR SHARE', [
      normalized
    ])
  ).rows[0];
  requireCondition(!examiner.archived, 400, 'invalid_examiner', 'The examiner is unavailable.');
  return { id: examiner.id as string, name: examiner.name as string };
}

async function lockLectureExaminers(client: PoolClient, lectureId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `lecture_examiners:${lectureId}`
  ]);
  requireCondition(
    (await client.query('SELECT id FROM lecture WHERE id=$1 FOR SHARE', [lectureId])).rowCount,
    404,
    'not_found',
    'Lecture not found.'
  );
}

export async function addLectureExaminer(actor: Actor, lectureId: string, name: string) {
  requireId(lectureId);
  bounded(name, 200);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await lockLectureExaminers(client, lectureId);
    const examiner = await resolveExaminerName(client, name);
    await client.query(
      'INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [lectureId, examiner.id, actor.id]
    );
    await audit(client, actor.id, 'lecture.examiner_added', lectureId, {
      examinerId: examiner.id,
      name: examiner.name
    });
    return examiner;
  });
}

export async function renameLectureExaminer(
  actor: Actor,
  lectureId: string,
  examinerId: string,
  name: string
) {
  requireId(lectureId);
  requireId(examinerId);
  bounded(name, 200);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await lockLectureExaminers(client, lectureId);
    requireCondition(
      (
        await client.query(
          'SELECT examiner_id FROM lecture_examiner WHERE lecture_id=$1 AND examiner_id=$2 FOR UPDATE',
          [lectureId, examinerId]
        )
      ).rowCount,
      404,
      'invalid_examiner',
      'The examiner is not assigned to this lecture.'
    );
    const replacement = await resolveExaminerName(client, name);
    if (replacement.id !== examinerId) {
      await client.query(
        'INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [lectureId, replacement.id, actor.id]
      );
      await client.query('DELETE FROM lecture_examiner WHERE lecture_id=$1 AND examiner_id=$2', [
        lectureId,
        examinerId
      ]);
    }
    await audit(client, actor.id, 'lecture.examiner_renamed', lectureId, {
      previousExaminerId: examinerId,
      examinerId: replacement.id,
      name: replacement.name
    });
    return replacement;
  });
}

export async function removeLectureExaminer(actor: Actor, lectureId: string, examinerId: string) {
  requireId(lectureId);
  requireId(examinerId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await lockLectureExaminers(client, lectureId);
    const removed = await client.query(
      'DELETE FROM lecture_examiner WHERE lecture_id=$1 AND examiner_id=$2 RETURNING examiner_id',
      [lectureId, examinerId]
    );
    requireCondition(
      removed.rowCount,
      404,
      'invalid_examiner',
      'The examiner is not assigned to this lecture.'
    );
    await audit(client, actor.id, 'lecture.examiner_removed', lectureId, { examinerId });
  });
}

export async function proposeLectures(client: PoolClient, actor: Actor, names: string[]) {
  const ids: string[] = [];
  for (const raw of [...new Set(names)].sort((a, b) =>
    a
      .normalize('NFKC')
      .toLocaleLowerCase('de-DE')
      .localeCompare(b.normalize('NFKC').toLocaleLowerCase('de-DE'))
  )) {
    const name = bounded(raw, 200),
      normalized = name.normalize('NFKC').toLocaleLowerCase('de-DE');
    const created = (
      await client.query(
        `INSERT INTO lecture(name,normalized_name,approval_status,proposed_by) VALUES($1,$2,'pending',$3)
      ON CONFLICT(normalized_name) DO NOTHING RETURNING id`,
        [name, normalized, actor.id]
      )
    ).rows[0];
    const lecture = (
      await client.query(
        'SELECT id,approval_status,archived FROM lecture WHERE normalized_name=$1 FOR SHARE',
        [normalized]
      )
    ).rows[0];
    requireCondition(
      !lecture.archived && lecture.approval_status !== 'rejected',
      409,
      'lecture_proposal_unavailable',
      'This lecture name is unavailable. Choose another name or contact the review team.'
    );
    if (lecture.approval_status === 'pending')
      await client.query(
        'INSERT INTO lecture_proposer(lecture_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [lecture.id, actor.id]
      );
    if (created) await audit(client, actor.id, 'lecture.proposed', lecture.id, { name });
    ids.push(lecture.id);
  }
  return ids;
}

export async function updateLecture(
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: { name: string; aliases: string[] }
) {
  requireId(id);
  const name = bounded(input.name, 200);
  requireCondition(
    Number.isInteger(expectedVersion) && Array.isArray(input.aliases) && input.aliases.length <= 30,
    400,
    'invalid_input',
    'Invalid lecture update.'
  );
  const aliases = [...new Set(input.aliases.map((alias) => bounded(alias, 200)))];
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `lecture_name:${name.normalize('NFKC').toLocaleLowerCase('de-DE')}`
    ]);
    requireCondition(
      !(
        await client.query('SELECT id FROM lecture WHERE normalized_name=$1 AND id<>$2', [
          name.normalize('NFKC').toLocaleLowerCase('de-DE'),
          id
        ])
      ).rowCount,
      409,
      'catalogue_duplicate',
      'This catalogue name already exists.'
    );
    const result = await client.query(
      'UPDATE lecture SET name=$3,normalized_name=$4,aliases=$5,version=version+1 WHERE id=$1 AND version=$2 RETURNING *',
      [id, expectedVersion, name, name.normalize('NFKC').toLocaleLowerCase('de-DE'), aliases]
    );
    requireCondition(
      result.rowCount,
      409,
      'stale_lecture',
      'Lecture changed. Reload before editing.'
    );
    await audit(client, actor.id, 'lecture.updated', id, { name, aliases });
    return result.rows[0];
  });
}

export async function decideLecture(
  actor: Actor,
  id: string,
  expectedVersion: number,
  outcome: 'approved' | 'rejected'
) {
  requireId(id);
  requireCondition(
    ['approved', 'rejected'].includes(outcome) && Number.isInteger(expectedVersion),
    400,
    'invalid_input',
    'Invalid lecture decision.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const result = await client.query(
      'UPDATE lecture SET approval_status=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING *',
      [id, expectedVersion, outcome]
    );
    requireCondition(
      result.rowCount,
      409,
      'stale_lecture',
      'Lecture changed. Reload before editing.'
    );
    await audit(client, actor.id, 'lecture.reviewed', id, { outcome });
    return result.rows[0];
  });
}

export async function listExaminers(actor: Actor) {
  return transaction(async (client) => {
    await currentActor(client, actor);
    return (await client.query('SELECT id,name FROM examiner WHERE NOT archived ORDER BY name'))
      .rows;
  });
}

export async function createLecture(
  actor: Actor,
  name: string,
  input: { aliases?: string[]; examinerName?: string } = {}
) {
  name = bounded(name, 200);
  const rawAliases = input.aliases ?? [];
  requireCondition(
    Array.isArray(rawAliases) && rawAliases.length <= 30,
    400,
    'invalid_input',
    'Invalid lecture aliases.'
  );
  const aliases = [...new Set(rawAliases.map((alias) => bounded(alias, 200)))];
  const examinerName = input.examinerName?.trim() ? bounded(input.examinerName, 200) : null;
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const lecture = (
      await client.query(
        `INSERT INTO lecture(name,normalized_name,aliases) VALUES($1,$2,$3)
         ON CONFLICT(normalized_name) DO NOTHING RETURNING id,name`,
        [name, name.normalize('NFKC').toLocaleLowerCase('de-DE'), aliases]
      )
    ).rows[0];
    requireCondition(lecture, 409, 'catalogue_duplicate', 'This catalogue name already exists.');
    if (examinerName) {
      const examiner = await resolveExaminerName(client, examinerName);
      await client.query(
        'INSERT INTO lecture_examiner(lecture_id,examiner_id,linked_by) VALUES($1,$2,$3)',
        [lecture.id, examiner.id, actor.id]
      );
    }
    await audit(client, actor.id, 'lecture.created', lecture.id, { name, aliases, examinerName });
    return lecture;
  });
}

async function requirePublishedLecture(client: PoolClient, lectureId: string) {
  requireCondition(
    (
      await client.query("SELECT id FROM lecture WHERE id=$1 AND approval_status='approved'", [
        lectureId
      ])
    ).rowCount,
    404,
    'not_found',
    'Lecture not found.'
  );
}

export async function listPublishedProtocolsPage(actor: Actor, lectureId: string, page = 1) {
  requireId(lectureId);
  cataloguePage(page);
  return transaction(async (client) => {
    await currentActor(client, actor);
    await requirePublishedLecture(client, lectureId);
    return paginatedCatalogue(
      client,
      `SELECT s.id,${uploadNumberSql} upload_number,r.id revision_id,s.created_at,r.exam_date,r.term,r.remarks,f.original_name
      FROM submission s JOIN submission_revision r ON r.id=s.published_revision_id JOIN stored_file f ON f.id=r.file_id
      WHERE s.visibility='published' AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL AND f.safety_status='clean'
      AND NOT EXISTS(SELECT 1 FROM revision_lecture other JOIN lecture l ON l.id=other.lecture_id WHERE other.revision_id=r.id AND l.approval_status<>'approved')
      AND EXISTS(SELECT 1 FROM revision_lecture rl WHERE rl.revision_id=r.id AND rl.lecture_id=$1)`,
      [lectureId, actor.id],
      page,
      'created_at DESC,id DESC',
      `(SELECT string_agg(e.name, ', ' ORDER BY re.position) FROM revision_examiner re JOIN examiner e ON e.id=re.examiner_id WHERE re.revision_id=selected.revision_id) examiner,
       ARRAY(SELECT l.name FROM revision_lecture rl JOIN lecture l ON l.id=rl.lecture_id WHERE rl.revision_id=selected.revision_id ORDER BY l.name) lectures,
       EXISTS(SELECT 1 FROM revision_lecture rl JOIN lecture_access a ON a.lecture_id=rl.lecture_id WHERE rl.revision_id=selected.revision_id AND a.user_id=$2 AND a.expires_at>now()) has_access`
    );
  });
}

export async function getLecture(actor: Actor, id: string, page = 1) {
  requireId(id);
  const base = await transaction(async (client) => {
    const actual = await currentActor(client, actor);
    const lecture = (
      await client.query(
        `SELECT l.*,a.expires_at FROM lecture l LEFT JOIN lecture_access a ON a.lecture_id=l.id AND a.user_id=$2 AND a.expires_at>now()
          WHERE l.id=$1 AND (l.approval_status='approved' OR $3 OR EXISTS(SELECT 1 FROM lecture_proposer p WHERE p.lecture_id=l.id AND p.user_id=$2))`,
        [id, actor.id, actual.isAdmin]
      )
    ).rows[0];
    requireCondition(lecture, 404, 'not_found', 'Lecture not found.');
    return { ...lecture, policy: await latestPolicy(client) };
  });
  const protocolsPage =
    base.approval_status === 'approved'
      ? await listPublishedProtocolsPage(actor, id, page)
      : { items: [] as Record<string, any>[], page: 1, pageSize: CATALOGUE_PAGE_SIZE, total: 0 };
  return { ...base, protocols: protocolsPage.items, protocolsPage };
}

export async function archiveLecture(
  actor: Actor,
  id: string,
  expectedVersion: number,
  archived: boolean
) {
  requireId(id);
  requireCondition(
    typeof archived === 'boolean' && Number.isInteger(expectedVersion),
    400,
    'invalid_input',
    'Invalid lecture update.'
  );
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const result = await client.query(
      'UPDATE lecture SET archived=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING *',
      [id, expectedVersion, archived]
    );
    requireCondition(
      result.rowCount,
      409,
      'stale_lecture',
      'Lecture changed. Reload before editing.'
    );
    await audit(client, actor.id, 'lecture.archived', id, { archived });
    return result.rows[0];
  });
}
