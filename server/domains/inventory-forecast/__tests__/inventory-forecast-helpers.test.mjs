import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createInventoryForecastHelpers } from '../create-helpers.js';

function safeDateOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (iso) return iso[1];
  return null;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function inDateRange(d, s, e) {
  const x = String(d || '').trim();
  if (!x) return false;
  if (s && x < String(s).trim()) return false;
  if (e && x > String(e).trim()) return false;
  return true;
}

function normalizeStoreKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

const helpers = createInventoryForecastHelpers({
  safeDateOnly,
  safeNumber,
  inDateRange,
  normalizeBrandId: (x) => String(x || '').trim().toLowerCase(),
  resolveStoreBrandContext: () => ({ storeName: '', brandId: '', brandName: '' }),
  resolveTenantIdDefault: () => 'default',
  getBrandForStoreSync: () => null,
  getBrandConfigSync: () => null,
  pickMyStoreFromState: () => '',
  getBrandsFromState: () => [],
  getStoreNamesByBrand: () => [],
  pool: { query: async () => ({ rows: [{ store: '洪潮传统潮汕菜【大宁久光中心店】' }] }) },
  hrmsNowISO: () => '2026-07-24T00:00:00.000Z',
  randomUUID,
  normalizeStoreKey,
});

test('normalizeProductName strips 【】 and maps 魚→鱼, 9→九', () => {
  assert.equal(
    helpers.normalizeProductName('9秒生炒魚片【地道鲜嫩廣府味】'),
    '九秒生炒鱼片'
  );
});

test('isExcludedForecastProduct: 打包盒 is excluded', () => {
  assert.equal(helpers.isExcludedForecastProduct('打包盒'), true);
  assert.equal(helpers.isExcludedForecastProduct('招牌牛肉'), false);
});

test('normalizeForecastBizType / Slot', () => {
  assert.equal(helpers.normalizeForecastBizType('外卖'), 'takeaway');
  assert.equal(helpers.normalizeForecastBizType('堂食'), 'dinein');
  assert.equal(helpers.normalizeForecastBizType(''), '');
  assert.equal(helpers.normalizeForecastSlot('午市'), 'lunch');
  assert.equal(helpers.normalizeForecastSlot('下午茶'), 'afternoon');
  assert.equal(helpers.normalizeForecastSlot('晚市'), 'dinner');
});

test('inferForecastUploadDateFromFilename with fixed Date', () => {
  const fixed = new Date('2026-07-24T12:00:00Z');
  assert.equal(helpers.inferForecastUploadDateFromFilename('2-16.xlsx', fixed), '2026-02-16');
  assert.equal(helpers.inferForecastUploadDateFromFilename('2026-03-05-report.xlsx', fixed), '2026-03-05');
});

test('parseInventoryForecastRowsFromTableMatrix tiny header+row', () => {
  const matrix = [
    ['营业日期', '销售类型', '餐时段名称', '菜品名称', '销售数量', '销售金额'],
    ['2026-07-01', '堂食', '午市', '测试菜', 2, 100],
  ];
  const rows = helpers.parseInventoryForecastRowsFromTableMatrix(matrix);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bizType, 'dinein');
  assert.equal(rows[0].slot, 'lunch');
  assert.equal(rows[0].date, '2026-07-01');
  assert.equal(rows[0].productQuantities['测试菜'], 2);
  assert.equal(rows[0].expectedRevenue, 100);
});

test('buildForecastByHeuristic returns predictions from simple history', () => {
  const history = [
    {
      date: '2026-07-01',
      weather: '晴',
      isHoliday: false,
      expectedRevenue: 1000,
      productQuantities: { 测试菜: 5, 打包盒: 99 },
    },
  ];
  const result = helpers.buildForecastByHeuristic(
    history,
    { date: '2026-07-08', weather: '晴', isHoliday: false, expectedRevenue: 1000 },
    10
  );
  assert.ok(Array.isArray(result.predictions));
  assert.ok(result.predictions.length >= 1);
  assert.equal(result.predictions[0].product, '测试菜');
  assert.ok(Number(result.predictions[0].qty) > 0);
  assert.ok(!result.predictions.some((p) => String(p.product).includes('打包盒')));
});

test('estimateRevenueByHistory returns finite total with mocked brand config deps', () => {
  const history = [
    {
      date: '2026-07-01',
      bizType: 'dinein',
      weather: '晴',
      isHoliday: false,
      expectedRevenue: 8000,
    },
    {
      date: '2026-07-08',
      bizType: 'dinein',
      weather: '晴',
      isHoliday: false,
      expectedRevenue: 8200,
    },
    {
      date: '2026-07-15',
      bizType: 'takeaway',
      weather: '晴',
      isHoliday: false,
      expectedRevenue: 3000,
    },
  ];
  const result = helpers.estimateRevenueByHistory(
    history,
    { date: '2026-07-22', weather: '晴', isHoliday: false },
    '洪潮久光店'
  );
  assert.ok(Number.isFinite(result.totalEstimatedRevenue));
  assert.ok(result.totalEstimatedRevenue >= 0);
  assert.ok(result.sampleCount >= 1);
});

