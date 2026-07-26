/**
 * domains/leave-attendance/date-math.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDateMathHelpers } from '../date-math.js';

function make() {
  return createDateMathHelpers({
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    safeMonthOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}$/.test(s) ? s : '';
    },
  });
}

test('calcDateSpanDaysInclusive：同日/跨日/坏输入/end<start', () => {
  const h = make();
  assert.equal(h.calcDateSpanDaysInclusive('2026-07-01', '2026-07-01'), 1);
  assert.equal(h.calcDateSpanDaysInclusive('2026-07-01', '2026-07-03'), 3);
  assert.equal(h.calcDateSpanDaysInclusive('bad', '2026-07-03'), null);
  assert.equal(h.calcDateSpanDaysInclusive('2026-07-05', '2026-07-01'), null);
});

test('calcOverlapDaysWithinMonth：重叠/无重叠/坏输入', () => {
  const h = make();
  assert.equal(h.calcOverlapDaysWithinMonth('2026-06-28', '2026-07-03', '2026-07'), 3);
  assert.equal(h.calcOverlapDaysWithinMonth('2026-08-01', '2026-08-05', '2026-07'), 0);
  assert.equal(h.calcOverlapDaysWithinMonth('bad', '2026-07-03', '2026-07'), 0);
  assert.equal(h.calcOverlapDaysWithinMonth('2026-07-05', '2026-07-01', '2026-07'), 0);
});

test('calcCumulativeLeaveDaysByJoinDate：档位与非法日期', () => {
  const h = make();
  assert.equal(h.calcCumulativeLeaveDaysByJoinDate(''), 0);
  assert.equal(h.calcCumulativeLeaveDaysByJoinDate('2026/01/01'), 0);
  const realNow = Date.now;
  Date.now = () => new Date('2026-07-26T00:00:00').getTime();
  try {
    assert.equal(h.calcCumulativeLeaveDaysByJoinDate('2026-06-01'), 0); // <1y
    assert.equal(h.calcCumulativeLeaveDaysByJoinDate('2024-07-01'), 5); // ≥1
    assert.equal(h.calcCumulativeLeaveDaysByJoinDate('2015-07-01'), 10); // ≥10
    assert.equal(h.calcCumulativeLeaveDaysByJoinDate('2000-07-01'), 15); // ≥20
  } finally {
    Date.now = realNow;
  }
});

test('shiftMonth / leaveBalanceOverrideKey / getLeaveBalanceOverride', () => {
  const h = make();
  assert.equal(h.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(h.shiftMonth('2026-07', 1), '2026-08');
  assert.equal(h.shiftMonth('bad', 1), '');
  assert.equal(h.shiftMonth('2026-07', NaN), '');
  assert.equal(h.leaveBalanceOverrideKey('Alice', '2026-07'), 'alice_2026-07');

  assert.equal(h.getLeaveBalanceOverride({}, 'a', '2026-07'), null);
  assert.deepEqual(
    h.getLeaveBalanceOverride(
      { leaveBalanceOverrides: { 'alice_2026-07': 3.5 } },
      'Alice',
      '2026-07'
    ),
    { mode: 'remaining', value: 3.5, raw: 3.5 }
  );
  assert.equal(
    h.getLeaveBalanceOverride(
      { leaveBalanceOverrides: { 'Alice_2026-07': { mode: 'carryover', value: 2 } } },
      'Alice',
      '2026-07'
    ).value,
    2
  );
  assert.equal(
    h.getLeaveBalanceOverride(
      { leaveBalanceOverrides: { 'alice_2026-07': { mode: 'x', value: 'bad' } } },
      'alice',
      '2026-07'
    ),
    null
  );
  assert.equal(
    h.getLeaveBalanceOverride(
      { leaveBalanceOverrides: { 'alice_2026-07': 'nope' } },
      'alice',
      '2026-07'
    ),
    null
  );
});
