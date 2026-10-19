import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pool } from '../src/lib/server/db.js';
import {
  completeFileCheck,
  decideSubmission,
  getActor,
  getRewardPreview,
  getSubmission,
  purchaseLectureAccess,
  reviseProtocol,
  submitProtocol,
  type DecisionInput,
  type SubmissionInput
} from '../src/lib/server/domain/index.js';
import { storeUpload } from '../src/lib/server/storage.js';
import { termOptions } from '../src/lib/terms.js';
import { analyzeFileContent } from '../src/lib/server/content-checks.js';

assert.equal(process.env.NODE_ENV, 'development', 'Playground data requires NODE_ENV=development.');
assert.equal(
  process.env.ALLOW_DEMO_SEED,
  'true',
  'Set ALLOW_DEMO_SEED=true to add playground data.'
);
const localHosts = ['localhost', '127.0.0.1', '[::1]'];
assert(process.env.ORIGIN, 'Set a localhost ORIGIN explicitly.');
assert(
  localHosts.includes(new URL(process.env.ORIGIN).hostname),
  'Playground data requires a localhost origin.'
);
assert(process.env.DATABASE_URL, 'Set a localhost DATABASE_URL explicitly.');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
assert(localHosts.includes(databaseUrl.hostname), 'Playground data requires a localhost database.');
assert(
  !databaseUrl.searchParams.has('host') && !databaseUrl.searchParams.has('hostaddr'),
  'Database host overrides are not allowed.'
);

const actors = [];
for (const identifier of ['zxabc01', 'zxabc02', 'zxabc03']) {
  const users = await pool.query('SELECT id FROM "user" WHERE email=$1 AND "emailVerified"', [
    `${identifier}@student.uni-tuebingen.de`
  ]);
  assert.equal(
    users.rowCount,
    1,
    `Run the base development seed first: missing verified ${identifier}.`
  );
  const actor = await getActor(users.rows[0].id);
  assert(actor, `${identifier} must have an active account.`);
  actors.push(actor);
}
const [admin, student, collaborator] = actors;
assert(admin.isAdmin, 'The base demo administrator must still be an administrator.');

const courses = [
  [
    'Statistische Lernverfahren',
    'Prof. Ada Beispiel',
    'Cross-validation and regularization',
    'How does nested cross-validation prevent optimistic model selection?'
  ],
  [
    'Genomische Datenanalyse',
    'Dr. Emil Muster',
    'Read mapping and variant calling',
    'How do coverage and mapping quality affect a variant call?'
  ],
  [
    'Datenbanken und Informationssysteme',
    'Prof. Nora Beispiel',
    'Transactions and indexes',
    'What does a serializable transaction guarantee?'
  ],
  [
    'Computergrafik',
    'Dr. Robin Muster',
    'Projection and rasterization',
    'How does perspective projection change depth?'
  ],
  [
    'Betriebssysteme',
    'Prof. Kim Beispiel',
    'Scheduling and virtual memory',
    'What happens during a page fault?'
  ],
  [
    'Rechnernetze',
    'Dr. Alex Muster',
    'Routing and transport protocols',
    'How does TCP detect and recover from packet loss?'
  ],
  ['Formale Sprachen und Automaten', '', '', ''],
  ['Wissenschaftliches Rechnen', '', '', '']
];
const lectureIds: string[] = [];
let createdCourses = 0;
for (const [index, course] of courses.entries()) {
  const hex = createHash('sha256').update(`playground-v1-course-${index}`).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const name = `${course[0]} (Demo)`;
  const inserted = await pool.query(
    'INSERT INTO lecture(id,name,normalized_name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
    [id, name, name.normalize('NFKC').toLocaleLowerCase('de-DE')]
  );
  assert.equal(
    (await pool.query('SELECT id FROM lecture WHERE id=$1', [id])).rowCount,
    1,
    `Demo course name is already used by another entry: ${name}`
  );
  createdCourses += inserted.rowCount ?? 0;
  lectureIds.push(id);
}

