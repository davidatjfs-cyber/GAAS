import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeNumber,
  toNullableUuid,
  safeUuid,
  hrmsNowISO,
  inDateRange,
  parseMonth,
  clampNum,
  normalizeStoreKey,
  safeDateOnly,
  safeMonthOnly,
} from '../time-number.js';
import { shanghaiDateOnly, shanghaiTodayDateOnly } from '../../leave-attendance/attendance-build.js';

test('safeNumber: finite / NaN / empty → null', () => {
  assert.equal(safeNumber(42), 42);
  assert.equal(safeNumber('3.5'), 3.5);
  assert.equal(safeNumber(0), 0);
  assert.equal(safeNumber(''), 0); // Number('') === 0
  assert.equal(safeNumber(null), 0); // Number(null) === 0
  assert.equal(safeNumber(NaN), null);
  assert.equal(safeNumber(undefined), null);
  assert.equal(safeNumber('abc'), null);
  assert.equal(safeNumber(Infinity), null);
});

test('toNullableUuid: empty → null; trim non-empty', () => {
  assert.equal(toNullableUuid(''), null);
  assert.equal(toNullableUuid(null), null);
  assert.equal(toNullableUuid(undefined), null);
  assert.equal(toNullableUuid('   '), null);
  assert.equal(toNullableUuid('  abc-123  '), 'abc-123');
  assert.equal(toNullableUuid('uuid-value'), 'uuid-value');
});

test('hrmsNowISO: Shanghai wall-clock +08:00', () => {
  const v = hrmsNowISO();
  assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
});

test('hrmsNowISO: 24-hour Shanghai hour matches Intl hour12:false', () => {
  const v = hrmsNowISO();
  const hour = Number(v.slice(11, 13));
  assert.ok(hour >= 0 && hour <= 23);
  const refHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  assert.equal(hour, refHour);
});

test('inDateRange: empty date false; open start/end; bounds inclusive', () => {
  assert.equal(inDateRange('', '2024-01-01', '2024-12-31'), false);
  assert.equal(inDateRange('', '', ''), false);
  assert.equal(inDateRange(null, '2024-01-01', '2024-12-31'), false);
  assert.equal(inDateRange('2024-06-15', '', ''), true);
  assert.equal(inDateRange('2024-06-15', null, null), true);
  assert.equal(inDateRange('2024-06-15', '2024-01-01', ''), true);
  assert.equal(inDateRange('2024-06-15', '', '2024-12-31'), true);
  assert.equal(inDateRange('2024-01-01', '2024-01-01', '2024-12-31'), true);
  assert.equal(inDateRange('2024-12-31', '2024-01-01', '2024-12-31'), true);
  assert.equal(inDateRange('2023-12-31', '2024-01-01', '2024-12-31'), false);
  assert.equal(inDateRange('2025-01-01', '2024-01-01', '2024-12-31'), false);
});

test('inDateRange: trims whitespace on date and bounds', () => {
  assert.equal(inDateRange(' 2024-06-15 ', '2024-01-01', '2024-12-31'), true);
  assert.equal(inDateRange('2024-06-15', ' 2024-06-15 ', '2024-12-31'), true);
  assert.equal(inDateRange('2024-06-15', '2024-01-01', ' 2024-12-31 '), true);
});

test('parseMonth / safeMonthOnly: valid YYYY-MM; invalid null; empty safeMonthOnly null', () => {
  assert.equal(parseMonth('2024-06'), '2024-06');
  assert.equal(parseMonth(' 2024-06 '), '2024-06');
  assert.equal(parseMonth('2024-6'), null);
  assert.equal(parseMonth('2024-06-01'), null);
  assert.equal(parseMonth('xx2024-06'), null);
  assert.equal(parseMonth('2024-06-extra'), null);
  assert.equal(parseMonth(''), null);
  assert.equal(parseMonth(null), null);

  assert.equal(safeMonthOnly('2024-06'), '2024-06');
  assert.equal(safeMonthOnly(' 2024-06 '), '2024-06');
  assert.equal(safeMonthOnly('2024-6'), null);
  assert.equal(safeMonthOnly('2024-06-01'), null);
  assert.equal(safeMonthOnly('xx2024-06'), null);
  assert.equal(safeMonthOnly(''), null);
  assert.equal(safeMonthOnly(null), null);
  assert.equal(safeMonthOnly(undefined), null);
});

test('clampNum: default 0; custom default; non-finite → default', () => {
  assert.equal(clampNum(5), 5);
  assert.equal(clampNum('12.5'), 12.5);
  assert.equal(clampNum(NaN), 0);
  assert.equal(clampNum(''), 0);
  assert.equal(clampNum(null), 0);
  assert.equal(clampNum(Infinity), 0);
  assert.equal(clampNum(NaN, 99), 99);
  assert.equal(clampNum('x', -1), -1);
  assert.equal(clampNum(7, 99), 7);
});

test('normalizeStoreKey: lower + strip spaces', () => {
  assert.equal(normalizeStoreKey('  Hong Chao  '), 'hongchao');
  assert.equal(normalizeStoreKey('MaJiXian'), 'majixian');
  assert.equal(normalizeStoreKey(''), '');
  assert.equal(normalizeStoreKey(null), '');
});

test('safeDateOnly: valid / invalid / empty', () => {
  assert.equal(safeDateOnly('2024-06-15'), '2024-06-15');
  assert.equal(safeDateOnly(' 2024-06-15 '), '2024-06-15');
  assert.equal(safeDateOnly('2024-6-15'), null);
  assert.equal(safeDateOnly('2024-06'), null);
  assert.equal(safeDateOnly('x2024-06-15'), null);
  assert.equal(safeDateOnly('2024-06-15x'), null);
  assert.equal(safeDateOnly('2024-06-150'), null);
  assert.equal(safeDateOnly(''), null);
  assert.equal(safeDateOnly(null), null);
  assert.equal(safeDateOnly(undefined), null);
});

test('safeUuid: accepts uuid shape; invalid → empty string', () => {
  assert.equal(safeUuid(''), '');
  assert.equal(safeUuid('not-a-uuid'), '');
  assert.equal(safeUuid('  '), '');
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(safeUuid(id), id);
  assert.equal(safeUuid(` ${id} `), id);
  assert.equal(safeUuid(`prefix${id}`), '');
  assert.equal(safeUuid(`${id}suffix`), '');
  assert.equal(safeUuid(`${id}-extra`), '');
});

test('shanghaiTodayDateOnly matches shanghaiDateOnly(now)', () => {
  const a = shanghaiTodayDateOnly();
  const b = shanghaiDateOnly(new Date());
  assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(a, b);
});
