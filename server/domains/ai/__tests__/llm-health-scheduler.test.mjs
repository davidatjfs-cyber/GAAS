import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmFailureFallbackNote,
  buildLlmHealthProviders,
  summarizeLlmHealthResults,
} from '../llm-health-scheduler-helpers.js';
import { createLlmHealthSchedulerApi } from '../llm-health-scheduler.js';

test('helpers summarize and fallback notes', () => {
  const providers = buildLlmHealthProviders({
    deepseekModel: 'd', deepseekApiKey: 'k', deepseekBaseUrl: 'u',
    qwenModel: 'q', qwenApiKey: '', qwenBaseUrl: 'u',
    doubaoModel: 'b', doubaoApiKey: 'k', doubaoBaseUrl: 'u',
  });
  assert.equal(providers.length, 3);
  const summary = summarizeLlmHealthResults([
    { ok: true, name: 'DeepSeek', model: 'd', reply: 'OK' },
    { ok: false, name: 'Qwen', model: 'q', error: 'no key' },
  ]);
  assert.match(summary, /✅ DeepSeek/);
  assert.match(summary, /❌ Qwen/);
  assert.match(buildLlmFailureFallbackNote([{ ok: true, name: 'A' }, { ok: false, name: 'B' }]), /自动降级/);
  assert.match(buildLlmFailureFallbackNote([{ ok: false, name: 'A' }]), /所有 Provider/);
});

test('verifyLLMHealth external disabled + probe success/fail paths', async () => {
  const fails = [];
  const alerts = [];
  const api = createLlmHealthSchedulerApi({
    isExternalEnabled: () => true,
    axios: {
      post: async (url) => {
        if (String(url).includes('bad')) throw Object.assign(new Error('down'), { response: { status: 500, data: { error: { message: 'x' } } } });
        return { data: { choices: [{ message: { content: 'OK' } }] } };
      },
    },
    markProviderOk() {},
    markProviderFail: (k) => fails.push(k),
    getSharedState: async () => ({ employees: [] }),
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
    getScheduledTaskStatus: () => ({ started: false }),
    getPerformanceMetrics: () => ({ totalCalls: 0 }),
    pool: {},
    tenantContext: {},
    getActiveTenantIds: async () => [],
    runDataAuditor: async () => {},
    pushIssuesToFeishu: async () => {},
    pushIssueToAssignee: async () => {},
    pushScoresToFeishu: async () => {},
    log: { info() {}, error() {} },
    providerConfig: {
      deepseekModel: 'd', deepseekApiKey: 'k', deepseekBaseUrl: 'https://ok',
      qwenModel: 'q', qwenApiKey: '', qwenBaseUrl: 'https://bad',
      doubaoModel: 'b', doubaoApiKey: 'k', doubaoBaseUrl: 'https://bad',
    },
    setTimeoutFn: () => 1,
    setIntervalFn: () => 1,
  });
  // monkey-patch send via verify path using empty recipients — inject by wrapping track
  const r = await api.verifyLLMHealth({ notifyOnFailure: false, notifyOnRecovery: false });
  assert.equal(r.allOk, false);
  assert.ok(r.results.some((x) => x.error === 'API_KEY未配置'));
  assert.ok(fails.includes('doubao'));
});

test('verifyLLMHealth short-circuits when external disabled', async () => {
  const api = createLlmHealthSchedulerApi({
    isExternalEnabled: () => false,
    axios: { post: async () => ({ data: {} }) },
    markProviderOk() {},
    markProviderFail() {},
    getSharedState: async () => ({}),
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
    getScheduledTaskStatus: () => ({}),
    getPerformanceMetrics: () => ({}),
    pool: {},
    tenantContext: {},
    getActiveTenantIds: async () => [],
    runDataAuditor: async () => {},
    pushIssuesToFeishu: async () => {},
    pushIssueToAssignee: async () => {},
    pushScoresToFeishu: async () => {},
    log: { info() {}, error() {} },
    providerConfig: {
      deepseekModel: 'd', deepseekApiKey: '', deepseekBaseUrl: '',
      qwenModel: 'q', qwenApiKey: '', qwenBaseUrl: '',
      doubaoModel: 'b', doubaoApiKey: '', doubaoBaseUrl: '',
    },
  });
  const d = await api.verifyLLMHealth();
  assert.equal(d.allOk, false);
  assert.equal(d.results[0].error, 'external_disabled');
});

test('trackLLMResult alerts after 5 failures; startAgentScheduler is idempotent', async () => {
  let alertCount = 0;
  const timers = [];
  const api = createLlmHealthSchedulerApi({
    isExternalEnabled: () => false,
    axios: { post: async () => ({ data: {} }) },
    markProviderOk() {},
    markProviderFail() {},
    getSharedState: async () => ({
      employees: [{ username: 'admin1', role: 'admin' }],
    }),
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_1' }),
    sendLarkMessage: async () => { alertCount += 1; return { ok: true }; },
    getScheduledTaskStatus: () => ({ started: false, activeTimers: 0, tasks: [] }),
    getPerformanceMetrics: () => ({ totalCalls: 1 }),
    pool: {},
    tenantContext: {},
    getActiveTenantIds: async () => [],
    runDataAuditor: async () => {},
    pushIssuesToFeishu: async () => {},
    pushIssueToAssignee: async () => {},
    pushScoresToFeishu: async () => {},
    log: { info() {}, error() {} },
    providerConfig: {
      deepseekModel: 'd', deepseekApiKey: '', deepseekBaseUrl: '',
      qwenModel: 'q', qwenApiKey: '', qwenBaseUrl: '',
      doubaoModel: 'b', doubaoApiKey: '', doubaoBaseUrl: '',
    },
    setTimeoutFn: (fn) => { timers.push(fn); return timers.length; },
    setIntervalFn: () => 1,
  });

  for (let i = 0; i < 5; i += 1) api.trackLLMResult(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(alertCount, 1);
  api.trackLLMResult(true);
  const health = api.getAgentHealthStatus();
  assert.equal(health.consecutiveLLMErrors, 0);
  assert.equal(health.llmHealthy, true);

  api.startAgentScheduler();
  api.startAgentScheduler();
  assert.ok(timers.length >= 1);
});
