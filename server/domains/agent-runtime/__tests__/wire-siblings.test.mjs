/**
 * Coverage for wire-*.js glue: mock every create* import, assert return keys.
 * Requires: node --experimental-test-module-mocks --test
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const wireHref = (name) => new URL(`../${name}`, import.meta.url).href;
/** Paths are relative to domains/ (sibling of agent-runtime/), matching wire-*.js imports. */
const depHref = (relFromDomains) => new URL(`../../${relFromDomains}`, import.meta.url).href;

function stubFn(name) {
  return () => name;
}

function mockCreate(moduleRel, namedExports) {
  mock.module(depHref(moduleRel), {
    cache: false,
    namedExports,
  });
}

async function loadWire(name) {
  return import(`${wireHref(name)}?t=${Date.now()}-${Math.random()}`);
}

test('wireAuditor wires auditor/ops/bi factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-auditor/table-visit-metrics.js', {
    createTableVisitMetricsApi: () => ({ kind: 'tableVisit' }),
  });
  mockCreate('agent-auditor/margin-metrics.js', {
    createMarginMetricsApi: () => ({ kind: 'margin' }),
  });
  mockCreate('agent-ops/audit-image.js', {
    createAuditImage: () => stubFn('auditImage'),
  });
  mockCreate('agent-ops/knowledge-support.js', {
    createGetOpsKnowledgeSupport: () => stubFn('knowledge'),
  });
  mockCreate('agent-auditor/run-data-auditor.js', {
    createRunDataAuditor: () => stubFn('runDataAuditor'),
  });
  mockCreate('agent-bi/run-bi-function-tool.js', {
    createRunBiFunctionTool: () => stubFn('runBiFunctionTool'),
  });

  const { wireAuditor } = await loadWire('wire-auditor.js');
  const bag = wireAuditor({});
  assert.equal(bag.tableVisitMetricsApi.kind, 'tableVisit');
  assert.equal(bag.marginMetricsApi.kind, 'margin');
  assert.equal(bag.auditImage(), 'auditImage');
  assert.equal(bag.getOpsKnowledgeSupport(), 'knowledge');
  assert.equal(bag.runDataAuditor(), 'runDataAuditor');
  assert.equal(bag.runBiFunctionTool(), 'runBiFunctionTool');
});

test('wireLlm wires LLM health + call factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('ai/llm-health-scheduler.js', {
    createLlmHealthSchedulerApi: () => ({ kind: 'health' }),
  });
  mockCreate('ai/tenant-llm-config.js', {
    createTenantLlmConfigCache: () => ({
      resolveTenantLlmConfig: stubFn('resolve'),
      invalidateTenantLlmConfigCache: stubFn('invalidate'),
    }),
  });
  mockCreate('ai/load-tenant-ai-config.js', {
    createLoadTenantAiConfig: () => stubFn('loadTenant'),
  });
  mockCreate('ai/call-llm.js', {
    createCallLLM: () => stubFn('callLLM'),
  });
  mockCreate('ai/call-vision-llm.js', {
    createCallVisionLLM: () => stubFn('vision'),
    createCallVisionLLMVideo: () => stubFn('visionVideo'),
  });

  const { wireLlm } = await loadWire('wire-llm.js');
  const bag = wireLlm({});
  assert.equal(bag.llmHealthSchedulerApi.kind, 'health');
  assert.equal(bag.invalidateTenantLlmConfigCache(), 'invalidate');
  assert.equal(bag.callLLM(), 'callLLM');
  assert.equal(bag.callVisionLLM(), 'vision');
  assert.equal(bag.callVisionLLMVideo(), 'visionVideo');
});

