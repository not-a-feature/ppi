import { randomUUID } from 'node:crypto';
import { pool, transaction } from './db.js';
import { readStoredFile } from './storage.js';
import { extractDocumentText } from './document-text.js';
import { getReadableSource, scheduleOcr } from './pdf-processing.js';
import { currentActor, requireId, requireCondition, audit, type Actor } from './domain/shared.js';
import {
  fingerprintText,
  shingleSimilarity,
  MIN_CONTENT_WORDS,
  MIN_SIMILARITY_WORDS,
  REPETITION_THRESHOLD,
  SIMILARITY_THRESHOLD
} from './content-fingerprints.js';

type Match = { fileId: string; score: number };
export type ContentCheckReport = {
  state: 'pending' | 'waiting' | 'ready' | 'unavailable' | 'failed' | 'blocked';
  reason: string;
  checkedAt: Date | string | null;
  ocrStatus: string | null;
  wordCount: number;
  pageCount: number | null;
  textlessPages: number;
  repeatedFraction: number;
  comparedFiles: number;
  minWords: number;
  minSimilarityWords: number;
  repetitionThreshold: number;
  similarityThreshold: number;
  duplicates: Array<{
    id: string;
    revisionId: string;
    name: string;
    revision: number;
    sameSubmission: boolean;
  }>;
  similar: Array<{
    id: string;
    revisionId: string;
    name: string;
    revision: number;
    sameSubmission: boolean;
    score: number;
  }>;
  missingMetadata: string[];
};

