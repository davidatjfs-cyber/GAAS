/**
 * domains/growth-pos/keruyun.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKeruyunDateTime,
  cnDate,
  parseKeruyunPhone,
  parseNum,
} from '../keruyun.js';

test('parseKeruyunDateTime：空/毫秒戳/中文日期/非法', () => {
  assert.equal(parseKeruyunDateTime(null), null);
  assert.equal(parseKeruyunDateTime(''), null);
  const ms = Date.UTC(2026, 6, 1, 4, 0, 0);
  assert.equal(parseKeruyunDateTime(ms), new Date(ms).toISOString());
  assert.ok(parseKeruyunDateTime('2026年7月1日 12：30'));
  assert.ok(parseKeruyunDateTime('2026-07-01'));
  assert.equal(parseKeruyunDateTime('not-a-date'), null);
});

test('cnDate：毫秒戳/解析回退/字符串清洗', () => {
  assert.equal(cnDate(null), null);
  const ms = Date.UTC(2026, 6, 1, 4, 0, 0); // +8h → 2026-07-01
  assert.equal(cnDate(ms), '2026-07-01');
  assert.equal(cnDate('2026年07月02日'), '2026-07-02');
  assert.equal(cnDate('2026/7/3'), '2026-07-03');
  assert.equal(cnDate('plain-text'), 'plain-text'); // 解析失败走字符串清洗回退
});
test('parseKeruyunPhone / parseNum', () => {
  assert.equal(parseKeruyunPhone(null), '');
  assert.equal(parseKeruyunPhone('-'), '');
  assert.equal(parseKeruyunPhone('+86 138-0000-0000'), '+8613800000000');
  assert.equal(parseNum('¥1,234.5'), 1234.5);
  assert.equal(parseNum('坏'), 0);
  assert.equal(parseNum(null), 0);
});
