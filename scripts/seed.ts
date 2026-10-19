import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { pool, transaction } from '../src/lib/server/db.js';
import {
  activateAccount,
  completeFileCheck,
  decideSubmission,
  getActor,
  getRewardPreview,
  purchaseLectureAccess,
  submitProtocol
} from '../src/lib/server/domain/index.js';
import { storeUpload } from '../src/lib/server/storage.js';

assert.equal(
  process.env.NODE_ENV,
  'development',
  'Dummy data is restricted to NODE_ENV=development.'
);
assert.equal(
  process.env.ALLOW_DEMO_SEED,
  'true',
  'Set ALLOW_DEMO_SEED=true to load synthetic development data.'
);
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(process.env.ORIGIN ?? 'http://localhost:5173').hostname
  ),
  'Dummy data requires a localhost origin.'
);

const password = 'Ppi2-demo-only-2026!';
const passwordHash = await hashPassword(password);
const accounts = [
  { identifier: 'zxabc01', name: 'Demo Administration', admin: true },
  { identifier: 'zxabc02', name: 'Demo Student', admin: false },
  { identifier: 'zxabc03', name: 'Demo Contributor', admin: false }
];

for (const account of accounts) {
  const email = `${account.identifier}@student.uni-tuebingen.de`;
  const id = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)
       ON CONFLICT(email) DO NOTHING RETURNING id`,
      [randomUUID(), account.name, email]
    );
    if (inserted.rowCount) {
      const userId = inserted.rows[0].id as string;
      await client.query(
        `INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)`,
        [randomUUID(), userId, passwordHash]
      );
      return userId;
    }
    const existing = (
      await client.query('SELECT id,"emailVerified" FROM "user" WHERE email=$1', [email])
    ).rows[0];
    assert.equal(
      existing.emailVerified,
      true,
      'Seed does not verify or replace existing unverified accounts.'
    );
    return existing.id as string;
  });
  await activateAccount(id);
  if (account.admin) {
    await transaction(async (client) => {
      const promoted = await client.query(
        'UPDATE ppi_user SET is_admin=true WHERE user_id=$1 AND NOT is_admin RETURNING user_id',
        [id]
      );
      if (promoted.rowCount) {
        await client.query(
          `INSERT INTO audit_event(actor_id,action,entity_id,detail) VALUES(NULL,'admin.development_bootstrap',$1,$2)`,
          [id, JSON.stringify({ email, source: 'development seed' })]
        );
      }
    });
  }
}

for (const name of [
  'Algorithmen und Datenstrukturen',
  'Maschinelles Lernen',
  'Molekulare Bioinformatik'
]) {
  await pool.query(
    'INSERT INTO lecture(name,normalized_name) VALUES($1,$2) ON CONFLICT(normalized_name) DO NOTHING',
    [name, name.normalize('NFKC').toLocaleLowerCase('de-DE')]
  );
}
for (const name of ['Prof. Beispiel', 'Dr. Muster']) {
  await pool.query(
    'INSERT INTO examiner(name,normalized_name) VALUES($1,$2) ON CONFLICT(normalized_name) DO NOTHING',
    [name, name.normalize('NFKC').toLocaleLowerCase('de-DE')]
  );
}

const adminId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxabc01@student.uni-tuebingen.de'])
).rows[0].id;
const studentId = (
  await pool.query('SELECT id FROM "user" WHERE email=$1', ['zxabc02@student.uni-tuebingen.de'])
).rows[0].id;
const admin = await getActor(adminId);
const student = await getActor(studentId);
assert(admin?.isAdmin && student);
const examinerName = (
  await pool.query('SELECT name FROM examiner WHERE normalized_name=$1', ['prof. beispiel'])
).rows[0].name;

for (const fixture of [
  {
    name: 'Maschinelles Lernen',
    key: 'development-ml-v1',
    publish: true,
    text: 'Synthetisches Prüfungsprotokoll: Maschinelles Lernen\n\nDiese Datei enthält ausschließlich erfundene Beispieldaten.\n\nThemen\n- Bias und Varianz\n- Kreuzvalidierung und Datenleckage\n- Regularisierung linearer Modelle\n\nBeispielfrage\nWie unterscheidet sich die Auswahl von Hyperparametern von der abschließenden Bewertung eines Modells?\n\nBeispielantwort\nHyperparameter werden auf Trainings- und Validierungsdaten ausgewählt. Der Testsatz wird erst nach Abschluss der Auswahl verwendet.\n'
  },
  {
    name: 'Algorithmen und Datenstrukturen',
    key: 'development-algorithms-v1',
    publish: false,
    text: 'Synthetisches Prüfungsprotokoll: Algorithmen und Datenstrukturen\n\nDiese Datei enthält ausschließlich erfundene Beispieldaten und wartet auf eine manuelle Prüfung.\n\nThemen\n- Binäre Suchbäume\n- Breitensuche und Tiefensuche\n- Laufzeit von Sortierverfahren\n\nBeispielfrage\nWann findet Breitensuche einen kürzesten Pfad?\n\nBeispielantwort\nIn einem ungewichteten Graphen minimiert Breitensuche die Zahl der Kanten im Pfad.\n'
  }
]) {
  const lectureId = (
    await pool.query('SELECT id FROM lecture WHERE normalized_name=$1', [
      fixture.name.normalize('NFKC').toLocaleLowerCase('de-DE')
    ])
  ).rows[0].id;
  const previous = await pool.query(
    "SELECT result FROM mutation_receipt WHERE actor_id=$1 AND operation='submit' AND request_key=$2",
    [student.id, fixture.key]
  );
  const submitted = previous.rowCount
    ? (previous.rows[0].result as { submissionId: string; revisionId: string })
    : await submitProtocol(student, {
        file: await storeUpload(
          new File([fixture.text], `${fixture.key}.txt`, { type: 'text/plain' })
        ),
        lectureIds: [lectureId],
        examinerName,
        examDate: '2026-09-15',
        term: 'SS2026',
        remarks: 'Erfundene Beispieldaten für die lokale Entwicklung.',
        collaboratorZx: ['zxabc03'],
        attested: true,
        requestKey: fixture.key
      });
  const revision = (
    await pool.query('SELECT file_id FROM submission_revision WHERE id=$1', [submitted.revisionId])
  ).rows[0];
  await completeFileCheck({
    fileId: revision.file_id,
    generation: 1,
    status: 'clean',
    detail: 'Synthetic UTF-8 development fixture generated by the guarded local seed.'
  });
  const submission = (
    await pool.query('SELECT version,review_state FROM submission WHERE id=$1', [
      submitted.submissionId
    ])
  ).rows[0];
  if (fixture.publish && submission.review_state !== 'accepted') {
    const preview = await getRewardPreview(admin, submitted.revisionId, 'base');
    await decideSubmission(admin, {
      revisionId: submitted.revisionId,
      expectedVersion: submission.version,
      outcome: 'accepted',
      reward: 'base',
      rewardPolicyVersion: preview.policyVersion,
      rewardRecipientIds: preview.recipientIds,
      publicFeedback: 'Synthetisches Beispielprotokoll freigegeben.',
      internalNote: 'Development fixture.',
      requestKey: `${fixture.key}-review`
    });
  }
  if (fixture.publish) await purchaseLectureAccess(student, lectureId, `${fixture.key}-access`);
}

console.log(
  `Synthetic accounts: ${accounts.map((account) => account.identifier).join(', ')}. Password for newly created accounts: ${password}`
);
console.log('No authentication email was queued. Existing account credentials were preserved.');
console.log('Two synthetic TXT protocols were created: one published, one awaiting review.');
await pool.end();
