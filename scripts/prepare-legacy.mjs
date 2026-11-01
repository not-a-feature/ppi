import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { account, assignments, decode, hash, normalize, validatePrepared } from './legacy-data.mjs';

assert(
  process.argv[2] && process.argv.length <= 4,
  'Usage: node scripts/prepare-legacy.mjs <snapshot> [account-mapping.json]'
);
const root = resolve(process.argv[2]);
const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const snapshot = await json(resolve(root, 'snapshot.json')); // Only completed scrapes may be prepared.
assert.equal(snapshot.version, 1);
await rm(resolve(root, 'prepared.sha256'), { force: true }); // Invalidate any earlier preparation before validation.
const mappings = process.argv[3] ? await json(process.argv[3]) : {};
const rawUsers = await json(resolve(root, 'users.json'));
assert.equal(rawUsers.length, snapshot.users, 'Incomplete account export');
const users = [],
  conflicts = [];
for (const row of rawUsers) {
  try {
    users.push(account(row, mappings));
  } catch (error) {
    conflicts.push({ sourceId: row.id, role: row.role, reason: error.message });
  }
}
assert.equal(new Set(users.map((u) => u.email)).size, users.length, 'Duplicate account emails');
const rawLectures = await json(resolve(root, 'lectures.json'));
const lectures = rawLectures.map((l) => ({
  sourceId: String(l.id),
  name: decode(l.name).trim(),
  archived: l.status !== 'OK'
}));
async function sidecar(name) {
  try {
    return await json(resolve(root, name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(resolve(root, name), '[]\n');
    return [];
  }
}
const corrections = await sidecar('corrections.json');
const harmonization = await sidecar('harmonization-plan.json');
const unchanged = await sidecar('reviewed-unchanged.json');
const files = await json(resolve(root, 'file-manifest.json'));
const byFile = new Map(files.map((f) => [String(f.id), f]));
const protocols = [],
  omissions = [],
  review = [];
let corrected = 0;
let reviewedUnchanged = 0;
const sourceProtocols = await json(resolve(root, 'protocols.json'));
assert.equal(sourceProtocols.length, snapshot.protocols, 'Incomplete protocol export');
for (const p of sourceProtocols) {
  const file = byFile.get(String(p.id));
  if (!file || !file.bytes) {
    omissions.push({ sourceId: p.id, reason: file ? 'empty' : 'missing' });
    continue;
  }
  assert(
    /^files\/[1-9][0-9]*\.(pdf|txt)$/.test(file.path) &&
      file.path.split('/')[1].split('.')[0] === String(p.id),
    'Unsafe source file path'
  );
  const content = await readFile(resolve(root, file.path));
  assert.equal(hash(content), file.sha256);
  assert.equal(content.length, file.bytes);
  const lectureIds = assignments(p.lectures, rawLectures).map(String);
  const original = decode(p.examiner)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const correction = corrections.find(
    (c) => String(c.legacy_id) === String(p.id) && c.sha256 === file.sha256
  );
  let metadata = { examiners: original, exam_date: null, term: null };
  if (
    correction &&
    JSON.stringify(original.map(normalize)) ===
      JSON.stringify(correction.before.examiners.map(normalize))
  ) {
    metadata = correction.after;
    corrected++;
  } else {
    const prior = unchanged.find(
      (row) =>
        row.sourceId === String(p.id) &&
        row.sha256 === file.sha256 &&
        JSON.stringify(row.examiners.map(normalize)) === JSON.stringify(original.map(normalize))
    );
    if (!correction && prior) reviewedUnchanged++;
    else
      review.push({
        sourceId: p.id,
        reason: correction
          ? 'Source examiner changed; correction withheld'
          : 'No hash-matched correction; review metadata'
      });
  }
  metadata = structuredClone(metadata);
  metadata.examiners = [
    ...new Set(
      metadata.examiners.map((name) => {
        const candidates = harmonization.filter(
          (h) =>
            normalize(h.source_name) === normalize(name) &&
            (h.lecture_ids === null ||
              h.lecture_ids.some((oldId) =>
                lectureIds.some((source) => {
                  // Earlier metadata plans used deterministic rehearsal lecture UUIDs.
                  const hex = hash(`ppi-legacy-rehearsal:lecture:${source}`).slice(0, 32);
                  return (
                    oldId ===
                    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
                  );
                })
              ))
        );
        const targets = [...new Set(candidates.map((c) => c.target_name))];
        assert(targets.length <= 1, `Conflicting examiner identity: ${p.id}`);
        return targets[0] ?? name;
      })
    )
  ];
  assert(
    ['ACCEPTED', 'DECLINED', 'UNCHECKED', 'TO_BE_DELETED'].includes(p.status),
    `Unknown protocol status ${p.id}: ${p.status}`
  );
  protocols.push({
    sourceId: String(p.id),
    owner: String(p.uploadedByUserID),
    status: p.status,
    uploadedDate: p.uploadedDate,
    remarks: decode(p.remark),
    originalName: decode(p.fileName),
    lectures: lectureIds,
    metadata,
    file
  });
}
const data = { version: 1, users, lectures, protocols };
const report = {
  users: users.length,
  admins: users.filter((u) => u.isAdmin).length,
  protocols: protocols.length,
  corrected,
  reviewedUnchanged,
  conflicts,
  omissions,
  review,
  catalogueOrphans: protocols.filter((p) => p.lectures.length === 0).map((p) => p.sourceId)
};
await writeFile(resolve(root, 'preparation-report.json'), JSON.stringify(report, null, 2));
assert.equal(
  conflicts.length,
  0,
  'Account conflicts require explicit email mappings; see preparation-report.json'
);
validatePrepared(data);
await writeFile(resolve(root, 'prepared.json'), JSON.stringify(data, null, 2));
await writeFile(resolve(root, 'prepared.sha256'), hash(JSON.stringify(data, null, 2)) + '\n');
console.log(
  JSON.stringify({
    users: users.length,
    admins: report.admins,
    protocols: protocols.length,
    corrected,
    omissions: omissions.length,
    review: review.length
  })
);
