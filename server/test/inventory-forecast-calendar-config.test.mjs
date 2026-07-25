/**
 * domains/inventory-forecast/calendar-config.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_FORECAST_CONFIG,
  createGetStoreForecastConfig,
  isCNYPeriod,
  isKnownPublicHoliday,
  isNormalWorkday,
} from '../domains/inventory-forecast/calendar-config.js';

test('isCNYPeriod：空/非法/窗外 → false；2026 窗口与通年 Jan25–Feb', () => {
  assert.equal(isCNYPeriod(''), false);
  assert.equal(isCNYPeriod(null), false);
  assert.equal(isCNYPeriod('not-a-date'), false);
  assert.equal(isCNYPeriod('2026-01-24'), false);
  assert.equal(isCNYPeriod('2026-01-25'), true);
  assert.equal(isCNYPeriod('2026-02-15'), true);
  assert.equal(isCNYPeriod('2026-03-01'), false);
  assert.equal(isCNYPeriod('2025-01-26'), true);
  assert.equal(isCNYPeriod('2025-02-01'), true);
  assert.equal(isCNYPeriod('2025-03-01'), false);
});

test('isKnownPublicHoliday：集合命中', () => {
  assert.equal(isKnownPublicHoliday('2026-05-01'), true);
  assert.equal(isKnownPublicHoliday(' 2026-10-01 '), true);
  assert.equal(isKnownPublicHoliday('2026-04-01'), false);
  assert.equal(isKnownPublicHoliday(''), false);
});

test('isNormalWorkday：节假日/CNY/周末/非法 → false；工作日 true', () => {
  assert.equal(isNormalWorkday('2026-07-22', true), false);
  assert.equal(isNormalWorkday('2026-01-26', false), false); // CNY
  assert.equal(isNormalWorkday('2026-05-01', false), false); // public holiday
  assert.equal(isNormalWorkday('2026-07-25', false), false); // Saturday
  assert.equal(isNormalWorkday('2026-07-26', false), false); // Sunday
  assert.equal(isNormalWorkday('bad', false), false);
  assert.equal(isNormalWorkday('2026-07-22', false), true); // Wed
});

test('getStoreForecastConfig：DB 优先 → 精确名 → 部分匹配 → _default', () => {
  const get = createGetStoreForecastConfig({
    resolveTenantIdDefault: () => 't1',
    getBrandForStoreSync: (s) => (s === 'DB店' ? { brandKey: 'bk' } : null),
    getBrandConfigSync: (bk) => (bk === 'bk' ? { forecast: { rainFactor: 0.5 } } : null),
  });
  assert.deepEqual(get('DB店'), { rainFactor: 0.5 });
  assert.deepEqual(get('洪潮久光店'), STORE_FORECAST_CONFIG['洪潮久光店']);
  assert.equal(get('某某洪潮久光店分店').rainFactor, STORE_FORECAST_CONFIG['洪潮久光店'].rainFactor);
  assert.deepEqual(get('完全未知店'), STORE_FORECAST_CONFIG._default);
  // 空串会命中 partial（k.includes('')），落到表内第一项而非 _default
  assert.deepEqual(get(''), STORE_FORECAST_CONFIG['洪潮大宁久光店']);
});