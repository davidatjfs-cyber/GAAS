/**
 * L1：月结 run 状态机 + buildPayrollForMonth（mock db，不连真实 Postgres）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrCreateMonthRun,
  setMonthRunStatus,
  buildPayrollForMonth,
} from '../services/hrms-payroll-engine.js';

function mockDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params: params || [] });
      return handler(String(sql), params || [], calls.length);
    },
  };
}

test('getOrCreateMonthRun: 缺 month → null；正常 INSERT+SELECT', async () => {
  const bad = mockDb(async () => ({ rows: [] }));
  assert.equal(await getOrCreateMonthRun({ month: '', db: bad }), null);

  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_month_runs/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) {
      return { rows: [{ id: 'run-1', status: 'open', biz_month: '2026-07' }] };
    }
    return { rows: [] };
  });
  const row = await getOrCreateMonthRun({
    tenantId: 'default',
    store: '洪潮',
    month: '2026-07-15',
    db,
  });
  assert.equal(row.id, 'run-1');
  assert.ok(db.calls.some((c) => /INSERT INTO hrms_payroll_month_runs/i.test(c.sql)));
});

test('setMonthRunStatus: invalid / open / locked / paid + snapshot', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_month_runs/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) {
      return { rows: [{ id: 'run-1', status: 'open' }] };
    }
    if (/UPDATE hrms_payroll_month_runs/i.test(sql)) {
      return { rows: [{ id: 'run-1', status: 'attendance_locked' }] };
    }
    return { rows: [] };
  });

  assert.deepEqual(
    await setMonthRunStatus({ month: '2026-07', status: 'weird', db }),
    { ok: false, error: 'invalid_status' }
  );

  const locked = await setMonthRunStatus({
    store: '洪潮',
    month: '2026-07',
    status: 'attendance_locked',
    by: 'mgr1',
    snapshot: { n: 1 },
    db,
  });
  assert.equal(locked.ok, true);
  assert.ok(db.calls.some((c) => /attendance_locked_at/i.test(c.sql)));
  assert.ok(db.calls.some((c) => /snapshot/i.test(c.sql)));

  const paidDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql) || /INSERT INTO hrms_payroll_month_runs/i.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) return { rows: [{ id: 'r' }] };
    if (/UPDATE hrms_payroll_month_runs/i.test(sql)) return { rows: [{ id: 'r', status: 'paid' }] };
    return { rows: [] };
  });
  const paid = await setMonthRunStatus({
    month: '2026-07',
    status: 'paid',
    by: 'hq',
    db: paidDb,
  });
  assert.equal(paid.ok, true);
  assert.ok(paidDb.calls.some((c) => /paid_at/i.test(c.sql)));

  const openDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql) || /INSERT INTO/i.test(sql)) return { rows: [] };
    if (/SELECT \*/i.test(sql)) return { rows: [{ id: 'r' }] };
    if (/UPDATE/i.test(sql)) return { rows: [{ id: 'r', status: 'open' }] };
    return { rows: [] };
  });
  const opened = await setMonthRunStatus({ month: '2026-07', status: 'open', db: openDb });
  assert.equal(opened.ok, true);
  assert.ok(openDb.calls.some((c) => /attendance_locked_at = NULL/i.test(c.sql)));

  const plDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql) || /INSERT INTO/i.test(sql)) return { rows: [] };
    if (/SELECT \*/i.test(sql)) return { rows: [{ id: 'r' }] };
    if (/UPDATE/i.test(sql)) return { rows: [{ id: 'r', status: 'payroll_locked' }] };
    return { rows: [] };
  });
  const pl = await setMonthRunStatus({
    month: '2026-07',
    status: 'payroll_locked',
    by: 'fin',
    db: plDb,
  });
  assert.equal(pl.ok, true);
  assert.ok(plDb.calls.some((c) => /payroll_locked_at/i.test(c.sql)));
});

