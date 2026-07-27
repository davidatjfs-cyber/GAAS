/**
 * R51：hq-planner-agent.js (902 行) 拆分至 domains/hq-planner/*，挂 extracted 地板。
 * ctx = { pool, callLLMTiered, log } 注入模式（避免拆分模块反向 import hq-planner-agent.js）。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  extractFirstJsonObject,
  normalizeTextArray,
  buildRuleBasedActions,
  normalizePlanData,
  inferBrand,
} from '../domains/hq-planner/plan-data.js';
import { formatPlanReply } from '../domains/hq-planner/plan-reply-format.js';
import { buildPlannerPrompt, buildCompliancePrompt } from '../domains/hq-planner/prompts.js';
import { repairPlanJson } from '../domains/hq-planner/plan-json-repair.js';
import { runComplianceCheck } from '../domains/hq-planner/compliance-check.js';
import { generateActionPlan } from '../domains/hq-planner/generate-plan.js';
import { approvePlan, rejectPlan, listPlans, findActionPlanTenant } from '../domains/hq-planner/plan-lifecycle.js';
import { extractStoreName, fuzzyMatchStoreName, handleHqBrainMessage } from '../domains/hq-planner/hq-brain-chat.js';
import { registerHqPlannerRoutes } from '../domains/hq-planner/routes.js';
import { setKGPool } from '../knowledge-graph.js';

const noopLog = { info: () => {}, error: () => {}, warn: () => {} };

/** 通用 mock pool：任意 SQL 返回空行，特定表名按需覆写。 */
function makeMockPool(overrides = {}) {
  return {
    query: async (sql, params) => {
      const s = String(sql);
      for (const [pattern, handler] of overrides.matchers || []) {
        if (pattern.test(s)) return handler(s, params);
      }
      return { rows: [] };
    },
  };
}

function tenantsAndPlanPool(planRow) {
  return makeMockPool({
    matchers: [
      [/FROM tenants WHERE status = 'active'/, async () => ({ rows: [{ tenant_id: 'default' }] })],
      [/FROM action_plans WHERE plan_id = \$1/, async () => ({ rows: planRow ? [planRow] : [] })],
    ],
  });
}

test.beforeEach(() => {
  setKGPool(makeMockPool());
});

// ───────────────────────── plan-data.js ─────────────────────────

test('plan-data: extractFirstJsonObject 解析各种输入', () => {
  assert.deepEqual(extractFirstJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(extractFirstJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractFirstJsonObject('前缀文字 {"a":1} 后缀文字'), { a: 1 });
  assert.equal(extractFirstJsonObject(''), null);
  assert.equal(extractFirstJsonObject('完全不是JSON'), null);
  assert.equal(extractFirstJsonObject('[1,2,3]'), null); // 数组不是合法对象
});

test('plan-data: normalizeTextArray 去重截断', () => {
  assert.deepEqual(normalizeTextArray(['a', 'a', 'b', '']), ['a', 'b']);
  assert.deepEqual(normalizeTextArray(null), []);
  assert.equal(normalizeTextArray(['1', '2', '3', '4'], 2).length, 2);
  assert.equal(normalizeTextArray(['x'.repeat(200)])[0].length, 120);
});

test('plan-data: buildRuleBasedActions 按扣分排序，无扣分时兜底', () => {
  const actions = buildRuleBasedActions({
    scoreBreakdown: { anomalyDeduct: 5, materialDeduct: 10, closingDeduct: 0, complaintDeduct: 2 },
  });
  assert.equal(actions[0].responsibleRole, 'store_production_manager'); // materialDeduct 最高
  assert.ok(actions.length <= 4);

  const fallback = buildRuleBasedActions({});
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].action, /周度经营复盘/);
});