function syntheticPdf(lines: string[]): Buffer {
  const content = `BT /F1 12 Tf 50 790 Td 17 TL\n${lines.map((line) => `(${line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj T*`).join('\n')}\nET\n`;
  assert(/^[\x00-\x7f]*$/.test(content));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function checkFile(revisionId: string) {
  const revision = (
    await pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [revisionId])
  ).rows[0];
  await completeFileCheck({
    fileId: revision.file_id,
    generation: 1,
    status: 'clean',
    detail: 'Synthetic local playground fixture generated by the guarded development seed.'
  });
  await analyzeFileContent(revision.file_id, 1);
}

async function review(
  submissionId: string,
  revisionId: string,
  outcome: DecisionInput['outcome'],
  requestKey: string,
  improvement = false
) {
  const reward = outcome === 'accepted' && !improvement ? 'base' : 'none';
  const preview = reward === 'base' ? await getRewardPreview(admin, revisionId, 'base') : undefined;
  const publicFeedback = {
    accepted: 'Das synthetische Beispiel ist vollständig und zur Veröffentlichung freigegeben.',
    rejected: 'Das Beispiel enthält widersprüchliche Antworten. Bitte fachlich überarbeiten.',
    changes_requested: 'Bitte die Prüfungsfragen und die zugehörigen Antworten genauer beschreiben.'
  };
  await decideSubmission(admin, {
    revisionId,
    expectedVersion: (await getSubmission(admin, submissionId)).version,
    outcome,
    reward,
    rewardPolicyVersion: preview?.policyVersion,
    rewardRecipientIds: preview?.recipientIds,
    publicFeedback: publicFeedback[outcome],
    internalNote: 'Synthetisches Beispiel für lokale Tests.',
    requestKey
  });
}

const outcomes = [
  'accepted',
  'accepted',
  'awaiting_review',
  'changes_requested',
  'rejected',
  'accepted'
] as const;
const terms = termOptions();
const totals = {
  createdSubmissions: 0,
  createdRevisions: 0,
  skippedSubmissions: 0,
  createdProposals: 0,
  purchasedAccess: 0
};
for (let index = 0; index < 20; index++) {
  const actor = index % 2 === 0 ? student : collaborator;
  const requestKey = `playground-v1-protocol-${String(index + 1).padStart(2, '0')}`;
  const previous = await pool.query(
    "SELECT 1 FROM mutation_receipt WHERE actor_id=$1 AND operation='submit' AND request_key=$2",
    [actor.id, requestKey]
  );
  if (previous.rowCount) {
    totals.skippedSubmissions++;
    continue;
  }
  const proposal = index >= 18;
  const courseIndex = index % 6;
  const course = courses[courseIndex];
  const isPdf = index % 2 === 0;
  const lines = [
    `Synthetic exam protocol ${index + 1}`,
    'Fictional local test data. No real examination or personal data.',
    `Topics: ${course[2]}`,
    '',
    'Question:',
    course[3],
    '',
    'Answer outline:',
    'Define the main concepts, state assumptions, and give a small example.',
    'Discuss failure cases and explain which evidence supports the result.'
  ];
  const input: SubmissionInput = {
    file: await storeUpload(
      new File(
        [
          isPdf
            ? new Uint8Array(syntheticPdf(lines))
            : `${lines.join('\n')}\n\nZusätzliche Notiz: vollständig erfundene Prüfungsdaten.\n`
        ],
        `${requestKey}.${isPdf ? 'pdf' : 'txt'}`,
        { type: isPdf ? 'application/pdf' : 'text/plain' }
      )
    ),
    lectureIds: proposal
      ? []
      : index % 7 === 0
        ? [lectureIds[courseIndex], lectureIds[(courseIndex + 1) % 6]]
        : [lectureIds[courseIndex]],
    newLectureNames: proposal
      ? [
          index === 18
            ? 'Kausale Inferenz (Demo-Vorschlag)'
            : 'Medizinische Bildanalyse (Demo-Vorschlag)'
        ]
      : [],
    examinerName: index % 5 === 0 ? undefined : course[1],
    examDate:
      index % 4 === 0
        ? undefined
        : `2026-${String(5 + (index % 5)).padStart(2, '0')}-${String(3 + index).padStart(2, '0')}`,
    term: terms[2 + (index % 6)].value,
    remarks: `Synthetisches Beispiel ${index + 1} für lokale Tests. ${index % 3 === 0 ? 'Schwerpunkt: typische Rückfragen und Lösungswege.' : 'Die Angaben und Prüfungsfragen sind erfunden.'}`,
    collaboratorZx:
      index % 3 === 0
        ? [actor.id === student.id ? 'zxabc03' : 'zxabc02', 'zxxyz99']
        : index % 3 === 1
          ? ['zxxyz99']
          : [],
    attested: true,
    requestKey
  };
  const submitted = await submitProtocol(actor, input);
  totals.createdSubmissions++;
  totals.createdRevisions++;
  if (proposal) totals.createdProposals++;
  await checkFile(submitted.revisionId);
  const outcome = proposal ? 'awaiting_review' : outcomes[index % outcomes.length];
  if (outcome !== 'awaiting_review')
    await review(submitted.submissionId, submitted.revisionId, outcome, `${requestKey}-decision`);
  if (index < 2) {
    const improved = await reviseProtocol(actor, submitted.submissionId, {
      ...input,
      file: await storeUpload(
        new File(
          [
            `Verbesserung zu Beispiel ${index + 1}\n\nSynthetische Ergänzung: Definitionen präzisiert und eine zusätzliche Rückfrage beantwortet.\n`
          ],
          `${requestKey}-improvement.txt`,
          { type: 'text/plain' }
        )
      ),
      remarks: 'Überarbeitete Beispieldatei. Die zuvor angenommene Version bleibt verfügbar.',
      requestKey: `${requestKey}-improvement`
    });
    totals.createdRevisions++;
    await checkFile(improved.revisionId);
    if (index === 1)
      await review(
        improved.submissionId,
        improved.revisionId,
        'rejected',
        `${requestKey}-improvement-decision`,
        true
      );
  }
}

for (const index of [0, 1]) {
  const requestKey = `playground-v1-access-${index}`;
  const receipt = await pool.query(
    "SELECT 1 FROM mutation_receipt WHERE actor_id=$1 AND operation='purchase' AND request_key=$2",
    [student.id, requestKey]
  );
  if (receipt.rowCount) continue;
  const purchase = await purchaseLectureAccess(student, lectureIds[index], requestKey);
  if (purchase.charged > 0) totals.purchasedAccess++;
}

console.log(JSON.stringify({ createdApprovedCourses: createdCourses, ...totals }));
console.log('Existing accounts, credentials, submissions, and review decisions were preserved.');
await pool.end();
