import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeterministicCascadeReplies } from '../domains/agent-bi/deterministic-cascade-replies.js';

function makeCascade(overrides = {}) {
  const enabled = new Set([
    'table_visit_records',
    'table_visit_bitable',
    'daily_reports',
    'bad_reviews',
    'opening_reports_bitable',
    'closing_reports_bitable',
    'meeting_reports_bitable',
    'material_majixian_bitable',
    'material_hongchao_bitable',
  ]);
  const deps = {
    pool: () => ({
      query: async (sql) => {
        if (/FROM table_visit_records/.test(sql)) return { rows: [{ c: 3, latest: '2026-07-01' }] };
        if (/FROM daily_reports/.test(sql)) return { rows: [{ c: 10, latest: '2026-07-02' }] };
        if (/negative_review/.test(sql)) return { rows: [{ c: 2, latest: '2026-07-03' }] };
        if (/opening_report/.test(sql)) return { rows: [{ c: 1, latest: '2026-07-01' }] };
        if (/closing_report/.test(sql)) return { rows: [{ c: 1, latest: '2026-07-01' }] };
        if (/meeting_report/.test(sql)) return { rows: [{ c: 1, latest: '2026-07-01' }] };
        if (/material_report/.test(sql)) return { rows: [{ c: 1, latest: '2026-07-01' }] };
        if (/feishu_generic_records/.test(sql)) {
          return {
            rows: [
              {
                created_at: '2026-07-05',
                fields: {
                  门店: '洪潮久光店',
                  所属门店: '洪潮久光店',
                  提交时间: '2026-07-05',
                  记录日期: '2026-07-05',
                  日期: '2026-07-05',
                  收货日期: '2026-07-05',
                  档口收档平均得分: '9',
                  是否合格: '合格',
                  岗位: '传菜',
                  饭市: '午市',
                  今日异常反馈: '原料不新鲜',
                  异常原料名称: '生菜',
                  严重情况: '中',
                  得分: '8',
                  是否合格的例会: '合格 8分',
                  主持人: '甲',
                  缺席人员姓名: '乙',
                  报损菜品: '牛排',
                  报损金额: '12',
                  报损原因: '过期',
                  报损数量: '1',
                  报损部门: '厨部',
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
    isBiSourceEnabled: (k) => enabled.has(k),
    resolveDateRangeFromQuestion: () => ({
      start: '2026-07-01',
      end: '2026-07-07',
      label: '近7天',
    }),
    loadUnifiedTableVisitRowsByStore: async () => [
      {
        dissatisfaction_dish: '牛排,薯条',
        unsatisfied_items: '太咸,上菜有点慢',
      },
      {
        dissatisfaction_dish: '牛排',
        unsatisfied_items: '好吃满意',
      },
    ],
    extractTableVisitDishes: (row) =>
      String(row?.dissatisfaction_dish || '')
        .split(/[，,、]+/)
        .map((x) => x.trim())
        .filter((x) => x && x !== '无'),
    extractBitableFieldText: (v) => (v == null ? '' : String(v)),
    isLikelySameStore: () => true,
    normalizeBitableDateValue: (v) => (v ? String(v).slice(0, 10) : ''),
    inDateRangeInclusive: () => true,
    getClosingTableId: () => 'tbl_c',
    getOpeningTableId: () => 'tbl_o',
    getMeetingTableId: () => 'tbl_m',
    getLossTableId: () => 'tbl_l',
    getMaterialTableIds: () => ['tbl_mh', 'tbl_mm'],
    ...overrides,
  };
  return createDeterministicCascadeReplies(deps);
}

test('DataSourceCoverage happy + disabled + query fail', async () => {
  const c = makeCascade({
    isBiSourceEnabled: (k) => k !== 'daily_reports',
    pool: () => ({
      query: async (sql) => {
        if (/table_visit_records/.test(sql)) throw new Error('x');
        return { rows: [{ c: 1, latest: 'd' }] };
      },
    }),
  });
  assert.equal(await c.buildBiDeterministicDataSourceCoverageReply('你好'), '');
  const r = await c.buildBiDeterministicDataSourceCoverageReply('能查什么数据源');
  assert.match(r, /已禁用/);
  assert.match(r, /查询失败|条/);
});

test('TableVisit general + dish-specific + empty + disabled', async () => {
  const c = makeCascade();
  assert.equal(await c.buildBiDeterministicTableVisitReply('', '桌访'), '');
  assert.equal(await c.buildBiDeterministicTableVisitReply('店', '你好'), '');
  const r = await c.buildBiDeterministicTableVisitReply('洪潮久光店', '桌访不满意');
  assert.match(r, /桌访反馈/);
  assert.match(r, /牛排/);
  const r2 = await c.buildBiDeterministicTableVisitReply('洪潮久光店', '牛排主要不满意在哪里');
  assert.match(r2, /「牛排」桌访不满意详情/);
  const empty = makeCascade({
    loadUnifiedTableVisitRowsByStore: async () => [],
  });
  assert.match(await empty.buildBiDeterministicTableVisitReply('店', '桌访'), /暂无桌访数据/);
  const dis = makeCascade({ isBiSourceEnabled: () => false });
  assert.equal(await dis.buildBiDeterministicTableVisitReply('店', '桌访'), '');
  const fail = makeCascade({
    loadUnifiedTableVisitRowsByStore: async () => {
      throw new Error('tv');
    },
  });
  assert.match(await fail.buildBiDeterministicTableVisitReply('店', '桌访'), /查询失败/);
});

test('OpsReportCount count / dissatisfaction / summary', async () => {
  const c = makeCascade();
  assert.equal(await c.buildBiDeterministicOpsReportCountReply('', '开档多少'), '');
  assert.equal(await c.buildBiDeterministicOpsReportCountReply('店', '你好吗'), '');
  const r = await c.buildBiDeterministicOpsReportCountReply('洪潮久光店', '开档多少次');
  assert.match(r, /桌访记录/);
  const r2 = await c.buildBiDeterministicOpsReportCountReply(
    '洪潮久光店',
    '开档最不满意的菜品有多少'
  );
  assert.match(r2, /桌访不满意反馈|负面反馈|不满意菜品/);
  const empty = makeCascade({ loadUnifiedTableVisitRowsByStore: async () => [] });
  assert.match(await empty.buildBiDeterministicOpsReportCountReply('店', '收档有没有'), /0条记录/);
});

test('Closing / Opening / Material / Meeting / Loss reports', async () => {
  const c = makeCascade();
  assert.equal(await c.buildBiDeterministicClosingReportReply('店', '你好'), '');
  const closing = await c.buildBiDeterministicClosingReportReply('洪潮久光店', '收档平均得分');
  assert.match(closing, /收档报告/);
  assert.match(closing, /合格率/);

  const opening = await c.buildBiDeterministicOpeningReportReply('洪潮久光店', '开档报告');
  assert.match(opening, /开档记录/);

  const material = await c.buildBiDeterministicMaterialReportReply('洪潮久光店', '原料收货异常');
  assert.match(material, /异常原料/);

  const meeting = await c.buildBiDeterministicMeetingReportReply('洪潮久光店', '例会得分');
  assert.match(meeting, /例会记录/);

  const loss = await c.buildBiDeterministicLossReportReply('洪潮久光店', '报损多少');
  assert.match(loss, /报损记录/);
});

test('missing table ids and empty ranges', async () => {
  const c = makeCascade({
    getClosingTableId: () => '',
    getOpeningTableId: () => '',
    getMeetingTableId: () => '',
    getLossTableId: () => '',
    getMaterialTableIds: () => [],
  });
  assert.match(await c.buildBiDeterministicClosingReportReply('店', '收档'), /未配置/);
  assert.match(await c.buildBiDeterministicOpeningReportReply('店', '开档'), /未配置/);
  assert.match(await c.buildBiDeterministicMeetingReportReply('店', '例会'), /未配置/);
  assert.match(await c.buildBiDeterministicLossReportReply('店', '报损'), /未配置/);
  assert.match(await c.buildBiDeterministicMaterialReportReply('店', '原料'), /未配置/);

  const empty = makeCascade({
    pool: () => ({ query: async () => ({ rows: [] }) }),
  });
  assert.match(await empty.buildBiDeterministicClosingReportReply('店', '收档得分'), /0条记录/);
  assert.match(await empty.buildBiDeterministicOpeningReportReply('店', '开档报告'), /0条记录/);
  assert.match(await empty.buildBiDeterministicMaterialReportReply('店', '原料'), /0条记录/);
  assert.match(await empty.buildBiDeterministicMeetingReportReply('店', '例会'), /暂无例会/);
  assert.match(await empty.buildBiDeterministicLossReportReply('店', '损耗'), /暂无报损/);
});

test('query failures return error strings', async () => {
  const c = makeCascade({
    pool: () => ({
      query: async () => {
        throw new Error('db');
      },
    }),
  });
  assert.match(await c.buildBiDeterministicClosingReportReply('店', '收档'), /查询失败/);
  assert.match(await c.buildBiDeterministicOpeningReportReply('店', '开档'), /查询失败/);
  assert.match(await c.buildBiDeterministicMaterialReportReply('店', '原料'), /查询失败/);
  assert.match(await c.buildBiDeterministicMeetingReportReply('店', '例会'), /查询失败/);
  assert.match(await c.buildBiDeterministicLossReportReply('店', '报损'), /查询失败/);
});