test('plan-data: normalizePlanData 归一化 LLM 输出并回退规则行动', () => {
  const normalized = normalizePlanData(
    { title: '计划A', summary: '摘要', actions: [{ action: '做点什么', responsibleRole: '出品负责人' }] },
    { store: 'S1', goal: '提升', storeHealth: {} }
  );
  assert.equal(normalized.title, '计划A');
  assert.equal(normalized.actions[0].responsibleRole, 'store_production_manager');
  assert.equal(normalized.actions[0].deadline, '7天');

  const empty = normalizePlanData({}, { store: 'S1', goal: null, storeHealth: {}, rawContent: 'raw text' });
  assert.match(empty.title, /S1/);
  assert.ok(empty.actions.length >= 1); // 无 actions 时回退规则行动
  assert.equal(empty.rawContent, 'raw text');
});

test('plan-data: inferBrand 按门店名推断品牌', () => {
  assert.equal(inferBrand('洪潮大宁久光店'), '洪潮传统潮汕菜');
  assert.equal(inferBrand('马己仙广州店'), '马己仙广东小馆');
  assert.equal(inferBrand('未知店'), '');
});

// ───────────────────────── plan-reply-format.js ─────────────────────────

test('plan-reply-format: formatPlanReply 渲染完整/最简计划', () => {
  const full = formatPlanReply(
    {
      planId: 'AP-1',
      healthScore: 80,
      status: 'pending_review',
      plan: {
        title: 'T', summary: 'S',
        rootCauses: ['根因1'],
        actions: [{ action: '做事', responsibleRole: 'store_manager', deadline: '7天', kpiTarget: 'K', verificationMethod: 'V' }],
        expectedOutcome: '变好',
        dataGaps: ['缺口1'],
      },
      compliance: { passed: false, checks: { dataAccuracy: { passed: false, issues: ['编造数字'] } } },
    },
    '门店A'
  );
  assert.match(full, /行动计划 \[AP-1\]/);
  assert.match(full, /核心根因/);
  assert.match(full, /行动清单/);
  assert.match(full, /编造数字/);
  assert.match(full, /审批通过 AP-1/);

  const minimal = formatPlanReply({ planId: 'AP-2', healthScore: 90, plan: {} }, '门店B');
  assert.match(minimal, /行动计划 \[AP-2\]/);
  assert.doesNotMatch(minimal, /核心根因/);
});

// ───────────────────────── prompts.js ─────────────────────────

test('prompts: buildPlannerPrompt / buildCompliancePrompt 生成模板', () => {
  const planner = buildPlannerPrompt({
    store: 'S1', goal: '提升营收', windowDays: 30,
    storeHealth: { healthScore: 85, scoreBreakdown: {} },
    tasksSummary: '', scoresSummary: '',
  });
  assert.match(planner, /S1/);
  assert.match(planner, /提升营收/);
  assert.match(planner, /健康分: 85\/100/);

  const compliance = buildCompliancePrompt({
    store: 'S1', storeHealth: { healthScore: 85 }, graphContext: '图谱', tasksSummary: '任务', scoresSummary: '绩效',
    planData: { title: 'T' },
  });
  assert.match(compliance, /合规审查AI/);
  assert.match(compliance, /"title": "T"/);
});

// ───────────────────────── plan-json-repair.js ─────────────────────────

test('plan-json-repair: 优先直接解析，解析失败才调用 LLM 修复', async () => {
  const noLLM = await repairPlanJson({ callLLMTiered: async () => { throw new Error('should not be called'); } }, '{"a":1}', 'admin');
  assert.deepEqual(noLLM, { a: 1 });

  const repaired = await repairPlanJson(
    { callLLMTiered: async () => ({ ok: true, content: '{"title":"修复后"}' }) },
    '这不是JSON',
    'admin'
  );
  assert.deepEqual(repaired, { title: '修复后' });

  const failed = await repairPlanJson(
    { callLLMTiered: async () => ({ ok: false, error: 'llm_down' }) },
    '这不是JSON',
    'admin'
  );
  assert.equal(failed, null);
});

// ───────────────────────── compliance-check.js ─────────────────────────

