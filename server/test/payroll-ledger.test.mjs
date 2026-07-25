/**
 * L1：薪资账本 upsert / list / 底薪时间线 — mock db，不连真实 Postgres。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPromotionSalaryNextMonth,
  getSalaryForMonth,
  insertSalaryTimeline,
  listPayrollLedgerForMonth,
  upsertPayrollLedgerEntry,
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

test('upsertPayrollLedgerEntry: 缺 username/bizMonth/entryType → invalid', async () => {
  const db = mockDb(async () => ({ rows: [] }));
  assert.deepEqual(
    await upsertPayrollLedgerEntry({ username: '', bizMonth: '2026-07', entryType: 'points', db }),
    { ok: false, error: 'invalid' }
  );
  assert.deepEqual(
    await upsertPayrollLedgerEntry({ username: 'u1', bizMonth: '', entryType: 'points', db }),
    { ok: false, error: 'invalid' }
  );
});

test('upsertPayrollLedgerEntry: 无既有 approval 行 → INSERT', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM hrms_payroll_ledger/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_payroll_ledger/i.test(sql)) {
      return { rows: [{ id: 'led-1', amount: 12.5, entry_type: 'points' }] };
    }
    return { rows: [] };
  });
  const r = await upsertPayrollLedgerEntry({
    tenantId: 'default',
    username: 'emp1',
    store: '洪潮',
    bizMonth: '2026-07',
    entryType: 'points',
    amount: 12.5,
    points: 25,
    approvalId: 'appr-1',
    title: '积分',
    createdBy: 'mgr1',
    db,
  });
  assert.equal(r.ok, true);
  assert.equal(r.row.id, 'led-1');
  assert.ok(db.calls.some((c) => /INSERT INTO hrms_payroll_ledger/i.test(c.sql)));
});

test('upsertPayrollLedgerEntry: 已有 approval+type → UPDATE', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM hrms_payroll_ledger/i.test(sql)) return { rows: [{ id: 'existing-9' }] };
    if (/UPDATE hrms_payroll_ledger/i.test(sql)) {
      return { rows: [{ id: 'existing-9', amount: -50, entry_type: 'punishment' }] };
    }
    return { rows: [] };
  });
  const r = await upsertPayrollLedgerEntry({
    username: 'emp2',
    bizMonth: '2026-07',
    entryType: 'punishment',
    amount: -50,
    approvalId: 'appr-rp',
    db,
  });
  assert.equal(r.ok, true);
  assert.equal(r.row.id, 'existing-9');
  assert.ok(db.calls.some((c) => /UPDATE hrms_payroll_ledger/i.test(c.sql)));
  assert.ok(!db.calls.some((c) => /INSERT INTO hrms_payroll_ledger/i.test(c.sql)));
});

test('listPayrollLedgerForMonth: 无 month → []；带 store/username 过滤', async () => {
  assert.deepEqual(await listPayrollLedgerForMonth({ month: '', db: mockDb(async () => ({ rows: [] })) }), []);

  const db = mockDb(async (sql, params) => {
    assert.match(sql, /tenant_id = \$1 AND biz_month = \$2/);
    assert.match(sql, /TRIM\(store\)/);
    assert.match(sql, /LOWER\(username\)/);
    assert.deepEqual(params.slice(0, 4), ['default', '2026-07', '洪潮', 'emp1']);
    return { rows: [{ id: '1', amount: 10 }] };
  });
  const rows = await listPayrollLedgerForMonth({
    month: '2026-07',
    store: '洪潮',
    username: 'emp1',
    db,
  });
  assert.equal(rows.length, 1);
});

test('insertSalaryTimeline: invalid 参数；合法则 INSERT', async () => {
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_salary_timeline/i.test(sql)) {
      return { rows: [{ id: 'sal-1', amount: 8000 }] };
    }
    return { rows: [] };
  });
  assert.equal(
    (await insertSalaryTimeline({ username: 'u', amount: 0, effectiveFrom: '2026-08-01', db })).ok,
    false
  );
  const ok = await insertSalaryTimeline({
    username: 'u1',
    amount: 8000,
    effectiveFrom: '2026-08-01',
    source: 'manual',
    db,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.amount, 8000);
});

test('getSalaryForMonth: 时间线命中；否则 profile_fallback', async () => {
  const hit = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_salary_timeline/i.test(sql)) {
      return { rows: [{ amount: 9000, effective_from: '2026-06-01', source: 'promotion' }] };
    }
    return { rows: [] };
  });
  const a = await getSalaryForMonth({ username: 'u1', month: '2026-07', db: hit });
  assert.equal(a.amount, 9000);
  assert.equal(a.source, 'promotion');

  const miss = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_salary_timeline/i.test(sql)) throw new Error('no table');
    return { rows: [] };
  });
  const b = await getSalaryForMonth({
    username: 'u1',
    month: '2026-07',
    fallbackSalary: 7000,
    db: miss,
  });
  assert.equal(b.amount, 7000);
  assert.equal(b.source, 'profile_fallback');
});

test('applyPromotionSalaryNextMonth: 审批日→次月1日写入', async () => {
  let insertedEff = null;
  const db = mockDb(async (sql, params) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_salary_timeline/i.test(sql)) {
      insertedEff = params[4];
      return { rows: [{ id: 'p1', amount: params[3], effective_from: params[4] }] };
    }
    return { rows: [] };
  });
  const r = await applyPromotionSalaryNextMonth({
    username: 'emp1',
    newSalary: 10000,
    approvalId: 'appr-promo',
    approvedAt: '2026-07-15',
    createdBy: 'boss',
    db,
  });
  assert.equal(r.ok, true);
  assert.equal(insertedEff, '2026-08-01');
});
