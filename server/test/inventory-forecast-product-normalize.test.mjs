/**
 * domains/inventory-forecast/product-normalize.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProductName,
  resolveForecastProductName,
  forecastDayTypeLabel,
  normalizeForecastWeatherTag,
  createProductAliasHelpers,
} from '../domains/inventory-forecast/product-normalize.js';

test('normalizeProductName：空/去括号/繁简/阿拉伯数字', () => {
  assert.equal(normalizeProductName(''), '');
  assert.equal(normalizeProductName('9秒生炒魚片【地道鲜嫩】'), '九秒生炒鱼片');
  assert.equal(normalizeProductName('  炒  饭  '), '炒饭');
});

test('resolveForecastProductName：alias hit / miss / 空', () => {
  assert.deepEqual(resolveForecastProductName('', null), { key: '', display: '' });
  const lookup = new Map([['九秒生炒鱼片', { canonical: '九秒生炒鱼片标准', canonicalNorm: '九秒生炒鱼片标准' }]]);
  const hit = resolveForecastProductName('9秒生炒魚片', lookup);
  assert.equal(hit.key, '九秒生炒鱼片标准');
  assert.equal(hit.display, '九秒生炒鱼片标准');
  const miss = resolveForecastProductName('普通菜', lookup);
  assert.equal(miss.key, '普通菜');
  assert.equal(miss.display, '普通菜');
});

test('forecastDayTypeLabel / normalizeForecastWeatherTag', () => {
  assert.equal(forecastDayTypeLabel('2026-07-22', true), 'holiday');
  assert.equal(forecastDayTypeLabel('2026-07-25', false), 'holiday'); // Sat
  assert.equal(forecastDayTypeLabel('2026-07-22', false), 'workday'); // Wed
  assert.equal(normalizeForecastWeatherTag(''), '');
  assert.equal(normalizeForecastWeatherTag('阵雨转多云'), 'rain');
  assert.equal(normalizeForecastWeatherTag('小雪'), 'snow');
  assert.equal(normalizeForecastWeatherTag('雾霾'), 'fog');
  assert.equal(normalizeForecastWeatherTag('大风'), 'wind');
  assert.equal(normalizeForecastWeatherTag('多云'), 'cloudy');
  assert.equal(normalizeForecastWeatherTag('晴'), 'sunny');
  assert.equal(normalizeForecastWeatherTag('UNKNOWN'), 'unknown');
});

test('createProductAliasHelpers：lookup 过滤与数量合并', () => {
  const helpers = createProductAliasHelpers({
    normalizeBrandId: (id) => String(id || '').trim().toLowerCase(),
    resolveStoreBrandContext: (_s, store) => ({
      brandId: store === 'A店' ? 'brand-a' : 'brand-b',
    }),
    isExcludedForecastProduct: (name) => name === '排除品',
  });
  const state = {
    forecastProductAliasRules: [
      {
        brandId: 'brand-a',
        canonical: '九秒生炒鱼片',
        aliases: ['9秒生炒魚片'],
      },
      {
        store: 'B店',
        canonical: '店内别名菜',
        aliases: [],
      },
    ],
  };
  const byBrand = helpers.buildForecastProductAliasLookup(state, { brandId: 'Brand-A' });
  assert.ok(byBrand.has('九秒生炒鱼片'));
  const byStore = helpers.buildForecastProductAliasLookup(state, 'B店');
  assert.ok(byStore.has('店内别名菜'));

  const qty = helpers.canonicalizeForecastProductQuantities(
    { '9秒生炒魚片': 2, '排除品': 9, '普通菜': 1.5, '坏': 0 },
    byBrand
  );
  assert.equal(qty['九秒生炒鱼片'], 2);
  assert.equal(qty['普通菜'], 1.5);
  assert.equal(qty['排除品'], undefined);

  const rows = helpers.canonicalizeForecastRows(
    [{ date: 'd', productQuantities: { '9秒生炒魚片': 1 } }],
    byBrand
  );
  assert.equal(rows[0].productQuantities['九秒生炒鱼片'], 1);
});