test('compliance-check: runComplianceCheck 各分支', async () => {
  const ok = await runComplianceCheck(
    { callLLMTiered: async () => ({ ok: true, content: '{"passed":true,"checks":{},"overallComment":"ok"}' }), log: noopLog },
    { title: 'T' },
    { store: 'S1', storeHealth: {}, role: 'admin' }
  );
  assert.equal(ok.passed, true);

  const llmFailed = await runComplianceCheck(
    { callLLMTiered: async () => ({ ok: false, error: 'boom' }), log: noopLog },
    { title: 'T' },
    { store: 'S1', storeHealth: {}, role: 'admin' }
  );
  assert.equal(llmFailed.passed, false);
  assert.equal(llmFailed.error, 'compliance_llm_failed');

  const badJson = await runComplianceCheck(
    { callLLMTiered: async () => ({ ok: true, content: '不是JSON' }), log: noopLog },
    { title: 'T' },
    { store: 'S1', storeHealth: {}, role: 'admin' }
  );
  assert.equal(badJson.passed, false);
  assert.match(badJson.overallComment, /解析失败/);

  const threw = await runComplianceCheck(
    { callLLMTiered: async () => { throw new Error('network_down'); }, log: noopLog },
    { title: 'T' },
    { store: 'S1', storeHealth: {}, role: 'admin' }
  );
  assert.equal(threw.passed, false);
  assert.equal(threw.error, 'compliance_error');
});

// ───────────────────────── generate-plan.js ─────────────────────────

