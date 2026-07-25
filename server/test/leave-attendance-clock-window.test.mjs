/**
 * domains/leave-attendance/clock-window.js 纯函数单测（上海时区 + 门店班次窗口）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hrmsClockMinutesInShanghai,
  hrmsDateKeyInShanghai,
  hrmsAttendanceWindowMinutesForStore,
} from '../domains/leave-attendance/clock-window.js';

test('hrmsClockMinutesInShanghai：非法输入 → NaN', () => {
  assert.ok(Number.isNaN(hrmsClockMinutesInShanghai(null)));
  assert.ok(Number.isNaN(hrmsClockMinutesInShanghai('2026-01-01')));
  assert.ok(Number.isNaN(hrmsClockMinutesInShanghai(new Date('invalid'))));
});

test('hrmsClockMinutesInShanghai：固定 UTC 映射到上海墙钟分钟', () => {
  // 2026-07-01 01:30 UTC = 上海 09:30 → 9*60+30
  const d = new Date('2026-07-01T01:30:00.000Z');
  assert.equal(hrmsClockMinutesInShanghai(d), 9 * 60 + 30);
});

test('hrmsDateKeyInShanghai：非法输入 → 空串；跨日按上海日历', () => {
  assert.equal(hrmsDateKeyInShanghai(null), '');
  assert.equal(hrmsDateKeyInShanghai(new Date('invalid')), '');
  // 2026-07-01 16:00 UTC = 上海 2026-07-02 00:00
  assert.equal(hrmsDateKeyInShanghai(new Date('2026-07-01T16:00:00.000Z')), '2026-07-02');
  // 2026-07-01 15:59 UTC = 上海 2026-07-01 23:59
  assert.equal(hrmsDateKeyInShanghai(new Date('2026-07-01T15:59:00.000Z')), '2026-07-01');
});

test('hrmsAttendanceWindowMinutesForStore：洪潮久光 9:15–21:00；默认 9:00–22:00', () => {
  const hong = hrmsAttendanceWindowMinutesForStore('洪潮大宁久光店');
  assert.equal(hong.startMinutes, 9 * 60 + 15);
  assert.equal(hong.endMinutes, 21 * 60);

  const alias = hrmsAttendanceWindowMinutesForStore('洪潮久光店');
  assert.equal(alias.startMinutes, 9 * 60 + 15);
  assert.equal(alias.endMinutes, 21 * 60);

  const def = hrmsAttendanceWindowMinutesForStore('马己仙上海音乐广场店');
  assert.equal(def.startMinutes, 9 * 60);
  assert.equal(def.endMinutes, 22 * 60);

  const empty = hrmsAttendanceWindowMinutesForStore('');
  assert.equal(empty.startMinutes, 9 * 60);
  assert.equal(empty.endMinutes, 22 * 60);
});
