import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeRowToStateShape,
  hydrateEmployeesFromTable,
} from '../service.js';

test('employeeRowToStateShape 映射结构化列与 extra_json', () => {
  const shape = employeeRowToStateShape({
    id: 'u1',
    username: 'alice',
    name: 'Alice',
    role: 'store_manager',
    store: '洪潮',
    department: '前厅',
    position: '店长',
    status: 'inactive',
    gender: '女',
    phone: '138',
    email: 'a@b.c',
    join_date: '2024-01-01',
    birthday: '1990-01-01',
    salary: '10000',
    password_hash: 'secret',
    manager_username: 'boss',
    id_card_number: 'X',
    bank_card: 'Y',
    extra_json: { level: 'L3', coreTalent: true, status: 'active', role: 'hack' },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-02-01T00:00:00.000Z',
  });
  assert.equal(shape.username, 'alice');
  assert.equal(shape.password, 'secret');
  assert.equal(shape.joinDate, '2024-01-01');
  assert.equal(shape.level, 'L3');
  assert.equal(shape.coreTalent, true);
  assert.equal(shape.status, 'inactive');
  assert.equal(shape.role, 'store_manager');
});

test('hydrateEmployeesFromTable：表有数据时覆盖 state', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: 'u1',
            username: 'bob',
            name: 'Bob',
            role: 'staff',
            store: '马己仙',
            department: '',
            position: '',
            status: 'active',
            gender: '',
            phone: '',
            email: '',
            join_date: '',
            birthday: '',
            salary: '',
            password_hash: '',
            manager_username: '',
            id_card_number: '',
            bank_card: '',
            extra_json: {},
            created_at: null,
            updated_at: null,
          },
        ],
      };
    },
  };
  const out = await hydrateEmployeesFromTable(pool, { employees: [{ username: 'stale', name: 'Stale' }], settings: { a: 1 } }, 'default');
  assert.equal(out.settings.a, 1);
  assert.equal(out.employees.length, 1);
  assert.equal(out.employees[0].username, 'bob');
});

test('hydrateEmployeesFromTable：表空时保留 state', async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  const out = await hydrateEmployeesFromTable(
    pool,
    { employees: [{ username: 'keep', name: 'Keep' }] },
    'default'
  );
  assert.equal(out.employees[0].username, 'keep');
});
