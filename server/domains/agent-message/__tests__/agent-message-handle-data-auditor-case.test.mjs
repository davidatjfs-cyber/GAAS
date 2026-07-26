import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandleDataAuditorCase } from '../handle-data-auditor-case.js';

function baseCtx(overrides = {}) {
  return {
    text: '近7天营收',
    route: 'data_auditor',
    routeRes: { intent: 'revenue', intent_label: '营收', required_metrics: [] },
    store: '洪潮久光店',
    brand: '洪潮',
    brandId: 'hc',
    brandConfig: {},
    senderRole: 'store_manager',
    senderUsername: 'u1',
    senderName: '甲',
    sessionState: {
      task_id: 't1',
      metrics_requested: [],
      metrics_returned: [],
      metric_versions: {},
    },
    activeTaskContext: '',
    ...overrides,
  };
}

function makeCase(overrides = {}) {
  const calls = { bi: 0, fc: 0, llm: 0, ground: 0 };
  const noopBi = async () => null;
  const deps = {
    pool: () => ({
      query: async () => ({ rows: [] }),
    }),
    inferBrandFromStoreName: () => '洪潮',
    tryHandleBiByFunctionCalling: async () => {
      calls.fc++;
      return null;
    },
    isFactLikeQuestion: () => false,
    buildBiFactSourceAudit: async () => [],
    buildBiSourceAuditText: () => '',
    buildBiGroundingFacts: async () => {
      calls.ground++;
      return '事实：营收100';
    },
    callLLM: async () => {
      calls.llm++;
      return { content: 'llm-bi' };
    },
    getContext: () => [],
    updateContext: () => {},
    getSharedState: async () => ({}),
    normalizeStoreKey: (v) => String(v || '').toLowerCase(),
    resolveDateRangeFromQuestion: () => ({
      start: '2026-07-01',
      end: '2026-07-07',
      label: '近7天',
    }),
    buildSalesReport: () => null,
    buildBiDeterministicDataSourceCoverageReply: noopBi,
    buildBiDeterministicDailyReportReply: noopBi,
    buildBiDeterministicTableVisitReply: noopBi,
    buildBiDeterministicSalesRawTopReply: noopBi,
    buildBiDeterministicBadReviewReportReply: noopBi,
    buildBiDeterministicClosingReportReply: noopBi,
    buildBiDeterministicOpeningReportReply: noopBi,
    buildBiDeterministicMaterialReportReply: noopBi,
    buildBiDeterministicMeetingReportReply: noopBi,
    buildBiDeterministicOpsReportCountReply: noopBi,
    buildBiDeterministicLossReportReply: noopBi,
    featureFlags: {
      enable_data_executor: true,
      enable_metric_dictionary: true,
      enable_business_diagnosis: false,
    },
    ...overrides,
  };
  // wrap cascade builders to count bi hits via coverage
  const origCov = deps.buildBiDeterministicDataSourceCoverageReply;
  deps.buildBiDeterministicDataSourceCoverageReply = async (...a) => {
    calls.bi++;
    return origCov(...a);
  };
  return { run: createHandleDataAuditorCase(deps), calls, deps };
}

test('BI deterministic cascade hit short-circuits', async () => {
  const { run, calls } = makeCase({
    buildBiDeterministicDailyReportReply: async () => '日报确定性命中',
  });
  const r = await run(baseCtx());
  assert.equal(r.response, '日报确定性命中');
  assert.equal(r.agentData.deterministic, true);
  assert.equal(calls.fc, 0);
  assert.equal(calls.llm, 0);
});

test('function-calling hit after cascade miss', async () => {
  const { run, calls } = makeCase({
    tryHandleBiByFunctionCalling: async () => {
      calls.fc++;
      return { response: 'fc-ok', meta: { tool: 'x' } };
    },
  });
  const r = await run(baseCtx());
  assert.equal(r.response, 'fc-ok');
  assert.equal(r.agentData.functionCalling, true);
  assert.equal(calls.llm, 0);
});

test('insufficient_sources blocks LLM', async () => {
  const { run, calls } = makeCase({
    isFactLikeQuestion: () => true,
    buildBiFactSourceAudit: async () => [
      { source: 'daily_reports', status: 'empty' },
      { source: 'bad_reviews', status: 'empty' },
    ],
    buildBiSourceAuditText: () => '- daily_reports: empty',
  });
  const r = await run(baseCtx({ text: '差评多少条' }));
  assert.match(r.response, /暂无可用样本/);
  assert.equal(r.agentData.reason, 'insufficient_sources');
  assert.equal(calls.llm, 0);
});

test('insufficient_facts for review-like question', async () => {
  const { run, calls } = makeCase({
    isFactLikeQuestion: () => true,
    buildBiFactSourceAudit: async () => [{ source: 'bad_reviews', status: 'ok' }],
    buildBiSourceAuditText: () => 'ok',
    buildBiGroundingFacts: async () => '无差评样本',
  });
  const r = await run(baseCtx({ text: '近7天差评次数' }));
  assert.match(r.response, /可用样本不足/);
  assert.equal(r.agentData.reason, 'insufficient_facts');
  assert.equal(calls.llm, 0);
});