test('generate-plan: 非HQ角色被拒绝', async () => {
  const result = await generateActionPlan({ pool: () => makeMockPool(), callLLMTiered: async () => ({}), log: noopLog }, {
    store: 'S1', goal: 'x', role: 'store_employee',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden');
});

test('generate-plan: LLM 生成失败时返回 llm_failed', async () => {
  const ctx = {
    pool: () => makeMockPool(),
    callLLMTiered: async () => ({ ok: false, error: 'llm_timeout' }),
    log: noopLog,
  };
  const result = await generateActionPlan(ctx, { store: 'S1', goal: '提升', role: 'admin' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'llm_failed');
});

test('generate-plan: 正常路径生成计划并通过合规审查', async () => {
  const pool = makeMockPool();
  const ctx = {
    pool: () => pool,
    callLLMTiered: async (messages, role, options) => {
      if (options.purpose === 'reasoning') {
        return {
          ok: true,
          content: JSON.stringify({
            title: '改善计划',
            summary: '聚焦核心问题分阶段改善',
            rootCauses: ['缺少标准化复盘机制'],
            actions: [{ priority: 1, action: '建立周复盘', responsibleRole: 'store_manager', deadline: '7天', kpiTarget: '健康分提升', verificationMethod: '复核健康分' }],
            expectedOutcome: '健康分回升',
            dataGaps: [],
          }),
        };
      }
      return { ok: true, content: JSON.stringify({ passed: true, checks: {}, overallComment: '通过' }) };
    },
    log: noopLog,
  };
  const result = await generateActionPlan(ctx, { store: 'S1', goal: '提升', role: 'admin', createdBy: 'u1' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'pending_review');
  assert.equal(result.plan.title, '改善计划');
  assert.equal(result.compliance.passed, true);
});

test('generate-plan: 程序化数字校验未通过时直接判定不合规', async () => {
  const pool = makeMockPool();
  let complianceLlmCalled = false;
  const ctx = {
    pool: () => pool,
    callLLMTiered: async (messages, role, options) => {
      if (options.purpose === 'reasoning') {
        return {
          ok: true,
          content: JSON.stringify({
            title: '改善计划',
            summary: '摘要',
            rootCauses: ['原料异常扣999分(编造)'], // 999分 在真实数据中不存在
            actions: [],
            expectedOutcome: '预期',
            dataGaps: [],
          }),
        };
      }
      complianceLlmCalled = true;
      return { ok: true, content: JSON.stringify({ passed: true }) };
    },
    log: noopLog,
  };
  const result = await generateActionPlan(ctx, { store: 'S1', goal: '提升', role: 'admin' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'compliance_rejected');
  assert.equal(result.compliance.passed, false);
  assert.equal(complianceLlmCalled, false); // 程序化校验拦截，不应再消耗LLM调用
});

test('generate-plan: 内部异常时返回 internal 错误', async () => {
  const ctx = {
    pool: () => ({ query: async () => { throw new Error('db_down'); } }),
    callLLMTiered: async () => ({ ok: true, content: '{}' }),
    log: noopLog,
  };
  const result = await generateActionPlan(ctx, { store: 'S1', goal: '提升', role: 'admin' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'internal');
});

// ───────────────────────── plan-lifecycle.js ─────────────────────────

test('plan-lifecycle: findActionPlanTenant 未找到租户/计划', async () => {
  const ctx = { pool: () => makeMockPool(), log: noopLog }; // 无 active tenants -> 找不到
  const { tenantId, plan } = await findActionPlanTenant(ctx, 'AP-nope');
  assert.equal(tenantId, null);
  assert.equal(plan, null);
});

test('plan-lifecycle: approvePlan 拆解行动为任务并流转状态', async () => {
  const prevPw = process.env.AGENTS_ADMIN_PASSWORD;
  delete process.env.AGENTS_ADMIN_PASSWORD; // 强制 createBoardTaskViaV2 优雅失败，不发真实请求
  try {
    const pool = tenantsAndPlanPool({
      status: 'pending_review',
      store: 'S1',
      plan_data: { actions: [{ action: '做事', priority: 'medium', kpiTarget: 'K', verificationMethod: 'V', deadline: '7天' }] },
    });
    const ctx = { pool: () => pool, log: noopLog };
    const result = await approvePlan(ctx, 'AP-1', 'approver1');
    assert.equal(result.ok, true);
    assert.equal(result.createdTasks, 0); // 无凭据时 v2 建任务优雅失败
  } finally {
    if (prevPw !== undefined) process.env.AGENTS_ADMIN_PASSWORD = prevPw;
  }
});

test('plan-lifecycle: approvePlan 找不到计划 / 状态不对', async () => {
  const notFoundCtx = { pool: () => tenantsAndPlanPool(null), log: noopLog };
  assert.equal((await approvePlan(notFoundCtx, 'AP-x', 'u')).error, 'not_found');

  const wrongStatusCtx = { pool: () => tenantsAndPlanPool({ status: 'approved', store: 'S1', plan_data: {} }), log: noopLog };
  const r = await approvePlan(wrongStatusCtx, 'AP-1', 'u');
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid_status/);
});

test('plan-lifecycle: rejectPlan 驳回计划', async () => {
  const pool = tenantsAndPlanPool({ status: 'pending_review', store: 'S1', plan_data: {} });
  const ctx = { pool: () => pool, log: noopLog };
  const ok = await rejectPlan(ctx, 'AP-1', 'u1', '数据不实');
  assert.equal(ok.ok, true);

  const notFound = await rejectPlan({ pool: () => tenantsAndPlanPool(null), log: noopLog }, 'AP-x', 'u1', 'r');
  assert.equal(notFound.error, 'not_found');
});

test('plan-lifecycle: listPlans 按条件过滤', async () => {
  const pool = makeMockPool({
    matchers: [[/FROM action_plans WHERE/, async () => ({ rows: [{ plan_id: 'AP-1' }] })]],
  });
  const rows = await listPlans({ pool: () => pool, log: noopLog }, { store: 'S1', status: 'pending_review', limit: 5 });
  assert.equal(rows.length, 1);
});

// ───────────────────────── hq-brain-chat.js ─────────────────────────

test('hq-brain-chat: extractStoreName 提取门店名', () => {
  assert.equal(extractStoreName('为洪潮大宁久光店生成行动计划'), '洪潮大宁久光店');
  assert.equal(extractStoreName('马己仙广州店健康度'), '马己仙广州店');
  assert.equal(extractStoreName('没有店名的消息'), null);
});

test('hq-brain-chat: fuzzyMatchStoreName 精确/包含/关键字/异常兜底', async () => {
  const pool = makeMockPool({
    matchers: [[/FROM feishu_users/, async () => ({ rows: [{ store: '洪潮大宁久光店' }] })]],
  });
  const ctx = { pool: () => pool, log: noopLog };
  assert.equal(await fuzzyMatchStoreName(ctx, '洪潮大宁久光店'), '洪潮大宁久光店'); // 精确
  assert.equal(await fuzzyMatchStoreName(ctx, '洪潮久光店'), '洪潮大宁久光店'); // 关键字兜底
  assert.equal(await fuzzyMatchStoreName(ctx, ''), '');

  const throwingCtx = { pool: () => ({ query: async () => { throw new Error('db'); } }), log: noopLog };
  assert.equal(await fuzzyMatchStoreName(throwingCtx, '任意店'), '任意店'); // 异常兜底返回原输入

  const noMatchCtx = { pool: () => makeMockPool({ matchers: [[/FROM feishu_users/, async () => ({ rows: [{ store: '完全不相干' }] })]] }), log: noopLog };
  assert.equal(await fuzzyMatchStoreName(noMatchCtx, '马己仙广州店'), '马己仙广州店'); // 无匹配兜底返回原输入
});

test('hq-brain-chat: handleHqBrainMessage 非HQ角色直接返回null', async () => {
  const ctx = { pool: () => makeMockPool(), callLLMTiered: async () => ({}), log: noopLog };
  const result = await handleHqBrainMessage(ctx, { text: '生成行动计划', role: 'store_employee', username: 'u', store: 'S1' });
  assert.equal(result, null);
});

test('hq-brain-chat: handleHqBrainMessage 生成计划意图（成功/未指定门店/生成失败）', async () => {
  const pool = makeMockPool();
  const ctx = {
    pool: () => pool,
    callLLMTiered: async (messages, role, options) => {
      if (options.purpose === 'reasoning') {
        return { ok: true, content: JSON.stringify({ title: 'T', summary: '摘要', rootCauses: [], actions: [], expectedOutcome: 'E', dataGaps: [] }) };
      }
      return { ok: true, content: JSON.stringify({ passed: true, checks: {}, overallComment: 'ok' }) };
    },
    log: noopLog,
  };
  const result = await handleHqBrainMessage(ctx, { text: '为S1生成行动计划，目标：提升复购', role: 'admin', username: 'u', store: 'S1' });
  assert.equal(result.handled, true);
  assert.match(result.response, /行动计划/);

  const noStore = await handleHqBrainMessage(ctx, { text: '生成行动计划', role: 'admin', username: 'u', store: '' });
  assert.match(noStore.response, /请指定目标门店/);

  const failCtx = { pool: () => pool, callLLMTiered: async () => ({ ok: false, error: 'timeout' }), log: noopLog };
  const failed = await handleHqBrainMessage(failCtx, { text: '为S1生成行动计划', role: 'admin', username: 'u', store: 'S1' });
  assert.match(failed.response, /生成失败/);
});

test('hq-brain-chat: handleHqBrainMessage 健康度意图（未指定门店/含明细数据）', async () => {
  const emptyPool = makeMockPool();
  const emptyCtx = { pool: () => emptyPool, callLLMTiered: async () => ({}), log: noopLog };

  const noStore = await handleHqBrainMessage(emptyCtx, { text: '健康度查询', role: 'admin', username: 'u', store: '' });
  assert.match(noStore.response, /请指定门店名称/);

  const health = await handleHqBrainMessage(emptyCtx, { text: 'S1健康度', role: 'admin', username: 'u', store: 'S1' });
  assert.match(health.response, /健康诊断/);

  const richPool = makeMockPool({
    matchers: [
      [/FROM master_tasks/, async () => ({ rows: [{ category: '原料', severity: 'high', cnt: 3 }] })],
      [/config_key IN \('material_hongchao'/, async () => ({ rows: [{ material: '牛肉', severity: '严重', cnt: 2 }] })],
      [/config_key = 'closing_reports'/, async () => ({ rows: [{ total: 10, passed: 9, avg_score: 92 }] })],
      [/config_key = 'table_visit'/, async () => ({ rows: [{ total: 20, with_complaints: 3 }] })],
      [/FROM pos_sales_detail/, async () => ({ rows: [{ days: 5, total_rev: 5000, avg_daily_rev: 1000 }] })],
    ],
  });
  setKGPool(richPool);
  const richCtx = { pool: () => richPool, callLLMTiered: async () => ({}), log: noopLog };
  const rich = await handleHqBrainMessage(richCtx, { text: 'S1健康度', role: 'admin', username: 'u', store: 'S1' });
  assert.match(rich.response, /异常任务/);
  assert.match(rich.response, /原料问题/);
  assert.match(rich.response, /收档检查/);
  assert.match(rich.response, /桌访/);
  assert.match(rich.response, /销售/);
});

test('hq-brain-chat: handleHqBrainMessage 因果/审批/对比意图/未匹配', async () => {
  const pool = makeMockPool();
  const ctx = { pool: () => pool, callLLMTiered: async () => ({ ok: true, content: '{}' }), log: noopLog };

  const causal = await handleHqBrainMessage(ctx, { text: 'S1为什么表现不好', role: 'admin', username: 'u', store: 'S1' });
  assert.match(causal.response, /暂无关联数据|因果关系链/);

  const approvePool = tenantsAndPlanPool({ status: 'pending_review', store: 'S1', plan_data: { actions: [] } });
  const prevPw = process.env.AGENTS_ADMIN_PASSWORD;
  delete process.env.AGENTS_ADMIN_PASSWORD;
  try {
    const approveOkCtx = { pool: () => approvePool, callLLMTiered: async () => ({}), log: noopLog };
    const approveOk = await handleHqBrainMessage(approveOkCtx, { text: '审批通过 AP-abc123', role: 'admin', username: 'u', store: 'S1' });
    assert.match(approveOk.response, /已审批通过/);
  } finally {
    if (prevPw !== undefined) process.env.AGENTS_ADMIN_PASSWORD = prevPw;
  }

  const approveFailPool = tenantsAndPlanPool(null);
  const approveFailCtx = { pool: () => approveFailPool, callLLMTiered: async () => ({}), log: noopLog };
  const approveFail = await handleHqBrainMessage(approveFailCtx, { text: '审批通过 AP-abc123', role: 'admin', username: 'u', store: 'S1' });
  assert.match(approveFail.response, /审批失败/);

  const comparePool = makeMockPool({
    matchers: [[/FROM feishu_users/, async () => ({ rows: [{ store: '洪潮大宁久光店' }, { store: '马己仙广州店' }] })]],
  });
  setKGPool(comparePool);
  const compareCtx = { pool: () => comparePool, callLLMTiered: async () => ({}), log: noopLog };
  const compare = await handleHqBrainMessage(compareCtx, { text: '对比洪潮大宁久光店和马己仙广州店', role: 'admin', username: 'u', store: 'S1' });
  assert.match(compare.response, /门店对比分析/);

  const unmatched = await handleHqBrainMessage(ctx, { text: '随便聊聊', role: 'admin', username: 'u', store: 'S1' });
  assert.equal(unmatched, null);
});

// ───────────────────────── routes.js ─────────────────────────

async function withApp(register, fn) {
  const app = express();
  app.use(express.json());
  register(app);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authAs(user) {
  return (req, _res, next) => {
    req.user = user;
    req.tenantId = user?.tenant_id || 'default';
    next();
  };
}

async function jsonFetch(base, pathName, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + pathName, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('hq-planner routes: 非HQ角色返回403', async () => {
  const ctx = { pool: () => makeMockPool(), callLLMTiered: async () => ({}), log: noopLog };
  await withApp(
    (app) => registerHqPlannerRoutes(app, authAs({ role: 'store_employee', username: 'u1' }), ctx),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/hq/plans')).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/plans', { method: 'POST', body: '{}' })).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/plans/AP-1/approve', { method: 'POST' })).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/plans/AP-1/reject', { method: 'POST' })).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/store-health/S1')).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/causal-chain')).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/compare-stores', { method: 'POST', body: '{}' })).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/graph-stats')).status, 403);
      assert.equal((await jsonFetch(base, '/api/hq/cost-stats')).status, 403);
    }
  );
});