test('buildPayrollForMonth: 缺月 / reconcile 失败仍继续 / 出明细', async () => {
  assert.deepEqual(await buildPayrollForMonth({ month: '', db: mockDb(async () => ({ rows: [] })) }), {
    ok: false,
    error: 'missing_month',
  });

  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_payroll_rules/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_month_runs/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) {
      return { rows: [{ id: 'run-1', status: 'open' }] };
    }
    if (/FROM hrms_payroll_ledger/i.test(sql)) {
      return {
        rows: [
          { username: 'alice', entry_type: 'points', amount: 20 },
          { username: 'Alice', entry_type: 'reward', amount: 10 },
        ],
      };
    }
    if (/FROM hrms_attendance_days/i.test(sql) || /summarize/i.test(sql)) {
      return { rows: [] };
    }
    // summarizeAttendanceDaysForMonth / reconcile 可能发各种 SELECT — 默认空
    if (/SELECT/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  // reconcile 走真实 import，会因表结构/数据失败；引擎应 catch 后继续
  const result = await buildPayrollForMonth({
    tenantId: 'default',
    month: '2026-07',
    store: '洪潮',
    people: [
      {
        username: 'alice',
        name: 'Alice',
        store: '洪潮',
        salary: 5400,
        joinDate: '2025-01-01',
        leaveRemaining: 1,
      },
      { username: '', name: 'skip' },
      {
        username: 'bob',
        name: 'Bob',
        store: '洪潮',
        join_date: '2026-07-20',
      },
    ],
    leaveBalanceByUser: new Map([['alice', 2]]),
    findUserSalary: () => 5400,
    state: {},
    getSharedState: async () => ({}),
    reconcile: true,
    db,
  });

  assert.equal(result.ok, true);
  assert.equal(result.month, '2026-07');
  assert.equal(result.store, '洪潮');
  assert.ok(result.monthRun);
  assert.equal(result.rows.length, 2);
  const alice = result.rows.find((r) => r.username === 'alice');
  assert.ok(alice);
  assert.equal(alice.pointsAmount, 20);
  assert.equal(alice.rewardPunishmentAdj, 10);
  assert.ok(Number.isFinite(result.totalAmount));
});

test('buildPayrollForMonth: reconcile=false 且按 people 门店聚合', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_payroll_rules/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_month_runs/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) return { rows: [{ id: 'r' }] };
    if (/FROM hrms_payroll_ledger/i.test(sql)) return { rows: [] };
    if (/SELECT/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const r = await buildPayrollForMonth({
    month: '2026-07',
    store: '',
    people: [{ username: 'u1', name: 'U1', store: '马己仙', salary: 3000, joinDate: '2024-01-01' }],
    leaveBalanceByUser: { u1: 0 },
    reconcile: false,
    db,
  });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].store, '马己仙');
});

test('buildPayrollForMonth: 无 store 时按 people 门店 reconcile，失败可吞掉', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_payroll_rules/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_month_runs/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM hrms_payroll_month_runs/i.test(sql)) return { rows: [{ id: 'r' }] };
    if (/FROM hrms_payroll_ledger/i.test(sql)) return { rows: [] };
    // reconcile upsert 炸掉 → buildPayroll catch 后继续算薪
    if (/INSERT INTO hrms_attendance_day\b/i.test(sql)) {
      throw new Error('reconcile_boom');
    }
    if (/SELECT/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const r = await buildPayrollForMonth({
    month: '2026-07',
    store: '',
    people: [
      { username: 'u1', name: 'U1', store: '洪潮', salary: 4000, joinDate: '2024-01-01' },
      { username: 'u2', name: 'U2', store: '马己仙', salary: 4000, joinDate: '2024-01-01' },
    ],
    leaveBalanceByUser: {},
    getSharedState: async () => ({
      employees: [
        { username: 'u1', name: 'U1', store: '洪潮', status: '在职', joinDate: '2024-01-01' },
        { username: 'u2', name: 'U2', store: '马己仙', status: '在职', joinDate: '2024-01-01' },
      ],
    }),
    reconcile: true,
    db,
  });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
});
