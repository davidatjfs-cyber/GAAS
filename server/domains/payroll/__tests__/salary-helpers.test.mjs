import test from 'node:test';
import assert from 'node:assert/strict';
import { getStateUsers, findUserSalary } from '../../employees/salary-helpers.js';

test('getStateUsers returns empty arrays for empty/null state', () => {
  assert.deepEqual(getStateUsers({}), { users: [], employees: [] });
  assert.deepEqual(getStateUsers(null), { users: [], employees: [] });
  assert.deepEqual(getStateUsers(undefined), { users: [], employees: [] });
  assert.deepEqual(getStateUsers({ users: null, employees: 'x' }), { users: [], employees: [] });
});

test('getStateUsers passes through arrays', () => {
  const users = [{ username: 'a' }];
  const employees = [{ username: 'b' }];
  assert.deepEqual(getStateUsers({ users, employees }), { users, employees });
});

test('findUserSalary cascade: salary beats wage beats baseSalary beats monthlySalary beats pay', () => {
  const base = {
    users: [{
      username: 'alice',
      salary: 5000,
      wage: 4000,
      baseSalary: 3000,
      monthlySalary: 2000,
      pay: 1000,
    }],
    employees: [],
  };
  assert.equal(findUserSalary(base, 'alice'), 5000);

  assert.equal(findUserSalary({
    users: [{ username: 'alice', wage: 4000, baseSalary: 3000, monthlySalary: 2000, pay: 1000 }],
  }, 'alice'), 4000);

  assert.equal(findUserSalary({
    users: [{ username: 'alice', baseSalary: 3000, monthlySalary: 2000, pay: 1000 }],
  }, 'alice'), 3000);

  assert.equal(findUserSalary({
    users: [{ username: 'alice', monthlySalary: 2000, pay: 1000 }],
  }, 'alice'), 2000);

  assert.equal(findUserSalary({
    users: [{ username: 'alice', pay: 1000 }],
  }, 'alice'), 1000);
});

test('findUserSalary empty string fields fall through cascade', () => {
  assert.equal(findUserSalary({
    users: [{ username: 'alice', salary: '', wage: '', baseSalary: '', monthlySalary: '', pay: 900 }],
  }, 'alice'), 900);
});

test('findUserSalary missing user → null; non-finite → null', () => {
  assert.equal(findUserSalary({ users: [], employees: [] }, 'alice'), null);
  assert.equal(findUserSalary({ users: [{ username: 'alice', salary: 'nope' }] }, 'alice'), null);
  assert.equal(findUserSalary({ users: [{ username: 'alice', salary: Infinity }] }, 'alice'), null);
  assert.equal(findUserSalary({}, ''), null);
  assert.equal(findUserSalary({}, '   '), null);
});

test('findUserSalary prefers users over employees; case-sensitive exact trim match', () => {
  const state = {
    users: [{ username: 'Alice', salary: 111 }],
    employees: [{ username: 'alice', salary: 222 }, { username: 'Bob', salary: 333 }],
  };
  assert.equal(findUserSalary(state, 'Alice'), 111);
  assert.equal(findUserSalary(state, 'alice'), 222);
  assert.equal(findUserSalary(state, 'ALICE'), null);
  assert.equal(findUserSalary(state, 'Bob'), 333);
  assert.equal(findUserSalary(state, 'bob'), null);
});