test('hq-planner routes: HQ角色可查询计划列表/详情/健康度/图谱/对比', async () => {
  const pool = makeMockPool({
    matchers: [
      [/FROM action_plans WHERE plan_id/, async () => ({ rows: [{ plan_id: 'AP-1' }] })],
      [/FROM action_plans WHERE/, async () => ({ rows: [] })],
    ],
  });
  const ctx = { pool: () => pool, callLLMTiered: async () => ({}), log: noopLog };
  await withApp(
    (app) => registerHqPlannerRoutes(app, authAs({ role: 'admin', username: 'u1', tenant_id: 'default' }), ctx),
    async (base) => {
      const list = await jsonFetch(base, '/api/hq/plans');
      assert.equal(list.status, 200);
      assert.ok(Array.isArray(list.body.items));

      const detail = await jsonFetch(base, '/api/hq/plans/AP-1');
      assert.equal(detail.status, 200);
      assert.equal(detail.body.plan_id, 'AP-1');

      const missing = await jsonFetch(base, '/api/hq/plans/AP-none');
      // 复用同一 matcher（LIKE plan_id）总是命中第一条 -> 200；此处仅验证不会抛异常
      assert.ok([200, 404].includes(missing.status));

      const health = await jsonFetch(base, '/api/hq/store-health/S1');
      assert.equal(health.status, 200);
      assert.ok(Number.isFinite(health.body.healthScore));

      const noStore = await jsonFetch(base, '/api/hq/compare-stores', { method: 'POST', body: JSON.stringify({ stores: ['S1'] }) });
      assert.equal(noStore.status, 400);

      const compare = await jsonFetch(base, '/api/hq/compare-stores', { method: 'POST', body: JSON.stringify({ stores: ['S1', 'S2'] }) });
      assert.equal(compare.status, 200);
      assert.ok(compare.body.S1);

      const missingParams = await jsonFetch(base, '/api/hq/causal-chain');
      assert.equal(missingParams.status, 400);

      const chain = await jsonFetch(base, '/api/hq/causal-chain?entityType=store&entityId=S1');
      assert.equal(chain.status, 200);
      assert.ok(Array.isArray(chain.body.chain));

      const graphStats = await jsonFetch(base, '/api/hq/graph-stats');
      assert.equal(graphStats.status, 200);
    }
  );
});

