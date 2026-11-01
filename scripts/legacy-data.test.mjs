import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, assignments, validatePrepared } from './legacy-data.mjs';

const row = {
  id: '2',
  username: 'zxabc12',
  role: 'ADMIN',
  tokens: '13',
  comment: 'private%20note'
};
test('preserves admin flags, notes, balances and restricted account states', () => {
  assert.deepEqual(account(row), {
    sourceId: '2',
    email: 'zxabc12@student.uni-tuebingen.de',
    name: 'zxabc12',
    isAdmin: true,
    status: 'active',
    verified: true,
    balance: 13,
    note: 'private note'
  });
  assert.equal(account({ ...row, role: 'USER' }).isAdmin, false);
  assert.equal(account({ ...row, role: 'BLOCKED' }).status, 'suspended');
  assert.equal(account({ ...row, role: 'NOT_ACTIVATED' }).verified, false);
  assert.equal(account({ ...row, id: '1', username: 'admin' }).isAdmin, true);
  assert.equal(account({ ...row, id: '1', username: 'admin' }).status, 'suspended');
  assert.equal(
    account({ ...row, username: '%20zxabc12' }).email,
    'zxabc12@student.uni-tuebingen.de'
  );
  assert.throws(() => account({ ...row, tokens: '-1' }));
  assert.throws(() => account({ ...row, role: 'UNKNOWN' }));
});

test('rejects duplicate accounts and invalid privileges before importing', () => {
  const data = { version: 1, users: [account(row)], lectures: [], protocols: [] };
  assert.equal(validatePrepared(data), data);
  assert.throws(
    () => validatePrepared({ ...data, users: [...data.users, ...data.users] }),
    /Duplicate users/
  );
  assert.throws(
    () => validatePrepared({ ...data, users: [{ ...data.users[0], verified: false }] }),
    /Administrator/
  );
  assert.throws(
    () => validatePrepared({ ...data, users: [{ ...data.users[0], balance: -1 }] }),
    /balance/
  );
});
test('resolves lecture names containing commas and refuses ambiguous assignments', () => {
  assert.deepEqual(
    assignments('Theory, Patterns, Networks, Logic', [
      { id: 1, name: 'Theory, Patterns, Networks' },
      { id: 2, name: 'Logic' }
    ]),
    [1, 2]
  );
  assert.throws(() =>
    assignments('A, B', [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'A, B' }
    ])
  );
});
