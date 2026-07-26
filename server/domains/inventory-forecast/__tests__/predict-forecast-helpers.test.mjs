import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictForecastInput } from '../predict-forecast-helpers.js';

const ctx = {
  canAccessAnalyticsReports: (role) => role === 'admin',
  normalizeForecastBizType: (v) => String(v || '').trim() || null,
  normalizeForecastSlot: (v) => String(v || '').trim() || null,
  safeDateOnly: (v) => String(v || '').slice(0, 10) || null,
  normalizeForecastWeather: (v) => String(v || '').trim(),
  safeNumber: (v) => Number(v),
};

test('parsePredictForecastInput: missing_user', () => {
  const out = parsePredictForecastInput({ username: '', role: 'admin', body: {} }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'missing_user');
});

test('parsePredictForecastInput: forbidden role', () => {
  const out = parsePredictForecastInput({ username: 'u1', role: 'store_employee', body: {} }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test('parsePredictForecastInput: invalid_expected_revenue', () => {
  const out = parsePredictForecastInput({
    username: 'u1',
    role: 'admin',
    body: { bizType: 'dine', slot: 'lunch', date: '2026-07-24', expectedRevenue: -1 },
  }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'invalid_expected_revenue');
});

test('parsePredictForecastInput: valid payload', () => {
  const out = parsePredictForecastInput({
    username: 'u1',
    role: 'admin',
    body: {
      bizType: 'dine',
      slot: 'lunch',
      date: '2026-07-24',
      expectedRevenue: 10000,
      topN: 15,
      store: '洪潮店',
    },
  }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.bizType, 'dine');
  assert.equal(out.topN, 15);
  assert.equal(out.qStore, '洪潮店');
});
