import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seasonFromMonth,
  buildWeatherTips,
  assembleActiveWindow,
  CHINA_HOLIDAYS,
} from '../helpers.js';
import {
  getWeatherContext,
  upsertContentPerformance,
  deleteContentPerformance,
  generateSellingPoint,
  _resetWeatherCache,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    cleanText: (v, max = 255) => String(v == null ? '' : v).trim().slice(0, max),
    fmtYmd: (d) => d.toISOString().slice(0, 10),
    buildGrowthDailyReport: async () => 'report',
    getSendGrowthAlert: () => null,
    ...overrides,
  };
}

test('seasonFromMonth / CHINA_HOLIDAYS', () => {
  assert.equal(seasonFromMonth(4), '春季');
  assert.equal(seasonFromMonth(7), '夏季');
  assert.equal(seasonFromMonth(10), '秋季');
  assert.equal(seasonFromMonth(1), '冬季');
  assert.equal(CHINA_HOLIDAYS['2026-10-01'], '国庆节');
});

test('buildWeatherTips: holiday + rain + hot', () => {
  const tips = buildWeatherTips({
    holiday: '国庆节',
    isWeekend: true,
    condition: '小雨',
    temperature: '32°C',
    season: '秋季',
  });
  assert.ok(tips.some((t) => t.includes('国庆节')));
  assert.ok(tips.includes('周末'));
  assert.ok(tips.some((t) => t.includes('雨天')));
  assert.ok(tips.some((t) => t.includes('高温')));
});

test('assembleActiveWindow: churn + VIP dormant recommendations', () => {
  const body = assembleActiveWindow({
    timePatterns: [
      {
        day_type: '周末',
        time_segment: '晚市(17-21点)',
        event_count: 100,
        conversion_count: 20,
      },
    ],
    profileSegments: [
      {
        lifecycle_stage: 'dormant',
        cnt: 10,
        top_window: '晚市',
        avg_price_sens: 0.5,
        avg_discount_resp: 0.6,
      },
    ],
    repurchaseRisk: [{ at_risk_count: 5, store_id: 's1' }],
    valueTierSeg: [
      { value_tier: 'vip', cnt: 20, dormant_cnt: 3 },
      { value_tier: 'regular', cnt: 80, dormant_cnt: 0 },
    ],
  });
  assert.equal(body.ok, true);
  assert.ok(body.predicted_window.includes('晚市'));
  assert.equal(body.churn_rate, 10); // 10 dormant / 100 engaged
  assert.ok(body.recommendations.some((r) => r.includes('VIP')));
  assert.ok(body.recommendations.some((r) => r.includes('流失率')));
});

test('assembleActiveWindow: 数据不足 when no patterns', () => {
  const body = assembleActiveWindow({
    timePatterns: [],
    profileSegments: [],
    repurchaseRisk: [],
    valueTierSeg: [],
  });
  assert.equal(body.predicted_window, '数据不足');
});

test('getWeatherContext: uses injected fetch + cache', async () => {
  _resetWeatherCache();
  let fetchCalls = 0;
  const ctx = baseCtx({
    now: () => new Date('2026-10-01T12:00:00Z'),
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { current: { temperature_2m: 28, weather_code: 61 } };
        },
      };
    },
  });
  const a = await getWeatherContext(ctx, { city: '上海' });
  assert.equal(a.body.ok, true);
  assert.equal(a.body.holiday, '国庆节');
  assert.equal(a.body.temperature, '28°C');
  assert.equal(a.body.condition, '小雨');
  assert.equal(fetchCalls, 1);

  const b = await getWeatherContext(ctx, { city: '上海' });
  assert.equal(b.body.temperature, '28°C');
  assert.equal(fetchCalls, 1, 'second call should hit cache');
  _resetWeatherCache();
});

test('upsertContentPerformance: channel required', async () => {
  const r = await upsertContentPerformance(baseCtx(), { store_id: 's1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'channel required');
});

test('deleteContentPerformance: invalid id', async () => {
  const r = await deleteContentPerformance(baseCtx(), 'abc');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid id');
});

test('generateSellingPoint: fallback when fetch throws', async () => {
  const r = await generateSellingPoint(
    baseCtx({
      fetch: async () => {
        throw new Error('down');
      },
    }),
    { title: 'x' }
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.selling_point, '限时优惠，到店即享');
});
