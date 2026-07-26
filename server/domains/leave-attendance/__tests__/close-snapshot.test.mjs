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
    mergeSharedStateFields: async () => {},
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

test('getLockedOpeningCarryForMonth：缺参0；人工覆盖 > 快照 > 公式', () => {
  const helpers = make({
    getLeaveBalanceOverride: (_s, u, m) =>
      u === 'bob' && m === '2026-07' ? { mode: 'carryover', value: 9.1 } : null,
    calcEmployeeMonthlyCarryover: () => 2.22,
  });
  assert.equal(helpers.getLockedOpeningCarryForMonth({}, null, '2026-07'), 0);
  assert.equal(helpers.getLockedOpeningCarryForMonth({}, { username: 'bob' }, 'bad'), 0);
  assert.equal(helpers.getLockedOpeningCarryForMonth({}, { username: 'bob' }, '2026-07'), 9.1);
  assert.equal(
    helpers.getLockedOpeningCarryForMonth(
      { leaveCumulativeCloseSnapshots: { 'alice|2026-06': { value: 5.55 } } },
      { username: 'alice' },
      '2026-07'
    ),
    5.55
  );
  assert.equal(helpers.getLockedOpeningCarryForMonth({}, { username: 'carol' }, '2026-07'), 2.22);
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
    safeMonthOnly: () => '2026-06',
    shiftMonth: () => '',
  });
  assert.deepEqual(await helpers.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06'), {
    ok: false,
    error: 'bad_next',
  });
});

test('runLeaveCumulativeCloseSnapshotForClosedMonth：合并人、跳过 test_/manual、merge 失败', async () => {
  let merged = null;
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
    }),
    calcEmployeeMonthlyCarryover: (_s, p) => (p.username === 'bob' ? 7.1 : 3),
    mergeSharedStateFields: async (fields) => {
      merged = fields;
    },
  });
  const ok = await helpers.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06');
  assert.equal(ok.ok, true);
  assert.equal(ok.employees, 1); // alice skipped (manual), bob written
  assert.equal(merged.leaveCumulativeCloseSnapshots['bob|2026-06'].value, 7.1);
  assert.equal(merged.leaveCumulativeCloseSnapshots['alice|2026-06'].source, 'manual_carryover');

  const fail = make({
    getSharedState: async () => ({ employees: [{ username: 'x' }] }),
    mergeSharedStateFields: async () => {
      throw new Error('boom');
    },
  });
  const out = await fail.runLeaveCumulativeCloseSnapshotForClosedMonth('2026-06');
  assert.deepEqual(out, { ok: false, error: 'internal_error', closedMonth: '2026-06' });
});