test('shiftForecastDate', () => {
  assert.equal(helpers.shiftForecastDate('2026-07-24', 1), '2026-07-25');
  assert.equal(helpers.shiftForecastDate('2026-07-01', -1), '2026-06-30');
  assert.equal(helpers.shiftForecastDate('', 1), '');
});

test('calcForecastAccuracyMetrics / applyForecastCalibration smoke', () => {
  const metrics = helpers.calcForecastAccuracyMetrics(
    [{ product: '测试菜', qty: 10 }],
    { 测试菜: 8 }
  );
  assert.ok(Number.isFinite(metrics.totalAccuracy));
  assert.ok(Number.isFinite(metrics.mape));
  assert.equal(metrics.productCount, 1);

  const calibrated = helpers.applyForecastCalibration(
    [{ product: '测试菜', qty: 10, reason: '' }],
    { globalFactor: 0.8, byProduct: {} }
  );
  assert.equal(calibrated.length, 1);
  assert.equal(calibrated[0].qty, 8);
});

test('normalizeArkBaseUrl defaults and preserves /api/v3', () => {
  assert.equal(helpers.normalizeArkBaseUrl(''), 'https://ark.cn-beijing.volces.com/api/v3');
  assert.equal(
    helpers.normalizeArkBaseUrl('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    helpers.normalizeArkBaseUrl('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
});

test('resolveTenantAiConfigFromState null for empty; returns config when models present', () => {
  assert.equal(helpers.resolveTenantAiConfigFromState({}), null);
  assert.equal(helpers.resolveTenantAiConfigFromState({ settings: {} }), null);
  const cfg = helpers.resolveTenantAiConfigFromState({
    settings: {
      llm: {
        models: [
          {
            id: 'm1',
            enabled: true,
            apiKey: 'k',
            baseUrl: 'https://ark.cn-beijing.volces.com',
            model: 'ep-test',
          },
        ],
        bindings: { default: 'm1' },
      },
    },
  });
  assert.ok(cfg);
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.model, 'ep-test');
  assert.equal(cfg.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3');
});

test('parseForecastHistoryRow accepts valid row; rejects empty products', () => {
  const ok = helpers.parseForecastHistoryRow({
    date: '2026-07-01',
    weather: '晴',
    expectedRevenue: 100,
    productQuantities: { 测试菜: 2 },
  });
  assert.ok(ok);
  assert.equal(ok.date, '2026-07-01');
  assert.equal(ok.productQuantities['测试菜'], 2);

  assert.equal(
    helpers.parseForecastHistoryRow({
      date: '2026-07-01',
      productQuantities: {},
    }),
    null
  );
});

test('longestCommonRun / stripStoreGenericWords + resolvePosStoreKeys', async () => {
  assert.ok(helpers.longestCommonRun('大宁久光', '大宁久光中心') >= 4);
  assert.equal(helpers.stripStoreGenericWords('洪潮传统潮汕菜大宁久光中心店').includes('传统潮汕菜'), false);

  const keys = await helpers.resolvePosStoreKeys(['洪潮大宁久光店']);
  assert.ok(Array.isArray(keys));
  assert.ok(keys.length >= 1);
  assert.ok(keys.some((k) => k.includes('大宁') || k.includes('久光')));
});

test('upsertInventoryForecastHistoryInState inserts one history row', () => {
  const ret = helpers.upsertInventoryForecastHistoryInState(
    { inventoryForecastHistory: [], inventoryForecastPredictions: [], inventoryForecastEvaluations: [] },
    {
      store: '洪潮久光店',
      bizType: 'dinein',
      slot: 'lunch',
      username: 'tester',
      rowsRaw: [
        {
          date: '2026-07-01',
          weather: '晴',
          expectedRevenue: 100,
          productQuantities: { 测试菜: 2 },
        },
      ],
    }
  );
  assert.equal(ret.inserted, 1);
  assert.equal(ret.accepted, 1);
  assert.equal(ret.state.inventoryForecastHistory.length, 1);
  assert.equal(ret.state.inventoryForecastHistory[0].date, '2026-07-01');
});

test('parseInventoryForecastRowsFromPdfBuffer empty buffer returns []', () => {
  const rows = helpers.parseInventoryForecastRowsFromPdfBuffer(Buffer.from(''), 'dinein');
  assert.deepEqual(rows, []);
});