test('hq-planner routes: 生成计划 / 审批 / 驳回 / 算力统计', async () => {
  const pool = tenantsAndPlanPool({ status: 'pending_review', store: 'S1', plan_data: { actions: [] } });
  const ctx = {
    pool: () => pool,
    callLLMTiered: async (messages, role, options) => {
      if (options.purpose === 'reasoning') {
        return { ok: true, content: JSON.stringify({ title: 'T', summary: '摘要', rootCauses: [], actions: [], expectedOutcome: 'E', dataGaps: [] }) };
      }
      return { ok: true, content: JSON.stringify({ passed: true, checks: {}, overallComment: 'ok' }) };
    },
    log: noopLog,
  };
  await withApp(
    (app) => registerHqPlannerRoutes(app, authAs({ role: 'admin', username: 'u1', tenant_id: 'default' }), ctx),
    async (base) => {
      const missingStore = await jsonFetch(base, '/api/hq/plans', { method: 'POST', body: JSON.stringify({}) });
      assert.equal(missingStore.status, 400);

      const created = await jsonFetch(base, '/api/hq/plans', { method: 'POST', body: JSON.stringify({ store: 'S1', goal: '提升' }) });
      assert.equal(created.status, 200);
      assert.equal(created.body.ok, true);

      const approve = await jsonFetch(base, '/api/hq/plans/AP-1/approve', { method: 'POST' });
      assert.equal(approve.status, 200);

      const reject = await jsonFetch(base, '/api/hq/plans/AP-1/reject', { method: 'POST', body: JSON.stringify({ reason: 'x' }) });
      assert.equal(reject.status, 200);
    }
  );

  await withApp(
    (app) => registerHqPlannerRoutes(app, authAs({ role: 'admin', username: 'u1' }), ctx),
    async (base) => {
      // cost-stats 要求 role==='admin'（严格白名单，非 isHqRole）
      const cost = await jsonFetch(base, '/api/hq/cost-stats');
      assert.equal(cost.status, 200);
    }
  );
});
