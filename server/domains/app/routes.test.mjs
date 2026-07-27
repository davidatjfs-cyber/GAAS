import test from 'node:test';
import assert from 'node:assert/strict';
import { registerApplicationRoutes } from './routes.js';

const expectedRegistrars = [
  'registerAuthRoutes', 'registerAiChatCompletionsRoutes', 'registerApprovalRoutes',
  'registerApprovalLifecycleRoutes', 'registerApprovalDecideRoutes', 'registerPayrollDomainRoutes',
  'registerEmployeesDomainRoutes', 'registerFlowConfigRoutes', 'registerStoresDomainRoutes',
  'registerStoresCrudRoutes', 'registerBrandsRoutes', 'registerPaymentConfigRoutes',
  'registerPaymentRoutes', 'registerPermissionGroupsRoutes', 'registerUploadRoutes',
  'registerOpsTasksRoutes', 'registerStoreDutyBindingsRoutes', 'registerReadsRoutes',
  'registerAttentionScoresRoutes', 'registerAnnouncementExtraRoutes', 'registerNotificationsWriteRoutes',
  'registerBirthdayRoutes', 'registerExamResultsRoutes', 'registerTenantSettingsRoutes',
  'registerUsageWeeklyRoutes', 'registerWecomCallbackRoutes', 'registerPromotionTracksRoutes',
  'registerBitableSyncRoutes', 'registerRagRoutes', 'registerFeishuSyncRoutes',
  'registerBitableAdminRoutes', 'registerPerfAdminRoutes', 'registerMetricsAdminRoutes',
  'registerDedupRoutes', 'registerAdminOpsRoutes', 'registerDiagnosisFeedbackRoutes',
  'registerAgentDataRoutes', 'registerFeishuWebhookRoutes', 'registerRemainingStateRoutes',
  'registerGmMailboxRoutes', 'registerAgentDataCenterRoutes', 'registerAgentOpsRoutes',
  'registerAgentRecordsRoutes', 'registerAgentTriggersRoutes', 'registerAgentFeishuBotRoutes',
  'registerAgentRoutes', 'registerAgentConfigRoutes', 'registerMasterRoutes',
  'registerNewScoringRoutes', 'registerPerformanceInvalidationRoutes', 'registerHRMSApiRoutes',
  'registerSOPDistributionRoutes', 'registerKitchenExecutionRoutes', 'registerRecipeRoutes',
  'registerTrainingRoutes', 'registerUploadStatusRoute', 'app.use',
];

test('registerApplicationRoutes keeps registrar order', () => {
  const calls = [];
  const recorder = (name) => (..._args) => calls.push(name);
  const deps = Object.fromEntries(
    expectedRegistrars
      .filter((name) => name.startsWith('register'))
      .map((name) => [name, recorder(name)])
  );
  deps.createMirrorReconcileScheduler = () => ({ startMirrorReconcileScheduler() {} });
  deps.leaveAttendanceHelpers = {
    calcDateSpanDaysInclusive() {},
    runLeaveCumulativeCloseSnapshotForClosedMonth() {},
  };
  const app = { use: recorder('app.use') };

  registerApplicationRoutes(app, deps);

  assert.deepEqual(calls, expectedRegistrars);
});
