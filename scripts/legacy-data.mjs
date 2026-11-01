import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const normalize = (value) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
export const id = (kind, source) => {
  const h = hash(`ppi-legacy-v1:${kind}:${source}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function decode(value) {
  for (let depth = 0; depth < 3 && /%[0-9a-f]{2}/i.test(value); depth++) {
    value = decodeURIComponent(value.replace(/%(?![0-9a-f]{2})/gi, '%25'));
  }
  return value;
}
export function assignments(value, lectures) {
  const solutions = [];
  function visit(rest, ids) {
    if (!rest) return solutions.push(ids);
    if (ids.length === 3) return;
    for (const lecture of lectures) {
      if (ids.includes(lecture.id)) continue;
      if (rest === lecture.name) visit('', [...ids, lecture.id]);
      else if (rest.startsWith(lecture.name + ', '))
        visit(rest.slice(lecture.name.length + 2), [...ids, lecture.id]);
    }
  }
  visit(value, []);
  assert.equal(solutions.length, 1, `Ambiguous lecture assignment: ${value}`);
  return solutions[0];
}
export function account(row, mappings = {}) {
  const username = decode(row.username).trim();
  const builtin = String(row.id) === '1' && username === 'admin' && !mappings[row.id];
  const email = builtin
    ? `deleted-${id('user', row.id)}@accounts.invalid`
    : (
        mappings[row.id] ??
        (username.includes('@') ? username : `${username}@student.uni-tuebingen.de`)
      ).toLowerCase();
  assert(
    builtin || /^zx[a-z]{3}[0-9]{2}@student\.uni-tuebingen\.de$/.test(email),
    `Account ${row.id} (${row.role}) requires an explicit zx email mapping`
  );
  const roles = {
    ADMIN: 'active',
    USER: 'active',
    NOT_ACTIVATED: 'unverified',
    BLOCKED: 'suspended',
    TO_BE_DELETED: 'deletion_pending'
  };
  assert(Object.hasOwn(roles, row.role), `Unknown account role: ${row.role}`);
  const balance = Number(row.tokens);
  assert(
    Number.isSafeInteger(balance) && balance >= 0 && balance <= 2147483647,
    `Invalid balance: ${row.id}`
  );
  const note = decode(row.comment);
  assert(note.length <= 4000, `Note too long: ${row.id}`);
  return {
    sourceId: String(row.id),
    email,
    name: email.split('@')[0],
    isAdmin: row.role === 'ADMIN',
    status: builtin ? 'suspended' : roles[row.role],
    verified: !builtin && ['ADMIN', 'USER', 'BLOCKED'].includes(row.role),
    balance,
    note
  };
}

export function validatePrepared(data) {
  assert.equal(data.version, 1, 'Unsupported legacy data version');
  for (const kind of ['users', 'lectures', 'protocols']) {
    assert(Array.isArray(data[kind]), `Missing ${kind}`);
    assert(
      data[kind].every(
        (row) => typeof row.sourceId === 'string' && /^[1-9][0-9]*$/.test(row.sourceId)
      ),
      `Invalid ${kind} source ID`
    );
    assert.equal(
      new Set(data[kind].map((row) => row.sourceId)).size,
      data[kind].length,
      `Duplicate ${kind} source IDs`
    );
  }
  const emails = new Set();
  for (const user of data.users) {
    const builtin =
      user.sourceId === '1' &&
      user.email === `deleted-${id('user', '1')}@accounts.invalid` &&
      !user.verified &&
      user.status === 'suspended';
    assert(
      builtin || /^zx[a-z]{3}[0-9]{2}@student\.uni-tuebingen\.de$/.test(user.email),
      `Invalid account address: ${user.sourceId}`
    );
    assert(!emails.has(user.email), 'Duplicate account emails');
    emails.add(user.email);
    assert(
      typeof user.isAdmin === 'boolean' && typeof user.verified === 'boolean',
      'Invalid account flags'
    );
    assert(
      !user.isAdmin || builtin || (user.verified && user.status === 'active'),
      'Administrator must be verified and active'
    );
    assert(
      ['active', 'unverified', 'suspended', 'deletion_pending'].includes(user.status),
      'Invalid account state'
    );
    assert(
      Number.isSafeInteger(user.balance) && user.balance >= 0 && user.balance <= 2147483647,
      'Invalid opening balance'
    );
    assert(typeof user.note === 'string' && user.note.length <= 4000, 'Invalid account note');
  }
  const lectures = new Set(data.lectures.map((row) => row.sourceId));
  for (const lecture of data.lectures)
    assert(
      typeof lecture.name === 'string' &&
        lecture.name.length > 0 &&
        lecture.name.length <= 200 &&
        typeof lecture.archived === 'boolean',
      'Invalid lecture'
    );
  for (const protocol of data.protocols) {
    assert(
      typeof protocol.owner === 'string' && /^[0-9]+$/.test(protocol.owner),
      'Invalid source owner'
    );
    assert(
      ['ACCEPTED', 'DECLINED', 'UNCHECKED', 'TO_BE_DELETED'].includes(protocol.status),
      'Invalid protocol status'
    );
    assert(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(protocol.uploadedDate),
      'Invalid upload date'
    );
    assert(
      Array.isArray(protocol.lectures) &&
        protocol.lectures.length <= 3 &&
        protocol.lectures.every((source) => lectures.has(source)),
      'Unknown lecture reference'
    );
    assert(
      typeof protocol.remarks === 'string' && protocol.remarks.length <= 2000,
      'Invalid protocol remarks'
    );
    assert(
      typeof protocol.originalName === 'string' &&
        protocol.originalName.length > 0 &&
        protocol.originalName.length <= 255,
      'Invalid original filename'
    );
    assert(
      new RegExp(`^files/${protocol.sourceId}\\.(pdf|txt)$`).test(protocol.file.path),
      'Unsafe protocol path'
    );
    assert(/^[a-f0-9]{64}$/.test(protocol.file.sha256), 'Invalid file checksum');
    assert(
      Number.isSafeInteger(protocol.file.bytes) &&
        protocol.file.bytes > 0 &&
        protocol.file.bytes <= 30 * 1024 * 1024,
      'Invalid file size'
    );
    assert(
      Array.isArray(protocol.metadata.examiners) &&
        protocol.metadata.examiners.every(
          (name) => typeof name === 'string' && name.length > 0 && name.length <= 200
        ),
      'Invalid examiners'
    );
    assert(
      protocol.metadata.exam_date === null ||
        (/^\d{4}-\d{2}-\d{2}$/.test(protocol.metadata.exam_date) &&
          new Date(protocol.metadata.exam_date).toISOString().slice(0, 10) ===
            protocol.metadata.exam_date),
      'Invalid exam date'
    );
    assert(
      protocol.metadata.term === null || /^(SS\d{4}|WS\d{4}\/\d{2})$/.test(protocol.metadata.term),
      'Invalid semester'
    );
  }
  return data;
}
