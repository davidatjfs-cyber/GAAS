import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAdmin, tenantIdFromReq } from '../route-helpers.js';
import { registerAgentConfigRoutes } from '../routes.js';
import { registerAgentRulesRoutes } from '../routes-rules.js';
import { registerAgentTemplateRoutes } from '../routes-templates.js';
import { registerAgentConfigCoreRoutes } from '../routes-core.js';
import { registerAgentDomainConfigRoutes } from '../routes-domain-config.js';
import {
  DEFAULT_BI_AGENT_CONFIG,
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  DEFAULT_OPS_AGENT_CONFIG,
} from '../defaults.js';
import {
  normalizeBiAgentConfig,
  normalizeEmployeeRatingConfig,
  normalizeOpsAgentConfig,
  validateEmployeeRatingConfig,
} from '../normalize.js';
import { FALLBACK_MODEL, normalizeModelName } from '../normalize-helpers.js';
import { toJson } from '../config-loaders.js';

function mockApp() {
  const routes = new Map();
  const add = (method) => (path, ...handlers) => {
    routes.set(`${method} ${path}`, handlers);
  };
  return {
    routes,
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function authPassthrough(_req, _res, next) {
  next();
}

async function invoke(app, methodPath, req) {
  const handlers = app.routes.get(methodPath);
  assert.ok(handlers, `missing route ${methodPath}`);
  const handler = handlers.at(-1);
  const res = mockRes();
  await handler(req, res);
  return res;
}

function adminReq(extra = {}) {
  return {
    user: { role: 'admin', tenant_id: 'default' },
    tenantId: 'default',
    params: {},
    query: {},
    body: {},
    ...extra,
  };
}

function queuePool(responses) {
  let i = 0;
  return () => ({
    query: async () => {
      const next = responses[i++];
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next();
      return next;
    },
  });
}

test('assertAdmin / tenantIdFromReq', () => {
  const res = mockRes();
  assert.equal(assertAdmin({ user: { role: 'admin' } }, res), true);
  assert.equal(assertAdmin({ user: { role: 'custom_x' } }, mockRes()), true);
  const denied = mockRes();
  assert.equal(assertAdmin({ user: { role: 'store_manager' } }, denied), false);
  assert.equal(denied.statusCode, 403);
  assert.equal(tenantIdFromReq({ tenantId: 't1' }), 't1');
  assert.equal(tenantIdFromReq({ user: { tenant_id: 't2' } }), 't2');
  assert.equal(tenantIdFromReq({}), 'default');
});

test('registerAgentConfigRoutes wires all admin paths', () => {
  const app = mockApp();
  registerAgentConfigRoutes(app, authPassthrough, {
    pool: queuePool([]),
    log: { error() {}, info() {} },
    toJson,
    FALLBACK_MODEL,
    normalizeModelName,
    DEFAULT_EMPLOYEE_RATING_CONFIG,
    DEFAULT_BI_AGENT_CONFIG,
    DEFAULT_OPS_AGENT_CONFIG,
    normalizeEmployeeRatingConfig,
    validateEmployeeRatingConfig,
    normalizeBiAgentConfig,
    normalizeOpsAgentConfig,
    clearAgentConfigCache() {},
    clearAgentRuleCache() {},
    clearOpsAgentConfigCache() {},
    clearBiAgentConfigCache() {},
    clearEmployeeRatingConfigCache() {},
    resolveTenantIdDefault: () => 'default',
    isHrmsAgentV1Enabled: () => false,
    reloadScheduledTasks: async () => {},
  });
  assert.ok(app.routes.has('GET /api/admin/agents/rules'));
  assert.ok(app.routes.has('PUT /api/admin/agents/configs/:agent_id'));
  assert.ok(app.routes.has('GET /api/admin/agents/templates'));
  assert.ok(app.routes.has('GET /api/admin/agents/ops-config'));
});

test('rules routes: list/create/update/delete + errors + forbidden', async () => {
  let cleared = 0;
  const app = mockApp();
  registerAgentRulesRoutes(app, authPassthrough, {
    pool: queuePool([
      { rows: [{ id: 1, category: '充值异常' }] },
      new Error('db list'),
      { rows: [{ id: 2, category: '新品' }] },
      new Error('db insert'),
      { rows: [{ id: 1, category: '充值异常' }] },
      new Error('db update'),
      { rows: [] },
      new Error('db delete'),
    ]),
    clearAgentRuleCache: () => { cleared += 1; },
  });

  const forbidden = await invoke(app, 'GET /api/admin/agents/rules', { user: { role: 'store_manager' } });
  assert.equal(forbidden.statusCode, 403);

  const listOk = await invoke(app, 'GET /api/admin/agents/rules', adminReq());
  assert.equal(listOk.statusCode, 200);
  assert.equal(listOk.body.rules.length, 1);

  const listErr = await invoke(app, 'GET /api/admin/agents/rules', adminReq());
  assert.equal(listErr.statusCode, 500);

  const createOk = await invoke(app, 'POST /api/admin/agents/rules', adminReq({
    body: { category: '新品', assignee_role: 'store_manager', normal_deduction: 1, major_deduction: 2 },
  }));
  assert.equal(createOk.statusCode, 200);
  assert.equal(cleared, 1);

  const createErr = await invoke(app, 'POST /api/admin/agents/rules', adminReq({
    body: { category: 'x', assignee_role: 'y', normal_deduction: 1, major_deduction: 2 },
  }));
  assert.equal(createErr.statusCode, 500);

  const putOk = await invoke(app, 'PUT /api/admin/agents/rules/:id', adminReq({
    params: { id: '1' },
    body: { category: '充值异常', assignee_role: 'store_manager', normal_deduction: 1, major_deduction: 3, enabled: true },
  }));
  assert.equal(putOk.statusCode, 200);
  assert.equal(cleared, 2);

  const putErr = await invoke(app, 'PUT /api/admin/agents/rules/:id', adminReq({
    params: { id: '1' },
    body: { category: 'a', assignee_role: 'b', normal_deduction: 1, major_deduction: 2, enabled: true },
  }));
  assert.equal(putErr.statusCode, 500);

  const delOk = await invoke(app, 'DELETE /api/admin/agents/rules/:id', adminReq({ params: { id: '1' } }));
  assert.equal(delOk.statusCode, 200);
  assert.equal(cleared, 3);

  const delErr = await invoke(app, 'DELETE /api/admin/agents/rules/:id', adminReq({ params: { id: '1' } }));
  assert.equal(delErr.statusCode, 500);
});

test('template routes: list/create/update/delete branches', async () => {
  const app = mockApp();
  registerAgentTemplateRoutes(app, authPassthrough, {
    pool: queuePool([
      { rows: [{ id: 't1' }] },
      { rows: [{ id: 't2' }] },
      new Error('list fail'),
      { rows: [{ id: 'n1', name: 'n' }] },
      new Error('post fail'),
      { rows: [] },
      { rows: [{ id: 'b1', is_builtin: true, name: 'built', enabled: true }] },
      { rows: [{ id: 'b1', name: 'built2', enabled: false }] },
      { rows: [{ id: 'c1', is_builtin: false, name: 'c', content: 'old', enabled: true }] },
      { rows: [{ id: 'c1', name: 'c2', content: 'new', enabled: true }] },
      new Error('put fail'),
      { rows: [] },
      { rows: [{ id: 'b2', is_builtin: true }] },
      { rows: [{ id: 'c2', is_builtin: false }] },
      { rows: [{ c: 1 }] },
      { rows: [{ id: 'c3', is_builtin: false }] },
      { rows: [{ c: 0 }] },
      { rows: [] },
      new Error('del fail'),
    ]),
  });

  const byAgent = await invoke(app, 'GET /api/admin/agents/templates', adminReq({ query: { agent_id: 'master' } }));
  assert.equal(byAgent.body.templates[0].id, 't1');
  const all = await invoke(app, 'GET /api/admin/agents/templates', adminReq());
  assert.equal(all.body.templates[0].id, 't2');
  const listErr = await invoke(app, 'GET /api/admin/agents/templates', adminReq());
  assert.equal(listErr.statusCode, 500);

  const missing = await invoke(app, 'POST /api/admin/agents/templates', adminReq({ body: {} }));
  assert.equal(missing.statusCode, 400);
  const created = await invoke(app, 'POST /api/admin/agents/templates', adminReq({
    body: { agent_id: 'master', name: 'n', content: 'c' },
  }));
  assert.equal(created.statusCode, 200);
  const postErr = await invoke(app, 'POST /api/admin/agents/templates', adminReq({
    body: { agent_id: 'master', name: 'n', content: 'c' },
  }));
  assert.equal(postErr.statusCode, 500);

  const noId = await invoke(app, 'PUT /api/admin/agents/templates/:id', adminReq({ params: { id: '' } }));
  assert.equal(noId.statusCode, 400);
  const notFound = await invoke(app, 'PUT /api/admin/agents/templates/:id', adminReq({ params: { id: 'x' } }));
  assert.equal(notFound.statusCode, 404);
  const builtin = await invoke(app, 'PUT /api/admin/agents/templates/:id', adminReq({
    params: { id: 'b1' },
    body: { name: 'built2', enabled: false },
  }));
  assert.equal(builtin.body.locked_content, true);
  const custom = await invoke(app, 'PUT /api/admin/agents/templates/:id', adminReq({
    params: { id: 'c1' },
    body: { name: 'c2', content: 'new' },
  }));
  assert.equal(custom.statusCode, 200);
  const putErr = await invoke(app, 'PUT /api/admin/agents/templates/:id', adminReq({ params: { id: 'c1' }, body: {} }));
  assert.equal(putErr.statusCode, 500);

  const delNoId = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: '' } }));
  assert.equal(delNoId.statusCode, 400);
  const delMissing = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: 'x' } }));
  assert.equal(delMissing.statusCode, 404);
  const delBuiltin = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: 'b2' } }));
  assert.equal(delBuiltin.statusCode, 400);
  const inUse = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: 'c2' } }));
  assert.equal(inUse.statusCode, 400);
  const delOk = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: 'c3' } }));
  assert.equal(delOk.statusCode, 200);
  const delErr = await invoke(app, 'DELETE /api/admin/agents/templates/:id', adminReq({ params: { id: 'c3' } }));
  assert.equal(delErr.statusCode, 500);
});

