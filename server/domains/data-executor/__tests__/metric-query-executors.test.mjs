import test from 'node:test';
import assert from 'node:assert/strict';

import { createMetricQueryExecutors } from '../metric-query-executors.js';
import { executeMetrics, setDataExecutorPool } from '../../../data-executor.js';

function createQueryStub(values = []) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ val: values.shift() ?? 0 }] };
  };
  return { query, calls };
}

test('metric query executors run supported Feishu formulas with scoped parameters', async () => {
  const stub = createQueryStub([4, '12.5', '75.5', 9]);
  const { queryFeishuGenericRecords } = createMetricQueryExecutors(stub);

  assert.equal(
    await queryFeishuGenericRecords({ formula: "COUNT(*) table_id = 'tblA'" }, '2026-07-01', '2026-07-07', ' 一店 '),
    4
  );
  assert.equal(
    await queryFeishuGenericRecords({ formula: "AVG(fields->>'评分') table_id IN ('tblA', 'tblB')" }, '2026-07-01', '2026-07-07'),
    12.5
  );
  assert.equal(
    await queryFeishuGenericRecords({ formula: "COUNT(CASE WHEN fields->>'状态'='合格' END) table_id = 'tblA'" }, '2026-07-01', '2026-07-07'),
    75.5
  );
  assert.equal(
    await queryFeishuGenericRecords({ formula: "SUM(COALESCE(fields->>'就餐人数', '0')) table_id = 'tblA'" }, '2026-07-01', '2026-07-07'),
    9
  );

  assert.match(stub.calls[0].sql, /COUNT\(\*\)::int AS val/);
  assert.match(stub.calls[0].sql, /LIKE \$4/);
  assert.deepEqual(stub.calls[0].params, ['tblA', '2026-07-01', '2026-07-07', '%一店%']);
  assert.match(stub.calls[1].sql, /AVG\(NULLIF/);
  assert.deepEqual(stub.calls[1].params, ['tblA', 'tblB', '2026-07-01', '2026-07-07']);
  assert.match(stub.calls[2].sql, /COUNT\(CASE WHEN/);
  assert.match(stub.calls[3].sql, /regexp_replace\(fields->>'就餐人数'/);
});

test('metric query executors reject unsupported Feishu formulas without querying', async () => {
  const stub = createQueryStub();
  const { queryFeishuGenericRecords } = createMetricQueryExecutors(stub);

  assert.equal(await queryFeishuGenericRecords({ formula: 'SUM(amount)' }, '2026-07-01', '2026-07-07'), null);
  assert.equal(await queryFeishuGenericRecords({ formula: 'COUNT(*)' }, '2026-07-01', '2026-07-07'), null);
  assert.equal(stub.calls.length, 0);
});

test('metric query executors map POS aliases and support sales formulas', async () => {
  const stub = createQueryStub(['23.4', '100']);
  const { querySalesRaw } = createMetricQueryExecutors(stub);

  assert.equal(
    await querySalesRaw({ formula: 'SUM(expected_revenue - actual_revenue)' }, '2026-07-01', '2026-07-07', '一 店'),
    23.4
  );
  assert.equal(
    await querySalesRaw({ formula: 'SUM(gross_revenue)' }, '2026-07-01', '2026-07-07'),
    100
  );
  assert.equal(await querySalesRaw({ formula: 'AVG(revenue)' }, '2026-07-01', '2026-07-07'), null);

  assert.match(stub.calls[0].sql, /SUM\(sales_amount - revenue\)/);
  assert.deepEqual(stub.calls[0].params, ['2026-07-01', '2026-07-07', '%一店%']);
  assert.match(stub.calls[1].sql, /SUM\(sales_amount\)/);
});

test('metric query executors run daily report and schedule queries', async () => {
  const stub = createQueryStub(['88.25', 6]);
  const { queryDailyReports, querySchedules } = createMetricQueryExecutors(stub);

  assert.equal(
    await queryDailyReports({ formula: 'avg(actual_margin)' }, '2026-07-01', '2026-07-07', '一 店'),
    88.25
  );
  assert.equal(await queryDailyReports({ formula: 'COUNT(*)' }, '2026-07-01', '2026-07-07'), null);
  assert.equal(await querySchedules({}, '2026-07-01', '2026-07-07'), 6);

  assert.match(stub.calls[0].sql, /AVG\(actual_margin\)/);
  assert.deepEqual(stub.calls[0].params, ['2026-07-01', '2026-07-07', '%一店%']);
  assert.match(stub.calls[1].sql, /COUNT\(DISTINCT employee_username\)/);
});

test('data-executor facade delegates POS metrics to extracted query executors', async () => {
  const calls = [];
  setDataExecutorPool({
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM metric_dictionary')) {
        return {
          rows: [{
            metric_id: 'test_extracted_sales_metric',
            name: '提取回归指标',
            data_source: 'sales_raw',
            formula: 'SUM(expected_revenue)',
            version: 1,
          }],
        };
      }
      if (sql.includes('FROM pos_sales_detail')) return { rows: [{ val: '321.5' }] };
      return { rows: [] };
    },
  });

  const result = await executeMetrics(
    ['test_extracted_sales_metric'],
    '2026-07-01~2026-07-07',
    '一 店',
    'extracted-query-executors-test'
  );

  assert.equal(result.results[0].value, 321.5);
  const posQuery = calls.find(({ sql }) => sql.includes('FROM pos_sales_detail'));
  assert.ok(posQuery);
  assert.match(posQuery.sql, /SUM\(sales_amount\)/);
  assert.deepEqual(posQuery.params, ['2026-07-01', '2026-07-07', '%一店%']);
});