export async function analyzeFileContent(fileId: string, generation: number) {
  requireId(fileId);
  const file = (await pool.query('SELECT * FROM stored_file WHERE id=$1', [fileId])).rows[0];
  if (
    !file ||
    file.deleted_at ||
    file.safety_status !== 'clean' ||
    file.safety_generation !== generation
  )
    return;
  let extracted;
  const source =
    file.media_type === 'application/pdf'
      ? await getReadableSource(file.id, generation, file.storage_key, file.sha256)
      : { storageKey: file.storage_key };
  const bytes = await readStoredFile(source.storageKey);
  try {
    extracted = await extractDocumentText(bytes, file.media_type);
  } catch (error) {
    console.error(
      'Content extraction failed:',
      fileId,
      error instanceof Error ? error.message : error
    );
    extracted = {
      text: '',
      pageCount: null,
      textlessPages: 0,
      ocrPages: [] as number[],
      pageWordCounts: [] as number[],
      reason: 'extraction_failed'
    };
  }
  const features = fingerprintText(extracted.reason ? '' : extracted.text);
  const status = extracted.reason ? 'unavailable' : 'ready';
  await transaction(async (client) => {
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('content-check-index',0))");
    const current = (
      await client.query('SELECT * FROM stored_file WHERE id=$1 FOR SHARE', [fileId])
    ).rows[0];
    if (
      !current ||
      current.deleted_at ||
      current.safety_status !== 'clean' ||
      current.safety_generation !== generation
    )
      return;
    if (file.media_type === 'application/pdf' && !extracted.reason)
      await scheduleOcr(client, fileId, generation, extracted.ocrPages);
    const comparedFiles = Number(
      (
        await client.query(
          `SELECT count(*) FROM file_content_check c JOIN stored_file f ON f.id=c.file_id
       WHERE c.file_id<>$1 AND c.status='ready' AND c.generation=f.safety_generation AND f.deleted_at IS NULL AND f.safety_status='clean'`,
          [fileId]
        )
      ).rows[0].count
    );
    const matches: Match[] = [];
    if (status === 'ready' && features.wordCount >= MIN_SIMILARITY_WORDS) {
      const candidates = (
        await client.query<{ fileId: string; textHash: string; shingles: string[] }>(
          `SELECT c.file_id AS "fileId",c.text_hash AS "textHash",CASE WHEN c.text_hash=$3 THEN '{}'::text[] ELSE c.shingles END shingles
       FROM file_content_check c JOIN stored_file f ON f.id=c.file_id
       WHERE c.file_id<>$1 AND c.status='ready' AND c.generation=f.safety_generation
         AND f.deleted_at IS NULL AND f.safety_status='clean' AND c.word_count >= $4
         AND (c.text_hash=$3 OR cardinality(c.shingles) BETWEEN cardinality($2::text[])*$5::float8 AND cardinality($2::text[])/$5::float8)`,
          [fileId, features.shingles, features.textHash, MIN_SIMILARITY_WORDS, SIMILARITY_THRESHOLD]
        )
      ).rows;
      for (const candidate of candidates) {
        const score =
          candidate.textHash === features.textHash
            ? 1
            : shingleSimilarity(candidate.shingles, features.shingles);
        if (score >= SIMILARITY_THRESHOLD) matches.push({ fileId: candidate.fileId, score });
      }
      matches.sort((a, b) => b.score - a.score || a.fileId.localeCompare(b.fileId));
      matches.splice(5);
    }
    await client.query(
      `INSERT INTO file_content_check(file_id,generation,status,reason,word_count,page_count,textless_pages,repeated_fraction,text_hash,shingles,similar_matches,compared_files)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(file_id) DO UPDATE SET generation=EXCLUDED.generation,status=EXCLUDED.status,reason=EXCLUDED.reason,
         word_count=EXCLUDED.word_count,page_count=EXCLUDED.page_count,textless_pages=EXCLUDED.textless_pages,
         repeated_fraction=EXCLUDED.repeated_fraction,text_hash=EXCLUDED.text_hash,shingles=EXCLUDED.shingles,
         similar_matches=EXCLUDED.similar_matches,compared_files=EXCLUDED.compared_files,checked_at=now()`,
      [
        fileId,
        generation,
        status,
        extracted.reason,
        features.wordCount,
        extracted.pageCount,
        extracted.textlessPages,
        features.repeatedFraction,
        features.textHash,
        features.shingles,
        JSON.stringify(matches),
        comparedFiles
      ]
    );
    for (const match of matches) {
      const other = (
        await client.query(
          'SELECT similar_matches FROM file_content_check WHERE file_id=$1 FOR UPDATE',
          [match.fileId]
        )
      ).rows[0];
      if (!other) continue;
      const reciprocal = [
        ...(other.similar_matches as Match[]).filter((entry) => entry.fileId !== fileId),
        { fileId, score: match.score }
      ]
        .sort((a, b) => b.score - a.score || a.fileId.localeCompare(b.fileId))
        .slice(0, 5);
      await client.query('UPDATE file_content_check SET similar_matches=$2 WHERE file_id=$1', [
        match.fileId,
        JSON.stringify(reciprocal)
      ]);
    }
  });
}

export async function markContentCheckFailed(fileId: string, generation: number) {
  await pool.query(
    `INSERT INTO file_content_check(file_id,generation,status,reason)
     SELECT id,safety_generation,'failed','processing_failed' FROM stored_file
     WHERE id=$1 AND safety_generation=$2 AND safety_status='clean' AND deleted_at IS NULL
     ON CONFLICT(file_id) DO UPDATE SET status='failed',reason='processing_failed',checked_at=now()
       WHERE file_content_check.generation=EXCLUDED.generation`,
    [fileId, generation]
  );
}

export async function requestContentCheck(actor: Actor, submissionId: string) {
  requireId(submissionId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const file = (
      await client.query(
        `SELECT f.id,f.safety_generation,f.safety_status,f.deleted_at,s.files_deleted_at FROM submission s
       JOIN submission_revision r ON r.id=s.current_revision_id JOIN stored_file f ON f.id=r.file_id WHERE s.id=$1 FOR SHARE OF f`,
        [submissionId]
      )
    ).rows[0];
    requireCondition(
      file && !file.deleted_at && !file.files_deleted_at,
      404,
      'not_found',
      'Protocol not found.'
    );
    requireCondition(
      file.safety_status === 'clean',
      409,
      'unsafe_file',
      'The file must pass technical checks first.'
    );
    await client.query('DELETE FROM file_content_check WHERE file_id=$1', [file.id]);
    await client.query(
      "INSERT INTO core_job(type,business_key,payload) VALUES('content_check',$1,$2)",
      [
        `content_check:${file.id}:${randomUUID()}`,
        JSON.stringify({ fileId: file.id, generation: file.safety_generation })
      ]
    );
    await audit(client, actor.id, 'content.check_requested', file.id);
  });
}