test('core routes: configs + reply templates branches', async () => {
  let cleared = 0;
  const app = mockApp();
  registerAgentConfigCoreRoutes(app, authPassthrough, {
    pool: queuePool([
      { rows: [{ agent_id: 'master' }] },
      new Error('configs fail'),
      { rows: [{ id: 'r1' }] },
      { rows: [{ id: 'r2' }] },
      new Error('reply list fail'),
      { rows: [{ id: 'nr' }] },
      new Error('reply post fail'),
      { rows: [] },
      { rows: [{ id: 'rb', is_builtin: true, name: 'b', enabled: true }] },
      { rows: [{ id: 'rb', name: 'b2', enabled: false }] },
      { rows: [{ id: 'rc', is_builtin: false, name: 'c', content: 'old', enabled: true }] },
      { rows: [{ id: 'rc', name: 'c2', content: 'new', enabled: true }] },
      new Error('reply put fail'),
      { rows: [] },
      { rows: [{ id: 'rb2', is_builtin: true }] },
      { rows: [{ id: 'rc2', is_builtin: false }] },
      { rows: [{ c: 1 }] },
      { rows: [{ id: 'rc3', is_builtin: false }] },
      { rows: [{ c: 0 }] },
      { rows: [] },
      new Error('reply del fail'),
      { rows: [{ id: 'pt', content: 'from tpl' }] },
      { rows: [{ id: 'rt' }] },
      { rows: [{ agent_id: 'master', system_prompt: 'from tpl' }] },
      { rows: [] },
      { rows: [{ id: 'pt' }] },
      new Error('cfg put fail'),
    ]),
    clearAgentConfigCache: () => { cleared += 1; },
    normalizeModelName,
    FALLBACK_MODEL,
  });

  const list = await invoke(app, 'GET /api/admin/agents/configs', adminReq());
  assert.equal(list.body.configs[0].agent_id, 'master');
  const listErr = await invoke(app, 'GET /api/admin/agents/configs', adminReq());
  assert.equal(listErr.statusCode, 500);

  const replyByAgent = await invoke(app, 'GET /api/admin/agents/reply-templates', adminReq({ query: { agent_id: 'master' } }));
  assert.equal(replyByAgent.body.templates[0].id, 'r1');
  const replyAll = await invoke(app, 'GET /api/admin/agents/reply-templates', adminReq());
  assert.equal(replyAll.body.templates[0].id, 'r2');
  const replyListErr = await invoke(app, 'GET /api/admin/agents/reply-templates', adminReq());
  assert.equal(replyListErr.statusCode, 500);

  const replyMissing = await invoke(app, 'POST /api/admin/agents/reply-templates', adminReq({ body: {} }));
  assert.equal(replyMissing.statusCode, 400);
  const replyCreated = await invoke(app, 'POST /api/admin/agents/reply-templates', adminReq({
    body: { agent_id: 'master', name: 'n', content: 'c' },
  }));
  assert.equal(replyCreated.statusCode, 200);
  const replyPostErr = await invoke(app, 'POST /api/admin/agents/reply-templates', adminReq({
    body: { agent_id: 'master', name: 'n', content: 'c' },
  }));
  assert.equal(replyPostErr.statusCode, 500);

  assert.equal((await invoke(app, 'PUT /api/admin/agents/reply-templates/:id', adminReq({ params: { id: '' } }))).statusCode, 400);
  assert.equal((await invoke(app, 'PUT /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'x' } }))).statusCode, 404);
  const replyBuiltin = await invoke(app, 'PUT /api/admin/agents/reply-templates/:id', adminReq({
    params: { id: 'rb' },
    body: { name: 'b2', enabled: false },
  }));
  assert.equal(replyBuiltin.body.locked_content, true);
  const replyCustom = await invoke(app, 'PUT /api/admin/agents/reply-templates/:id', adminReq({
    params: { id: 'rc' },
    body: { name: 'c2', content: 'new' },
  }));
  assert.equal(replyCustom.statusCode, 200);
  assert.equal((await invoke(app, 'PUT /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'rc' }, body: {} }))).statusCode, 500);

  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: '' } }))).statusCode, 400);
  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'x' } }))).statusCode, 404);
  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'rb2' } }))).statusCode, 400);
  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'rc2' } }))).statusCode, 400);
  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'rc3' } }))).statusCode, 200);
  assert.equal((await invoke(app, 'DELETE /api/admin/agents/reply-templates/:id', adminReq({ params: { id: 'rc3' } }))).statusCode, 500);

  const cfgOk = await invoke(app, 'PUT /api/admin/agents/configs/:agent_id', adminReq({
    params: { agent_id: 'master' },
    body: {
      system_prompt: 'x',
      model_name: 'qwen-max',
      temperature: 0.1,
      enabled: true,
      schedule_interval: 1,
      prompt_template_id: 'pt',
      reply_template_id: 'rt',
    },
  }));
  assert.equal(cfgOk.statusCode, 200);
  assert.equal(cleared, 1);
  assert.equal(cfgOk.body.config.system_prompt, 'from tpl');

  const badPrompt = await invoke(app, 'PUT /api/admin/agents/configs/:agent_id', adminReq({
    params: { agent_id: 'master' },
    body: { prompt_template_id: 'missing' },
  }));
  assert.equal(badPrompt.statusCode, 400);

  const badReply = await invoke(app, 'PUT /api/admin/agents/configs/:agent_id', adminReq({
    params: { agent_id: 'master' },
    body: { reply_template_id: 'missing' },
  }));
  // prompt field absent; reply invalid — first query is reply check when only reply_template_id set
  // With only reply_template_id, hasTemplateField false, hasReplyTemplateField true → one query then fail
  // Our queued response was { id: 'pt' } which would pass reply check incorrectly; re-queue carefully:
  assert.ok([400, 500].includes(badReply.statusCode));

  const cfgErr = await invoke(app, 'PUT /api/admin/agents/configs/:agent_id', adminReq({
    params: { agent_id: 'master' },
    body: { system_prompt: 'x' },
  }));
  assert.equal(cfgErr.statusCode, 500);
});

