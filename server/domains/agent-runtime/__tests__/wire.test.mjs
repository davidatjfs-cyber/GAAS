/**
 * wireAgentsRuntime merges sibling wire-* bags.
 * Requires: node --experimental-test-module-mocks --test
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const sibling = (name) => new URL(`../${name}`, import.meta.url).href;

test('wireAgentsRuntime merges keys from every wire-* sibling', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }

  mock.module(sibling('wire-auditor.js'), {
    cache: false,
    namedExports: { wireAuditor: () => ({ tableVisitMetricsApi: { k: 'a' }, runDataAuditor: () => {} }) },
  });
  mock.module(sibling('wire-llm.js'), {
    cache: false,
    namedExports: { wireLlm: () => ({ llmHealthSchedulerApi: { k: 'l' }, agentQualityAutonomyApi: {} }) },
  });
  mock.module(sibling('wire-bi.js'), {
    cache: false,
    namedExports: { wireBi: () => ({ biQueryHelpersApi: { k: 'b' }, tryHandleBiByFunctionCalling: () => {} }) },
  });
  mock.module(sibling('wire-message.js'), {
    cache: false,
    namedExports: { wireMessage: () => ({ routeMessage: () => {}, handleAgentMessage: () => {} }) },
  });
  mock.module(sibling('wire-bitable.js'), {
    cache: false,
    namedExports: { wireBitable: () => ({ processBitableData: () => {}, pollBitableSubmissions: () => {} }) },
  });
  mock.module(sibling('wire-scheduler.js'), {
    cache: false,
    namedExports: { wireScheduler: () => ({ executeScheduledTask: () => {}, sendSafetyCheck: () => {} }) },
  });
  mock.module(sibling('wire-ops-checklist.js'), {
    cache: false,
    namedExports: { wireOpsChecklist: () => ({ handleOpsChecklistCardAction: () => {} }) },
  });
  mock.module(sibling('wire-feishu.js'), {
    cache: false,
    namedExports: { wireFeishu: () => ({ larkSendApi: { k: 'f' }, notifyBitablePipelineFailure: () => {} }) },
  });

  const { wireAgentsRuntime } = await import(sibling('wire.js'));
  const bag = wireAgentsRuntime({});
  assert.equal(bag.tableVisitMetricsApi.k, 'a');
  assert.equal(bag.biQueryHelpersApi.k, 'b');
  assert.equal(bag.larkSendApi.k, 'f');
  assert.equal(typeof bag.routeMessage, 'function');
  assert.equal(typeof bag.processBitableData, 'function');
  assert.equal(typeof bag.executeScheduledTask, 'function');
  assert.equal(typeof bag.handleOpsChecklistCardAction, 'function');
});