test('wireBi wires BI query + deterministic reply factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-bi/bi-query-helpers.js', {
    createBiQueryHelpersApi: () => ({ kind: 'helpers' }),
  });
  mockCreate('agent-bi/function-calling-support.js', {
    createBiFunctionCallingSupport: () => ({
      narrateBiToolResult: stubFn('n'),
      pushBiConversationTurn: stubFn('p'),
      getBiConversationHistory: stubFn('h'),
      buildBiIntentPlan: stubFn('i'),
      BI_FUNCTION_TOOLS: [],
      parseToolArgs: stubFn('a'),
    }),
  });
  mockCreate('agent-bi/try-handle-bi-by-function-calling.js', {
    createTryHandleBiByFunctionCalling: () => stubFn('tryFc'),
  });
  mockCreate('agent-bi/build-daily-report-reply.js', {
    createBuildBiDeterministicDailyReportReply: () => stubFn('daily'),
  });
  mockCreate('agent-bi/build-sales-raw-top-reply.js', {
    createBuildBiDeterministicSalesRawTopReply: () => stubFn('sales'),
  });
  mockCreate('agent-bi/build-bad-review-report-reply.js', {
    createBuildBiDeterministicBadReviewReportReply: () => stubFn('bad'),
  });
  mockCreate('agent-bi/deterministic-cascade-replies.js', {
    createDeterministicCascadeReplies: () => ({
      buildBiDeterministicDataSourceCoverageReply: stubFn('cov'),
      buildBiDeterministicTableVisitReply: stubFn('tv'),
      buildBiDeterministicOpsReportCountReply: stubFn('ops'),
      buildBiDeterministicClosingReportReply: stubFn('close'),
      buildBiDeterministicOpeningReportReply: stubFn('open'),
      buildBiDeterministicMaterialReportReply: stubFn('mat'),
      buildBiDeterministicMeetingReportReply: stubFn('meet'),
      buildBiDeterministicLossReportReply: stubFn('loss'),
    }),
  });

  const { wireBi } = await loadWire('wire-bi.js');
  const bag = wireBi({});
  assert.equal(bag.biQueryHelpersApi.kind, 'helpers');
  assert.equal(bag.tryHandleBiByFunctionCalling(), 'tryFc');
  assert.equal(bag.buildBiDeterministicDailyReportReply(), 'daily');
  assert.equal(bag.buildBiDeterministicTableVisitReply(), 'tv');
  assert.equal(bag.buildBiDeterministicLossReportReply(), 'loss');
});

test('wireMessage wires message pipeline factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-message/handle-data-auditor-case.js', {
    createHandleDataAuditorCase: () => stubFn('dac'),
  });
  mockCreate('agent-message/agent-quality-autonomy.js', {
    createAgentQualityAutonomyApi: () => ({ kind: 'qa' }),
  });
  mockCreate('agent-message/route-message.js', {
    createRouteMessage: () => stubFn('route'),
  });
  mockCreate('agent-message/check-agent-quality.js', {
    createCheckAgentQualityApi: () => ({ kind: 'check' }),
  });
  mockCreate('agent-message/handle-agent-message.js', {
    createHandleAgentMessage: () => stubFn('ham'),
  });

  const { wireMessage } = await loadWire('wire-message.js');
  const bag = wireMessage({});
  assert.equal(bag.handleDataAuditorCase(), 'dac');
  assert.equal(bag.agentQualityAutonomyApi.kind, 'qa');
  assert.equal(bag.routeMessage(), 'route');
  assert.equal(bag.checkAgentQualityApi.kind, 'check');
  assert.equal(bag.handleAgentMessage(), 'ham');
});

test('wireBitable wires bitable factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('feishu-bitable/archive-old-submissions.js', {
    createArchiveOldBitableSubmissions: () => stubFn('archive'),
  });
  mockCreate('feishu-bitable/bitable-records-client.js', {
    createBitableRecordsClient: () => ({ kind: 'client' }),
  });
  mockCreate('feishu-bitable/process-bitable-data.js', {
    createProcessBitableData: () => stubFn('process'),
  });
  mockCreate('feishu-bitable/get-submission-stats.js', {
    createGetBitableSubmissionStats: () => stubFn('stats'),
  });
  mockCreate('agent-ops/submission-validation.js', {
    createOpsSubmissionValidation: () => ({
      extractScore: stubFn('score'),
      validatePhotoAuthenticity: stubFn('photo'),
      validateSubmissionLogic: stubFn('logic'),
    }),
  });
  mockCreate('feishu-bitable/poll-submissions.js', {
    createPollBitableSubmissions: () => stubFn('poll'),
  });

  const { wireBitable } = await loadWire('wire-bitable.js');
  const bag = wireBitable({});
  assert.equal(bag.archiveOldBitableSubmissions(), 'archive');
  assert.equal(bag.bitableRecordsClient.kind, 'client');
  assert.equal(bag.processBitableData(), 'process');
  assert.equal(bag.getBitableSubmissionStats(), 'stats');
  assert.equal(bag.pollBitableSubmissions(), 'poll');
});

