import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildBiDeterministicBadReviewReportReply } from '../domains/agent-bi/build-bad-review-report-reply.js';

function makeBuilder(overrides = {}) {
  const deps = {
    pool: () => ({
      query: async () => ({ rows: [] }),
    }),
    resolveDateRangeFromQuestion: () => ({
      start: '2026-07-01',
      end: '2026-07-07',
      label: '近7天',
    }),
    getBadReviewTableId: () => 'tbl_bad',
    extractBitableFieldText: (v) => {
      if (v == null) return '';
      if (Array.isArray(v)) return v.map(String).join('');
      if (typeof v === 'object' && v.text) return String(v.text);
      return String(v);
    },
    isLikelySameStore: (a, b) => String(a || '').includes(String(b || '').slice(0, 2)) || a === b,
    normalizeBitableDateValue: (v) => (v ? String(v).slice(0, 10) : ''),
    inDateRangeInclusive: () => true,
    loadUnifiedTableVisitRowsByStore: async () => [],
    ...overrides,
  };
  return createBuildBiDeterministicBadReviewReportReply(deps);
}

test('empty store / non-review text → empty', async () => {
  const build = makeBuilder();
  assert.equal(await build('', '差评'), '');
  assert.equal(await build('洪潮久光店', '销量TOP'), '');
});

test('feishu_generic_records hit', async () => {
  const build = makeBuilder({
    isLikelySameStore: () => true,
    pool: () => ({
      query: async (sql) => {
        if (/feishu_generic_records/.test(sql)) {
          return {
            rows: [
              {
                created_at: '2026-07-05',
                fields: {
                  差评门店: '洪潮久光店',
                  差评日期: '2026-07-05',
                  差评产品: '鹅肝',
                  差评关键词: '咸,冷',
                  差评平台: '大众点评',
                  差评原因: '味道偏咸不好吃',
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
  });
  const r = await build('洪潮久光店', '最近差评情况');
  assert.match(r, /差评总数：1/);
  assert.match(r, /鹅肝/);
  assert.match(r, /大众点评/);
  assert.match(r, /味道偏咸/);
});

test('fallback to agent_messages when bitable empty', async () => {
  const build = makeBuilder({
    isLikelySameStore: () => true,
    pool: () => ({
      query: async (sql) => {
        if (/feishu_generic_records/.test(sql)) return { rows: [] };
        if (/negative_review/.test(sql)) {
          return {
            rows: [
              {
                created_at: '2026-07-04',
                fields: {
                  store: '洪潮久光店',
                  date: '2026-07-04',
                  product_name: '沙拉',
                  content: '不好吃',
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
  });
  const r = await build('洪潮久光店', '投诉怎么样');
  assert.match(r, /差评总数：1/);
  assert.match(r, /沙拉/);
});

test('table visit dishes when no reviews', async () => {
  const build = makeBuilder({
    getBadReviewTableId: () => '',
    loadUnifiedTableVisitRowsByStore: async () => [
      { dissatisfaction_dish: '牛排,无,薯条' },
      { dissatisfaction_dish: '牛排' },
    ],
  });
  const r = await build('洪潮久光店', '评价情况');
  assert.match(r, /差评报告：暂无/);
  assert.match(r, /桌访不满意菜品/);
  assert.match(r, /牛排（2次）/);
});

test('no data anywhere', async () => {
  const build = makeBuilder({ getBadReviewTableId: () => '' });
  const r = await build('洪潮久光店', '负评');
  assert.match(r, /暂无差评记录入库/);
});

test('query throw → failure message', async () => {
  const build = makeBuilder({
    pool: () => ({
      query: async () => {
        throw new Error('boom');
      },
    }),
  });
  const r = await build('洪潮久光店', '差评');
  assert.match(r, /差评数据查询失败/);
});

test('table visit load error ignored', async () => {
  const build = makeBuilder({
    getBadReviewTableId: () => '',
    loadUnifiedTableVisitRowsByStore: async () => {
      throw new Error('tv fail');
    },
  });
  const r = await build('洪潮久光店', '大众点评');
  assert.match(r, /暂无差评记录入库/);
});
