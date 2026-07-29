/**
 * domains/leave-attendance/close-snapshot.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseSnapshotHelpers } from '../close-snapshot.js';

function make(overrides = {}) {
  return createCloseSnapshotHelpers({
    safeMonthOnly: (m) => {
      const s = String(m || '').trim();
      return /^\d{4}-\d{2}$/.test(s) ? s : '';
    },
    shiftMonth: (m, delta) => {
      if (!/^\d{4}-\d{2}$/.test(m)) return '';
      const [y, mo] = m.split('-').map(Number);
      const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    },
    leaveBalanceOverrideKey: (u, m) => `${String(u).toLowerCase()}|${m}`,
    getLeaveBalanceOverride: () => null,
    calcEmployeeMonthlyCarryover: () => 1.5,
    getSharedState: async () => ({}),
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    resolveTenantIdDefault: () => 'default',
    invalidateSharedStateCache: () => {},
    isLegacyTestUsername: (u) => String(u).startsWith('test_'),
    hrmsNowISO: () => '2026-07-01T06:00:00+08:00',
    ...overrides,
  });
}

test('getLeaveCumulativeCloseSnapshot：无/非法 → null；数字与对象形态', () => {
  const { getLeaveCumulativeCloseSnapshot } = make();
  assert.equal(getLeaveCumulativeCloseSnapshot({}, 'a', '2026-06'), null);
  assert.equal(
    getLeaveCumulativeCloseSnapshot({ leaveCumulativeCloseSnapshots: { 'a|2026-06': 'x' } }, 'a', '2026-06'),
    null
  );
  assert.deepEqual(
    getLeaveCumulativeCloseSnapshot({ leaveCumulativeCloseSnapshots: { 'a|2026-06': 3.2 } }, 'a', '2026-06'),
    { value: 3.2, lockedAt: '', source: 'system' }
  );
  assert.deepEqual(
    getLeaveCumulativeCloseSnapshot(
      { leaveCumulativeCloseSnapshots: { 'a|2026-06': { value: 4, lockedAt: 't', source: 'manual' } } },
      'a',
      '2026-06'
    ),
    { value: 4, lockedAt: 't', source: 'manual' }
  );
});

test('getLockedOpeningCarryForMonth：人工 carryover > 快照 > 公式', () => {
  const helpers = make({
    getLeaveBalanceOverride: (_s, u, m) =>
      u === 'alice' && m === '2026-07' ? { mode: 'carryover', value: 9 } : null,
    calcEmployeeMonthlyCarryover: () => 2,
  });
  assert.equal(
    helpers.getLockedOpeningCarryForMonth({ leaveCumulativeCloseSnapshots: {} }, { username: 'alice' }, '2026-07'),
    9
  );
  assert.equal(
    helpers.getLockedOpeningCarryForMonth(
      { leaveCumulativeCloseSnapshots: { 'bob|2026-06': { value: 5.5 } } },
      { username: 'bob' },
      '2026-07'
    ),
    5.5
  );
  assert.equal(
    helpers.getLockedOpeningCarryForMonth({}, { username: 'carol' }, '2026-07'),
    2
  );
});

test('runLeaveCumulativeCloseSnapshotForClosedMonth：bad_month / bad_next', async () => {
  const { runLeaveCumulativeCloseSnapshotForClosedMonth } = make({
    shiftMonth: () => '',
  });
  assert.deepEqual(await runLeaveCumulativeCloseSnapshotForClosedMonth('bad'), {
    ok: false,
    error: 'bad_month',
  });
  const helpers = make({
    safeMonthOnly: (m) => (/^\d{4}-\d{2}$/.test(m) ? m : ''),
    shiftMonth: (m) => (m === '2026-06' ? '' : '2026-07'),
  });
  assert.deepEqual(await helpers.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06'), {
    ok: false,
    error: 'bad_next',
  });
});

/** upsertLeaveDomain 走 SELECT ... FOR UPDATE 加锁合并，mock 需要支持 pool.connect() 事务。 */
function makeLeaveDomainPool({ currentRow = null, captureUpdate } = {}) {
  return {
    async query() {
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params) {
          const s = String(sql);
          if (/^\s*BEGIN/i.test(s) || /^\s*COMMIT/i.test(s) || /^\s*ROLLBACK/i.test(s)) return {};
          if (/SELECT[\s\S]*FROM hrms_leave_domain[\s\S]*FOR UPDATE/i.test(s)) {
            return { rows: currentRow ? [currentRow] : [] };
          }
          if (/UPDATE hrms_leave_domain/i.test(s)) {
            if (captureUpdate) captureUpdate(params);
            return { rowCount: 1 };
          }
          if (/INSERT INTO hrms_leave_domain/i.test(s)) {
            return {};
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

test('runLeaveCumulativeCloseSnapshotForClosedMonth：写 leave domain 表、跳过 test_/manual', async () => {
  let updateParams = null;
  let invalidated = 0;
  const helpers = make({
    getSharedState: async () => ({
      users: [
        { username: 'test_skip', name: 't' },
        { username: 'alice', name: 'A' },
      ],
      employees: [
        { username: 'alice', store: 'S1' },
        { username: 'bob', store: 'S2' },
        { username: '', store: 'x' },
      ],
      leaveCumulativeCloseSnapshots: {
        'alice|2026-06': { value: 1, source: 'manual_carryover' },
      },
      leaveBalanceOverrides: { x: 1 },
      leaveBalanceAdjustments: [{ id: 'a1' }],
    }),
    calcEmployeeMonthlyCarryover: (_s, p) => (p.username === 'bob' ? 7.1 : 3),
    pool: makeLeaveDomainPool({
      currentRow: {
        leave_balance_overrides: { existingKey: 1 },
        leave_balance_adjustments: [{ id: 'keep-me' }],
        leave_cumulative_close_snapshots: {},
        updated_at: 'ts1',
      },
      captureUpdate: (params) => { updateParams = params; },
    }),
    invalidateSharedStateCache: () => {
      invalidated += 1;
    },
  });
  const ok = await helpers.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06');
  assert.equal(ok.ok, true);
  assert.equal(ok.employees, 1); // alice skipped (manual), bob written
  const snaps = JSON.parse(updateParams[3]);
  assert.equal(snaps['bob|2026-06'].value, 7.1);
  assert.equal(snaps['alice|2026-06'].source, 'manual_carryover');
  // 只 patch leaveCumulativeCloseSnapshots：overrides/adjustments 必须原样保留表里的当前值，
  // 不能被这个函数读到的（可能是旧的）state0 覆盖——这正是这次要修的并发覆盖丢失 bug。
  assert.deepEqual(JSON.parse(updateParams[1]), { existingKey: 1 });
  assert.deepEqual(JSON.parse(updateParams[2]), [{ id: 'keep-me' }]);
  assert.equal(invalidated, 1);

  const fail = make({
    getSharedState: async () => ({ employees: [{ username: 'x' }] }),
    pool: {
      async query() {
        throw new Error('boom');
      },
      async connect() {
        throw new Error('boom');
      },
    },
  });
  const out = await fail.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06');
  assert.deepEqual(out, { ok: false, error: 'internal_error', closedMonth: '2026-06' });
});