test('wireScheduler wires scheduler factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-ops/scheduled-task-runtime.js', {
    createScheduledTaskRuntimeApi: () => ({ scheduledTaskRuntimeStatus: { ok: 1 } }),
  });
  mockCreate('agent-ops/build-scheduled-tasks-from-config.js', {
    createBuildScheduledTasksFromConfig: () => stubFn('build'),
  });
  mockCreate('agent-ops/execute-scheduled-task.js', {
    createExecuteScheduledTask: () => stubFn('exec'),
  });
  mockCreate('agent-ops/send-safety-check.js', {
    createSendSafetyCheck: () => stubFn('safety'),
  });
  mockCreate('agent-evaluator/fetch-store-rating-for-profile.js', {
    createFetchStoreRatingForProfileDisplay: () => stubFn('rating'),
  });
  mockCreate('agent-evaluator/run-chief-evaluator.js', {
    createRunChiefEvaluator: () => stubFn('chief'),
  });
  mockCreate('agent-ops/send-scheduled-checklist.js', {
    createSendScheduledChecklist: () => stubFn('checklist'),
  });

  const { wireScheduler } = await loadWire('wire-scheduler.js');
  const bag = wireScheduler({});
  assert.equal(bag.scheduledTaskRuntimeApi.scheduledTaskRuntimeStatus.ok, 1);
  assert.equal(bag.buildScheduledTasksFromConfig(), 'build');
  assert.equal(bag.executeScheduledTask(), 'exec');
  assert.equal(bag.sendSafetyCheck(), 'safety');
  assert.equal(bag.fetchStoreRatingForProfileDisplay(), 'rating');
  assert.equal(bag.runChiefEvaluator(), 'chief');
  assert.equal(bag.sendScheduledChecklist(), 'checklist');
});

test('wireOpsChecklist wires ops-checklist factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-ops/checklist-cards.js', {
    createOpsChecklistCardsApi: () => ({ opsChecklistProgress: { p: 1 } }),
  });
  mockCreate('agent-ops/capture-checklist-detail.js', {
    createTryCaptureOpsChecklistDetailFromChat: () => stubFn('capture'),
  });
  mockCreate('agent-ops/follow-up-overdue-tasks.js', {
    createFollowUpOverdueTasks: () => stubFn('follow'),
  });
  mockCreate('agent-ops/handle-checklist-card-action.js', {
    createHandleOpsChecklistCardAction: () => stubFn('action'),
  });

  const { wireOpsChecklist } = await loadWire('wire-ops-checklist.js');
  const bag = wireOpsChecklist({});
  assert.equal(bag.opsChecklistProgress.p, 1);
  assert.equal(bag.tryCaptureOpsChecklistDetailFromChat(), 'capture');
  assert.equal(bag.followUpOverdueTasks(), 'follow');
  assert.equal(bag.handleOpsChecklistCardAction(), 'action');
});

test('wireFeishu wires feishu bot factories', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  mockCreate('agent-message/marketing-copy.js', {
    createTryFeishuMarketingCopyRound: () => stubFn('mkt'),
  });
  mockCreate('agent-feishu-bot/push-issues.js', {
    createPushIssuesToFeishu: () => stubFn('push'),
  });
  mockCreate('agent-feishu-bot/feishu-user-messaging.js', {
    createFeishuUserMessagingApi: () => ({ kind: 'msg' }),
  });
  mockCreate('agent-bi/send-period-reports.js', {
    createSendPeriodReportsApi: () => ({ kind: 'period' }),
  });
  mockCreate('agent-feishu-bot/on-feishu-event.js', {
    createOnFeishuEvent: () => stubFn('event'),
  });

  const { wireFeishu } = await loadWire('wire-feishu.js');
  const bag = wireFeishu({});
  assert.equal(bag.tryFeishuMarketingCopyRound(), 'mkt');
  assert.equal(bag.pushIssuesToFeishu(), 'push');
  assert.equal(bag.feishuUserMessagingApi.kind, 'msg');
  assert.equal(bag.sendPeriodReportsApi.kind, 'period');
  assert.equal(bag.onFeishuEvent(), 'event');
});
