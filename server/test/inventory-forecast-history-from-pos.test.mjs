/**
 * domains/inventory-forecast/history-from-pos.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryFromPosHelpers } from '../domains/inventory-forecast/history-from-pos.js';

function make(overrides = {}) {
  return createHistoryFromPosHelpers({
    pool: {
      query: async () => ({ rows: [] }),
    },
    resolveTenantIdDefault: () => 'default',
    normalizeStoreKey: (s) => String(s || '').replace(/\s+/g, ''),
    safeDateOnly: (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : ''),
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
    normalizeForecastBizType: (v) => {
      const s = String(v || '').trim();
      if (/外卖|takeaway|delivery/i.test(s)) return 'takeaway';
      if (/堂食|dinein/i.test(s)) return 'dinein';
      return s;
    },
    normalizeForecastSlot: (v) => String(v || '').trim() || '午',
    isKnownPublicHoliday: () => false,
    isCNYPeriod: () => false,
    sortForecastHistoryRows: (rows) => rows,
    ...overrides,
  });
}

test('longestCommonRun / stripStoreGenericWords', () => {
  const { longestCommonRun, stripStoreGenericWords } = make();
  assert.equal(longestCommonRun('', 'a'), 0);
  assert.equal(longestCommonRun('久光店', '大宁久光中心店'), 2);
  assert.ok(stripStoreGenericWords('洪潮传统潮汕菜大宁久光店').includes('洪潮'));
  assert.ok(!stripStoreGenericWords('洪潮传统潮汕菜店').includes('传统潮汕菜'));
});

test('resolvePosStoreKeys：空 / 精确 / 品牌唯一 / 子串兜底', async () => {
  const helpers = make({
    pool: {
      query: async () => ({
        rows: [
          { store: '洪潮传统潮汕菜【大宁久光中心店】' },
          { store: '马己仙广东小馆上海音乐广场店' },
        ],
      }),
    },
  });
  assert.deepEqual(await helpers.resolvePosStoreKeys([]), []);
  const keys = await helpers.resolvePosStoreKeys(['洪潮大宁久光店', '未知店']);
  assert.ok(keys.length >= 1);
  assert.ok(keys.some((k) => /洪潮|久光/.test(k)));
});

test('loadInventoryForecastHistoryFromSalesRaw：聚合 POS 行', async () => {
  const helpers = make({
    pool: {
      query: async (sql) => {
        if (/DISTINCT store/.test(sql)) {
          return { rows: [{ store: '洪潮大宁久光店' }] };
        }
        return {
          rows: [
            {
              store: '洪潮大宁久光店',
              date: '2026-07-01',
              biz_type: '堂食',
              slot: '午',
              dish_name: '菜A',
              qty: 2,
              sales_amount: 100,
              revenue: 90,
              discount: 10,
            },
            {
              store: '洪潮大宁久光店',
              date: '2026-07-01',
              biz_type: '堂食',
              slot: '午',
              dish_name: '菜A',
              qty: 1,
              sales_amount: 50,
              revenue: 45,
              discount: 5,
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(
    await helpers.loadInventoryForecastHistoryFromSalesRaw({ storeScope: [] }),
    []
  );
  const rows = await helpers.loadInventoryForecastHistoryFromSalesRaw({
    storeScope: ['洪潮大宁久光店'],
    bizType: 'dinein',
    slot: '午',
    startDate: '2026-07-01',
    endDate: '2026-07-02',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productQuantities['菜A'], 3);
  assert.equal(rows[0].actualRevenue, 135);
  assert.equal(rows[0].source, 'pos_sales_detail');
});