export async function getContentChecks(
  actor: Actor,
  submissionId: string
): Promise<ContentCheckReport> {
  requireId(submissionId);
  return transaction(async (client) => {
    await currentActor(client, actor, true);
    const current = (
      await client.query(
        `SELECT r.submission_id,r.examiner_id,r.exam_date,r.term,f.*,c.status content_status,c.reason,c.word_count,
        c.page_count,c.textless_pages,c.repeated_fraction,c.checked_at,c.similar_matches,c.compared_files,p.status ocr_status
       FROM submission s JOIN submission_revision r ON r.id=s.current_revision_id JOIN stored_file f ON f.id=r.file_id
       LEFT JOIN file_content_check c ON c.file_id=f.id AND c.generation=f.safety_generation
       LEFT JOIN pdf_derivative p ON p.file_id=f.id AND p.generation=f.safety_generation
       WHERE s.id=$1 AND s.files_deleted_at IS NULL AND f.deleted_at IS NULL`,
        [submissionId]
      )
    ).rows[0];
    requireCondition(current, 404, 'not_found', 'Protocol not found.');
    const duplicates = (
      await client.query(
        `SELECT s.id,r.id AS "revisionId",f.original_name name,r.revision_number revision,(s.id=$2) AS "sameSubmission"
       FROM stored_file f JOIN submission_revision r ON r.file_id=f.id JOIN submission s ON s.id=r.submission_id
       WHERE f.sha256=$1 AND f.id<>$3 AND f.deleted_at IS NULL AND s.files_deleted_at IS NULL
       ORDER BY s.created_at,s.id,r.revision_number LIMIT 5`,
        [current.sha256, submissionId, current.id]
      )
    ).rows;
    const matches: Match[] = current.similar_matches ?? [];
    const similar = matches.length
      ? (
          await client.query(
            `SELECT s.id,r.id AS "revisionId",f.original_name name,r.revision_number revision,(s.id=$2) AS "sameSubmission",m.score
       FROM jsonb_to_recordset($1::jsonb) AS m("fileId" uuid,score float8)
       JOIN stored_file f ON f.id=m."fileId" JOIN submission_revision r ON r.file_id=f.id
       JOIN submission s ON s.id=r.submission_id JOIN file_content_check c ON c.file_id=f.id
       WHERE f.deleted_at IS NULL AND s.files_deleted_at IS NULL AND f.safety_status='clean' AND c.generation=f.safety_generation
       ORDER BY m.score DESC,s.id,r.revision_number LIMIT 5`,
            [JSON.stringify(matches), submissionId]
          )
        ).rows
      : [];
    return {
      state:
        current.safety_status !== 'clean'
          ? current.safety_status === 'blocked' || current.safety_status === 'failed'
            ? 'blocked'
            : 'waiting'
          : current.ocr_status === 'pending'
            ? 'pending'
            : (current.content_status ?? 'pending'),
      reason: current.reason ?? '',
      ocrStatus: current.ocr_status ?? null,
      checkedAt: current.checked_at ?? null,
      wordCount: current.word_count ?? 0,
      pageCount: current.page_count ?? null,
      textlessPages: current.textless_pages ?? 0,
      repeatedFraction: current.repeated_fraction ?? 0,
      comparedFiles: current.compared_files ?? 0,
      minWords: MIN_CONTENT_WORDS,
      minSimilarityWords: MIN_SIMILARITY_WORDS,
      repetitionThreshold: REPETITION_THRESHOLD,
      similarityThreshold: SIMILARITY_THRESHOLD,
      duplicates,
      similar,
      missingMetadata: [
        !current.examiner_id ? 'examiner' : '',
        !current.exam_date ? 'date' : '',
        !current.term ? 'term' : ''
      ].filter(Boolean)
    };
  });
}
