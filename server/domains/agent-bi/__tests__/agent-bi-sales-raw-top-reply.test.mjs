import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildBiDeterministicSalesRawTopReply } from '../build-sales-raw-top-reply.js';

function makeBuilder(queryImpl) {
  return createBuildBiDeterministicSalesRawTopReply({
    pool: () => ({
      query: async (sql, params) => queryImpl(sql, params),
    }),
    resolveDateRangeFromQuestion: () => ({
      start: '2026-07-01',
      end: '2026-07-07',
      label: '近7天',
    }),
    normalizeStoreKey: (v) => String(v || '').replace(/\s+/g, '').toLowerCase(),
    normalizeStoreLike: (v) => `%${String(v || '').replace(/\s+/g, '').toLowerCase()}%`,
  });
}

test('empty store / complaint text / non-sales → empty', async () => {
  const build = makeBuilder(async () => ({ rows: [] }));
  assert.equal(await build('', '销量TOP'), '');
  assert.equal(await build('洪潮久光店', '差评最多的菜'), '');
  assert.equal(await build('洪潮久光店', '你好'), '');
});

test('happy path TOP with slot and margin', async () => {
  const build = makeBuilder(async (sql) => {
    if (/GROUP BY s\.dish_name/.test(sql)) {
      return {
        rows: [
          { dish_name: 'A', total_qty: 10, total_sales: 100, total_revenue: 80 },
          { dish_name: 'B', total_qty: 5, total_sales: 50, total_revenue: 45 },
        ],
      };
    }
    if (/GROUP BY s\.slot/.test(sql)) {
      return { rows: [{ slot: '午市', total_revenue: 90, total_qty: 12 }] };
    }
    if (/AVG\(actual_margin\)/.test(sql)) {
      return { rows: [{ avg_margin: 52.3 }] };
    }
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '近7天销量TOP10');
  assert.match(r, /销售TOP10/);
  assert.match(r, /A｜/);
  assert.match(r, /时段分析/);
  assert.match(r, /午市/);
  assert.match(r, /平均毛利率/);
  assert.match(r, /ASC|DESC|pos_sales_detail/);
});

test('worst / takeaway filter and empty rows', async () => {
  let seen = '';
  const build = makeBuilder(async (sql) => {
    seen = sql;
    if (/GROUP BY s\.dish_name/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '外卖卖得最差前5');
  assert.match(r, /暂无可用销售明细/);
  assert.match(seen, /takeaway|外卖/);
  assert.match(seen, /ASC/);
  assert.match(seen, /LIMIT 5/);
});

test('dinein filter + query throw', async () => {
  let dishSql = '';
  const ok = makeBuilder(async (sql) => {
    if (/GROUP BY s\.dish_name/.test(sql)) {
      dishSql = sql;
      return { rows: [{ dish_name: 'C', total_qty: 1, total_sales: 10, total_revenue: 10 }] };
    }
    return { rows: [] };
  });
  const r1 = await ok('洪潮久光店', '堂食热销');
  assert.match(r1, /销售TOP/);
  assert.match(dishSql, /dinein|堂食/);

  const fail = makeBuilder(async () => {
    throw new Error('db down');
  });
  assert.match(await fail('洪潮久光店', '销售排行'), /销售排行查询失败/);
});

test('slot/margin errors ignored', async () => {
  const build = makeBuilder(async (sql) => {
    if (/GROUP BY s\.dish_name/.test(sql)) {
      return { rows: [{ dish_name: 'D', total_qty: 2, total_sales: 20, total_revenue: 18 }] };
    }
    throw new Error('side fail');
  });
  const r = await build('洪潮久光店', '畅销菜品');
  assert.match(r, /D｜/);
  assert.match(r, /数据源：pos_sales_detail/);
});
