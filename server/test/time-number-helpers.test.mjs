import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeNumber,
  toNullableUuid,
  hrmsNowISO,
  inDateRange,
  parseMonth,
  clampNum,
  normalizeStoreKey,
  safeDateOnly,
  safeMonthOnly,
} from '../domains/shared/time-number.js';

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

test('inDateRange: empty date false; open start/end; bounds inclusive', () => {
  assert.equal(inDateRange('', '2024-01-01', '2024-12-31'), false);
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

test('parseMonth / safeMonthOnly: valid YYYY-MM; invalid null; empty safeMonthOnly null', () => {
  assert.equal(parseMonth('2024-06'), '2024-06');
  assert.equal(parseMonth(' 2024-06 '), '2024-06');
  assert.equal(parseMonth('2024-6'), null);
  assert.equal(parseMonth('2024-06-01'), null);
  assert.equal(parseMonth(''), null);
  assert.equal(parseMonth(null), null);

  assert.equal(safeMonthOnly('2024-06'), '2024-06');
  assert.equal(safeMonthOnly(' 2024-06 '), '2024-06');
  assert.equal(safeMonthOnly('2024-6'), null);
  assert.equal(safeMonthOnly('2024-06-01'), null);
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
  assert.equal(safeDateOnly(''), null);
  assert.equal(safeDateOnly(null), null);
  assert.equal(safeDateOnly(undefined), null);
});
