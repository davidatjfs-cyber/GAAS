import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTableVisitDishes,
  tableVisitReasonImpliesDissatisfactionHrms,
  tableVisitRowIsDissatisfied,
  extractTableVisitSatisfactionFromFields,
} from '../table-visit-metrics-pure.js';
import { createTableVisitMetricsApi } from '../table-visit-metrics.js';

test('pure: dishes / reason / dissatisfied', () => {
  assert.deepEqual(extractTableVisitDishes({ dissatisfaction_dish: '鱼香肉丝、无' }), ['鱼香肉丝']);
  assert.equal(tableVisitReasonImpliesDissatisfactionHrms('太冷了'), true);
  assert.equal(tableVisitReasonImpliesDissatisfactionHrms('很满意'), false);
  assert.equal(
    tableVisitRowIsDissatisfied({
      satisfaction_level: '不满意',
      dissatisfaction_dish: '牛肉',
      unsatisfied_items: '偏咸',
    }),
    true
  );
  assert.equal(
    tableVisitRowIsDissatisfied({
      satisfaction_level: '满意',
      dissatisfaction_dish: '牛肉',
      unsatisfied_items: '偏咸',
    }),
    false
  );
  assert.equal(
    extractTableVisitSatisfactionFromFields({ 用餐满意度: '一般' }, (v) => String(v || '')),
    '一般'
  );
});

test('loadUnified prefers structured rows then falls back to bitable cache', async () => {
  const sqls = [];
  const api = createTableVisitMetricsApi({
    pool: () => ({
      query: async (sql, params) => {
        sqls.push(sql);
        if (/table_visit_records/i.test(sql) && /ILIKE ANY/i.test(sql)) {
          return {
            rows: [
              {
                date: '2026-07-01',
                store: '洪潮店',
                dissatisfaction_dish: '牛肉',
                unsatisfied_items: '偏咸',
                satisfaction_level: '不满意',
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
    bitableConfigs: { table_visit: { tableId: 'tbl_tv' } },
    normalizeBitableDateValue: () => '2026-07-01',
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    extractBitableFieldText: (v) => String(v || ''),
    inDateRangeInclusive: () => true,
    normalizeStoreKey: (s) => String(s || '').replace(/\s+/g, '').toLowerCase(),
    normProductKey: (s) => String(s || '').trim().toLowerCase(),
  });

  const rows = await api.loadUnifiedTableVisitRowsByStore('洪潮店', '2026-07-01', '2026-07-07');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dissatisfaction_dish, '牛肉');

  const metrics = await api.loadTableVisitMetricsByStore('洪潮店', '2026-07-01', '2026-07-07');
  assert.equal(metrics.countByDate.get('2026-07-01'), 1);
  assert.ok([...metrics.dissatisfiedProducts.values()].some((n) => n >= 1));
});

test('loadUnified falls back when structured empty', async () => {
  const api = createTableVisitMetricsApi({
    pool: () => ({
      query: async (sql) => {
        if (/table_visit_records/i.test(sql)) return { rows: [] };
        if (/feishu_generic_records/i.test(sql)) {
          return {
            rows: [
              {
                record_id: 'r1',
                created_at: '2026-07-02',
                fields: {
                  所属门店: '洪潮店',
                  记录日期: '2026-07-02',
                  今天催菜内容: '',
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
    bitableConfigs: { table_visit: { tableId: 'tbl_tv' } },
    normalizeBitableDateValue: () => '2026-07-02',
    extractDissatisfactionDishFromFields: () => '虾',
    extractDissatisfactionReasonFromFields: () => '不新鲜',
    extractBitableFieldText: (v) => String(v || ''),
    inDateRangeInclusive: () => true,
    normalizeStoreKey: (s) => s,
    normProductKey: (s) => s,
  });
  const rows = await api.loadUnifiedTableVisitRowsByStore('洪潮店', '2026-07-01', '2026-07-07');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dissatisfaction_dish, '虾');
});

test('empty store short-circuits', async () => {
  const api = createTableVisitMetricsApi({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    bitableConfigs: {},
    normalizeBitableDateValue: () => '',
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    extractBitableFieldText: () => '',
    inDateRangeInclusive: () => true,
    normalizeStoreKey: (s) => s,
    normProductKey: (s) => s,
  });
  assert.deepEqual(await api.loadUnifiedTableVisitRowsByStore('  ', 'a', 'b'), []);
});

test('structured query falls back when satisfaction_level column missing', async () => {
  let n = 0;
  const api = createTableVisitMetricsApi({
    pool: () => ({
      query: async (sql) => {
        n += 1;
        if (n === 1 && /satisfaction_level/i.test(sql)) {
          throw new Error('column missing');
        }
        if (/table_visit_records/i.test(sql)) {
          return {
            rows: [
              {
                date: '2026-07-03',
                store: '洪潮店',
                dissatisfaction_dish: '',
                unsatisfied_items: '',
                satisfaction_level: '',
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
    bitableConfigs: { table_visit: { tableId: 'tbl' } },
    normalizeBitableDateValue: () => '2026-07-03',
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    extractBitableFieldText: () => '',
    inDateRangeInclusive: () => true,
    normalizeStoreKey: (s) => 'hongchao',
    normProductKey: (s) => s,
  });
  const rows = await api.loadUnifiedTableVisitRowsByStore('洪潮店', '2026-07-01', '2026-07-07');
  assert.equal(rows.length, 1);
  assert.ok(n >= 2);
});

test('loadTableVisitMetrics tolerates loader failures', async () => {
  const api = createTableVisitMetricsApi({
    pool: () => ({
      query: async () => {
        throw new Error('db down');
      },
    }),
    bitableConfigs: { table_visit: { tableId: 'tbl' } },
    normalizeBitableDateValue: () => '',
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    extractBitableFieldText: () => '',
    inDateRangeInclusive: () => true,
    normalizeStoreKey: (s) => s,
    normProductKey: (s) => s,
  });
  const m = await api.loadTableVisitMetricsByStore('洪潮店', 'a', 'b');
  assert.equal(m.countByDate.size, 0);
});