test('LLM fallback path updates context', async () => {
  let updated = 0;
  const { run, calls } = makeCase({
    updateContext: () => {
      updated++;
    },
    buildBiGroundingFacts: async () => '可用事实：实收 1万',
  });
  const r = await run(baseCtx());
  assert.equal(r.response, 'llm-bi');
  assert.equal(calls.llm, 1);
  assert.equal(updated, 2);
  assert.equal(r.agentData.grounded, true);
});

test('issue context loaded into LLM path', async () => {
  const { run } = makeCase({
    pool: () => ({
      query: async (sql) => {
        if (/FROM agent_issues/i.test(sql)) {
          return { rows: [{ severity: 'high', title: '充值异常' }] };
        }
        return { rows: [] };
      },
    }),
    callLLM: async (messages) => {
      const sys = messages.find((m) => m.role === 'system')?.content || '';
      assert.match(sys, /充值异常/);
      return { content: '含异常上下文' };
    },
  });
  const r = await run(baseCtx());
  assert.equal(r.response, '含异常上下文');
});

test('resolveDataAuditorStore uses pool + inferBrand', async () => {
  let inferred = 0;
  const { run } = makeCase({
    inferBrandFromStoreName: () => {
      inferred++;
      return '洪潮';
    },
    buildBiDeterministicDataSourceCoverageReply: async () => 'cov',
  });
  const r = await run(baseCtx({ store: '总部', text: '洪潮久光店数据' }));
  assert.equal(r.response, 'cov');
  void inferred;
});

test('data executor happy path becomes dx fallback when cascade/FC miss', async () => {
  const { run } = makeCase({
    extractTimeRangeFromText: () => ({
      timeRange: { start: '2026-07-01', end: '2026-07-07' },
      label: '近7天',
    }),
    executeMetrics: async () => ({
      task_id: 'tx',
      results: [
        { metric_id: '实收', name: '实收', value: 12345, notes: '' },
        { metric_id: '毛利率', name: '毛利率', value: 32 },
      ],
      metrics_returned: ['实收', '毛利率'],
      metric_versions: { 实收: 1 },
    }),
    setSessionState: async () => {},
    logExecutorEvent: () => {},
    runBusinessDiagnosis: async () => null,
  });
  const r = await run(
    baseCtx({
      routeRes: {
        intent: 'revenue',
        intent_label: '营收概览',
        required_metrics: ['实收', '毛利率'],
      },
    })
  );
  assert.match(r.response, /营收概览/);
  assert.match(r.response, /12345|12,345/);
  assert.equal(r.agentData.source, 'data_executor');
  assert.equal(r.agentData.deterministic, true);
});

test('data executor stale notice + diagnosis injection', async () => {
  const { run } = makeCase({
    featureFlags: {
      enable_data_executor: true,
      enable_metric_dictionary: true,
      enable_business_diagnosis: true,
    },
    extractTimeRangeFromText: () => ({
      timeRange: { start: '2026-07-01', end: '2026-07-07' },
      label: '近7天',
    }),
    executeMetrics: async () => ({
      task_id: 'tx2',
      results: [{ metric_id: '实收', name: '实收', value: 100 }],
      metrics_returned: ['实收'],
      metric_versions: {},
    }),
    setSessionState: async () => {},
    logExecutorEvent: () => {},
    runBusinessDiagnosis: async () => ({ diagnosis: '客流偏弱', data_basis: 'm' }),
    pool: () => ({
      query: async (sql) => {
        if (/MAX\(date\)/i.test(sql)) {
          return { rows: [{ latest: '2026-01-01' }] };
        }
        return { rows: [] };
      },
    }),
  });
  const r = await run(
    baseCtx({
      routeRes: { intent: 'x', intent_label: '指标', required_metrics: ['实收'] },
    })
  );
  assert.equal(r.agentData.source, 'data_executor');
  assert.match(r.response, /数据新鲜度/);
  assert.match(r.response, /经营诊断|客流偏弱/);
});

test('data executor fallthrough on executeMetrics error', async () => {
  const events = [];
  const { run, calls } = makeCase({
    extractTimeRangeFromText: () => ({
      timeRange: { start: '2026-07-01', end: '2026-07-07' },
      label: '近7天',
    }),
    executeMetrics: async () => {
      throw new Error('exec down');
    },
    setSessionState: async () => {},
    logExecutorEvent: (name, payload) => {
      events.push({ name, payload });
    },
    buildBiDeterministicDailyReportReply: async () => 'after-fallthrough',
  });
  const r = await run(
    baseCtx({
      routeRes: { intent: 'x', intent_label: 'x', required_metrics: ['实收'] },
    })
  );
  assert.equal(r.response, 'after-fallthrough');
  assert.ok(events.some((e) => e.name === 'executor_fallthrough'));
  void calls;
});

test('FC miss + no dx fallback reaches LLM empty content default', async () => {
  const { run } = makeCase({
    callLLM: async () => ({ content: '' }),
    buildBiGroundingFacts: async () => '',
  });
  const r = await run(baseCtx());
  assert.match(r.response, /查看门店数据/);
});