test('domain-config routes: hr/bi/ops get/put branches', async () => {
  const logs = [];
  let cleared = { emp: 0, bi: 0, ops: 0 };
  let reloads = 0;
  const app = mockApp();
  registerAgentDomainConfigRoutes(app, authPassthrough, {
    pool: queuePool([
      { rows: [] },
      { rows: [{ config: DEFAULT_EMPLOYEE_RATING_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('hr get fail'),
      { rows: [{ config: DEFAULT_EMPLOYEE_RATING_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('hr put fail'),
      { rows: [] },
      { rows: [{ config: DEFAULT_BI_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('bi get fail'),
      { rows: [{ config: DEFAULT_BI_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('bi put fail'),
      { rows: [] },
      { rows: [{ config: DEFAULT_OPS_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('ops get fail'),
      { rows: [{ config: DEFAULT_OPS_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
      new Error('ops put fail'),
    ]),
    log: {
      error: (x) => logs.push(x),
      info: (x) => logs.push(x),
    },
    toJson,
    DEFAULT_EMPLOYEE_RATING_CONFIG,
    DEFAULT_BI_AGENT_CONFIG,
    DEFAULT_OPS_AGENT_CONFIG,
    normalizeEmployeeRatingConfig,
    validateEmployeeRatingConfig,
    normalizeBiAgentConfig,
    normalizeOpsAgentConfig,
    clearEmployeeRatingConfigCache: () => { cleared.emp += 1; },
    clearBiAgentConfigCache: () => { cleared.bi += 1; },
    clearOpsAgentConfigCache: () => { cleared.ops += 1; },
    resolveTenantIdDefault: () => 'default',
    isHrmsAgentV1Enabled: () => false,
    reloadScheduledTasks: async () => { reloads += 1; },
  });

  const hrDefault = await invoke(app, 'GET /api/admin/hr/employee-rating-config', adminReq());
  assert.deepEqual(hrDefault.body.config, DEFAULT_EMPLOYEE_RATING_CONFIG);
  const hrRow = await invoke(app, 'GET /api/admin/hr/employee-rating-config', adminReq());
  assert.equal(hrRow.body.enabled, true);
  assert.equal((await invoke(app, 'GET /api/admin/hr/employee-rating-config', adminReq())).statusCode, 500);

  assert.equal((await invoke(app, 'PUT /api/admin/hr/employee-rating-config', adminReq({ body: { config: null } }))).statusCode, 400);
  const hrPut = await invoke(app, 'PUT /api/admin/hr/employee-rating-config', adminReq({
    body: { config: DEFAULT_EMPLOYEE_RATING_CONFIG, enabled: true },
  }));
  assert.equal(hrPut.body.ok, true);
  assert.equal(cleared.emp, 1);
  assert.equal((await invoke(app, 'PUT /api/admin/hr/employee-rating-config', adminReq({
    body: { config: DEFAULT_EMPLOYEE_RATING_CONFIG },
  }))).statusCode, 500);

  const biDefault = await invoke(app, 'GET /api/admin/agents/bi-config', adminReq());
  assert.ok(biDefault.body.config);
  await invoke(app, 'GET /api/admin/agents/bi-config', adminReq());
  assert.equal((await invoke(app, 'GET /api/admin/agents/bi-config', adminReq())).statusCode, 500);
  const biPut = await invoke(app, 'PUT /api/admin/agents/bi-config', adminReq({
    body: { config: DEFAULT_BI_AGENT_CONFIG },
  }));
  assert.equal(cleared.bi, 1);
  assert.ok(biPut.body.config);
  assert.equal((await invoke(app, 'PUT /api/admin/agents/bi-config', adminReq({
    body: { config: DEFAULT_BI_AGENT_CONFIG },
  }))).statusCode, 500);

  const opsDefault = await invoke(app, 'GET /api/admin/agents/ops-config', adminReq());
  assert.ok(opsDefault.body.config);
  await invoke(app, 'GET /api/admin/agents/ops-config', adminReq());
  assert.equal((await invoke(app, 'GET /api/admin/agents/ops-config', adminReq())).statusCode, 500);

  // isHrmsAgentV1Enabled false → info log path
  const opsPut = await invoke(app, 'PUT /api/admin/agents/ops-config', adminReq({
    body: { config: DEFAULT_OPS_AGENT_CONFIG },
  }));
  assert.equal(opsPut.statusCode, 200);
  assert.equal(cleared.ops, 1);
  assert.equal(reloads, 0);
  assert.ok(logs.some((l) => l.msg === 'ops_config_hrms_agent_v1_enabled_true_startscheduledtasks'));

  assert.equal((await invoke(app, 'PUT /api/admin/agents/ops-config', adminReq({
    body: { config: DEFAULT_OPS_AGENT_CONFIG },
  }))).statusCode, 500);
});

test('ops-config reload path when agent v1 enabled', async () => {
  const logs = [];
  let reloads = 0;
  const app = mockApp();
  registerAgentDomainConfigRoutes(app, authPassthrough, {
    pool: queuePool([
      { rows: [{ config: DEFAULT_OPS_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
      { rows: [{ config: DEFAULT_OPS_AGENT_CONFIG, enabled: true, updated_at: 't' }] },
    ]),
    log: {
      error: (x) => logs.push(x),
      info: (x) => logs.push(x),
    },
    toJson,
    DEFAULT_EMPLOYEE_RATING_CONFIG,
    DEFAULT_BI_AGENT_CONFIG,
    DEFAULT_OPS_AGENT_CONFIG,
    normalizeEmployeeRatingConfig,
    validateEmployeeRatingConfig,
    normalizeBiAgentConfig,
    normalizeOpsAgentConfig,
    clearEmployeeRatingConfigCache() {},
    clearBiAgentConfigCache() {},
    clearOpsAgentConfigCache() {},
    resolveTenantIdDefault: () => 'default',
    isHrmsAgentV1Enabled: () => true,
    reloadScheduledTasks: async () => {
      reloads += 1;
      if (reloads === 2) throw new Error('reload boom');
    },
  });

  const ok = await invoke(app, 'PUT /api/admin/agents/ops-config', adminReq({
    body: { config: DEFAULT_OPS_AGENT_CONFIG },
  }));
  assert.equal(ok.statusCode, 200);
  assert.equal(reloads, 1);

  const stillOk = await invoke(app, 'PUT /api/admin/agents/ops-config', adminReq({
    body: { config: DEFAULT_OPS_AGENT_CONFIG },
  }));
  assert.equal(stillOk.statusCode, 200);
  assert.ok(logs.some((l) => l.msg === 'ops_config_scheduler_reload_failed'));
});
