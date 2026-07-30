/**
 * HTTP route registration assembly. Dependencies are injected from index.js so
 * this module never imports the application entry point. Registration order is
 * intentionally identical to the former index.js sequence.
 */

export function registerIdentityAndApprovalRoutes(deps) {
  const {
    registerAuthRoutes, registerAiChatCompletionsRoutes, registerApprovalRoutes, registerApprovalLifecycleRoutes, registerApprovalDecideRoutes, app, authRequired, loginRateLimit, pool, JWT_SECRET, DATABASE_URL, getSharedState, normalizeRoleForJwt, normalizeUsersTableRole, employeeAccountShouldDisable, getUserStoreAccessContext, pickMyStoreFromState, recordLogin, recordLogout, storeSessionNonce, loadTenantRuntimeStatus, saveSharedState, stateOrDbFindUserRecord, normalizeApprovalType, safeDateOnly, scheduleLeaveDomainSync, mergeSharedStateFields, hrmsNowISO, makeNotif, addStateNotification, appendNotifications, stateFindUserRecord, pickAdminUsername, pickHqManagerUsername, pickCashierUsername, pickHrManagerUsername, approvalTypeLabel, safeNumber, uniqUsernames, lookupFeishuUserByUsername, sendLarkMessage, getPaymentFlowForStore, pickStoreRoleUsernameByStore, isKitchenByRoleOrPosition, resolveDutyApproverForStore, safeErrMessage, safeBizMonth, shanghaiTodayDateOnly, toNullableUuid, randomUUID, buildOnboardingEmployeeRecordFromPayload, createTrainingAssignment, applyPromotionSalaryNextMonth, insertSalaryTimeline, findUserSalary, upsertPayrollLedgerEntry, resolveAttendancePayrollRules, getPromotionRequiredTopics, getPromotionTrackProgress, normalizePromotionTrainingPeriods, leaveAttendanceHelpers, notifyAdminsDualWriteFailure, bcrypt
  } = deps;

registerAuthRoutes(app, authRequired, loginRateLimit, {
  pool,
  JWT_SECRET,
  DATABASE_URL,
  getSharedState,
  normalizeRoleForJwt,
  normalizeUsersTableRole,
  employeeAccountShouldDisable,
  getUserStoreAccessContext,
  pickMyStoreFromState,
  recordLogin,
  recordLogout,
  storeSessionNonce,
  loadTenantRuntimeStatus,
});

registerAiChatCompletionsRoutes(app, authRequired);

registerApprovalRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  stateOrDbFindUserRecord,
  pickMyStoreFromState,
  normalizeApprovalType,
  safeDateOnly,
  scheduleLeaveDomainSync,
});

registerApprovalLifecycleRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  mergeSharedStateFields,
  hrmsNowISO,
  makeNotif,
  addStateNotification,
  appendNotifications,
  stateFindUserRecord,
  stateOrDbFindUserRecord,
  normalizeApprovalType,
  normalizeRoleForJwt,
  pickAdminUsername,
  pickHqManagerUsername,
  pickCashierUsername,
  pickHrManagerUsername,
  approvalTypeLabel,
  safeDateOnly,
  safeNumber,
  uniqUsernames,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getPaymentFlowForStore,
  pickStoreRoleUsernameByStore,
  isKitchenByRoleOrPosition,
  resolveDutyApproverForStore,
});

registerApprovalDecideRoutes(app, authRequired, {
  pool,
  hrmsNowISO,
  makeNotif,
  appendNotifications,
  getSharedState,
  mergeSharedStateFields,
  stateFindUserRecord,
  uniqUsernames,
  safeDateOnly,
  safeNumber,
  safeErrMessage,
  safeBizMonth,
  shanghaiTodayDateOnly,
  toNullableUuid,
  randomUUID,
  buildOnboardingEmployeeRecordFromPayload,
  createTrainingAssignment,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
  findUserSalary,
  upsertPayrollLedgerEntry,
  resolveAttendancePayrollRules,
  getPromotionRequiredTopics,
  getPromotionTrackProgress,
  normalizePromotionTrainingPeriods,
  approvalTypeLabel,
  calcDateSpanDaysInclusive: leaveAttendanceHelpers.calcDateSpanDaysInclusive,
  isKitchenByRoleOrPosition,
  pickHqManagerUsername,
  pickStoreRoleUsernameByStore,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  notifyAdminsDualWriteFailure,
  bcrypt,
});


}

export function registerOperationsDomainRoutes(deps) {
  const {
    registerPayrollDomainRoutes, registerEmployeesDomainRoutes, createMirrorReconcileScheduler, registerFlowConfigRoutes, registerStoresDomainRoutes, registerStoresCrudRoutes, registerBrandsRoutes, registerPaymentConfigRoutes, registerPaymentRoutes, registerPermissionGroupsRoutes, registerUploadRoutes, registerOpsTasksRoutes, registerStoreDutyBindingsRoutes, registerReadsRoutes, registerAttentionScoresRoutes, registerAnnouncementExtraRoutes, registerNotificationsWriteRoutes, app, authRequired, pool, resolveTenantIdDefault, applyHrmsUserAccountGateFromEmployee, upload, recordUploadOwnership, uploadsDir, getActiveTenantIds, notifyAdminsDualWriteFailure, reconcileEmployeesMirrorAllTenants, reconcileFlowConfigMirrorAllTenants, checkStateOnlyDomainsIntegrityAllTenants, getSharedState, saveSharedState, invalidateSharedStateCache, getCreditRisk, hrmsNowISO, normalizeBrandId, getBrandsFromState, safeMonthOnly, safeDateOnly, safeUuid, safeNumber, mergeSharedStateFields, normalizeOpsRole, buildOpsFeedback, stateFindUserRecord, dbFindEmployeeRecord, employeeAccountShouldDisable
  } = deps;

registerPayrollDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerEmployeesDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
  applyAccountGate: applyHrmsUserAccountGateFromEmployee,
  upload,
  recordUploadOwnership,
  uploadsDir,
  resolveTenantIdDefault,
});

// 表权威 vs hrms_state 镜像日对账 + state-only 三域形状日检（见 mirror-reconcile-scheduler）
{
  const { startMirrorReconcileScheduler } = createMirrorReconcileScheduler({
    pool,
    getActiveTenantIds,
    notifyAdminsDualWriteFailure,
    reconcileEmployeesMirrorAllTenants,
    reconcileFlowConfigMirrorAllTenants,
    checkStateOnlyDomainsIntegrityAllTenants,
  });
  startMirrorReconcileScheduler();
}

registerFlowConfigRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
  getSharedState,
  invalidateSharedStateCache,
});

registerStoresDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerStoresCrudRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  resolveTenantIdDefault,
  getCreditRisk,
  hrmsNowISO,
  normalizeBrandId,
  getBrandsFromState,
});

registerBrandsRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  hrmsNowISO,
  normalizeBrandId,
  getBrandsFromState,
});

registerPaymentConfigRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerPaymentRoutes(app, authRequired, {
  pool,
  getSharedState,
  hrmsNowISO,
  safeMonthOnly,
  safeDateOnly,
  safeUuid,
  safeNumber,
});

registerPermissionGroupsRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  mergeSharedStateFields,
});

registerUploadRoutes(app, authRequired, {
  upload,
  recordUploadOwnership,
  pool,
  uploadsDir,
});

registerOpsTasksRoutes(app, authRequired, {
  pool,
  safeDateOnly,
  normalizeOpsRole,
  buildOpsFeedback,
});

registerStoreDutyBindingsRoutes(app, authRequired, { pool });

registerReadsRoutes(app, authRequired, {
  pool,
  getSharedState,
  stateFindUserRecord,
  dbFindEmployeeRecord,
});

registerAttentionScoresRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantIdDefault,
});

registerAnnouncementExtraRoutes(app, authRequired, {
  getSharedState,
  mergeSharedStateFields,
  employeeAccountShouldDisable,
});

registerNotificationsWriteRoutes(app, authRequired, {
  pool,
  resolveTenantIdDefault,
});


}

export function registerIntegrationDomainRoutes(deps) {
  const {
    registerBirthdayRoutes, registerExamResultsRoutes, registerTenantSettingsRoutes, registerUsageWeeklyRoutes, registerWecomCallbackRoutes, registerPromotionTracksRoutes, registerBitableSyncRoutes, registerRagRoutes, registerFeishuSyncRoutes, registerBitableAdminRoutes, registerPerfAdminRoutes, registerMetricsAdminRoutes, registerDedupRoutes, registerAdminOpsRoutes, registerDiagnosisFeedbackRoutes, registerAgentDataRoutes, registerFeishuWebhookRoutes, app, authRequired, getSharedState, saveSharedState, mergeSharedStateFields, invalidateSharedStateCache, isInactiveStatus, employeeAccountShouldDisable, addStateNotification, makeNotif, hrmsNowISO, pickAdminUsername, pickHrManagerUsername, stateFindUserRecord, pool, axios, getAgentsServiceBaseUrl, getAgentsServiceAdminToken, getPromotionTrackProgress, ragStats, ragQuery, ragMultiQuery, safeErrMessage, getFeishuAccessToken, getFeishuBitableData, findConfigKeyByTableInfo, upsertFeishuGenericRecord, mapFeishuFieldToHrms, upsertTableVisitRecordFromMapped, notifyAdminsDualWriteFailure, syncDishLibraryCosts, syncSopSteps, lookupFeishuUserByUsername, sendLarkMessage, getBitableSubmissionStats, archiveOldBitableSubmissions, getLastCompletedWeekRangeShanghai, sendWeeklyDishOptimizationReport, updateMetricVersion, canAccessDailyAttendanceRegister, safeDateOnly, safeMonthOnly, backfillDailyAttendanceRegisterMissing, leaveAttendanceHelpers, runSalesRawFolderImportOnce, normalizeRoleForJwt, loadEmployeesFromTable, sendAdminSystemAlert, recordAiFeedback, createFeishuBitableRecord, express, isWebhookEnabled, tryParseJson, verifyFeishuWebhookRequest, requireWebhookSignature, decryptFeishuEncryptPayload, resolveWebhookTenantId, tenantContext, randomUUID, onFeishuEvent, resolveTenantIdDefault, loadTenantFeishuBitableConfig, getFeishuTokenByConfig
  } = deps;

registerBirthdayRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  isInactiveStatus,
  employeeAccountShouldDisable,
  addStateNotification,
  makeNotif,
  hrmsNowISO,
  pickAdminUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
});

registerExamResultsRoutes(app, authRequired, { pool, invalidateSharedStateCache });

registerTenantSettingsRoutes(app, authRequired, {
  axios,
  getAgentsServiceBaseUrl,
  getAgentsServiceAdminToken,
});

registerUsageWeeklyRoutes(app, authRequired, { pool });

registerWecomCallbackRoutes(app);

registerPromotionTracksRoutes(app, authRequired, {
  getSharedState,
  stateFindUserRecord,
  getPromotionTrackProgress,
  pool,
  mergeSharedStateFields,
  hrmsNowISO,
});

registerBitableSyncRoutes(app, authRequired, { pool });

registerRagRoutes(app, authRequired, {
  getSharedState,
  ragStats,
  ragQuery,
  ragMultiQuery,
});

registerFeishuSyncRoutes(app, authRequired, {
  pool,
  safeErrMessage,
  getFeishuAccessToken,
  getFeishuBitableData,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
  mapFeishuFieldToHrms,
  upsertTableVisitRecordFromMapped,
  notifyAdminsDualWriteFailure,
  syncDishLibraryCosts,
  syncSopSteps,
  lookupFeishuUserByUsername,
  sendLarkMessage,
});

registerBitableAdminRoutes(app, authRequired, {
  getBitableSubmissionStats,
  archiveOldBitableSubmissions,
});

registerPerfAdminRoutes(app, authRequired, {
  getLastCompletedWeekRangeShanghai,
  sendWeeklyDishOptimizationReport,
});

registerMetricsAdminRoutes(app, authRequired, {
  pool,
  updateMetricVersion,
});

registerDedupRoutes(app, authRequired, { pool });

registerAdminOpsRoutes(app, authRequired, {
  pool,
  canAccessDailyAttendanceRegister,
  safeDateOnly,
  safeMonthOnly,
  safeErrMessage,
  backfillDailyAttendanceRegisterMissing,
  runLeaveCumulativeCloseSnapshotForClosedMonth: leaveAttendanceHelpers.runLeaveCumulativeCloseSnapshotForClosedMonth,
  runSalesRawFolderImportOnce,
  notifyAdminsDualWriteFailure,
  normalizeRoleForJwt,
  loadEmployeesFromTable,
  getSharedState,
  sendAdminSystemAlert,
  hrmsNowISO,
});

registerDiagnosisFeedbackRoutes(app, authRequired, {
  pool,
  recordAiFeedback,
});

registerAgentDataRoutes(app, authRequired, {
  pool,
  safeErrMessage,
  getFeishuAccessToken,
  createFeishuBitableRecord,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
});

registerFeishuWebhookRoutes(app, {
  express,
  pool,
  isWebhookEnabled,
  tryParseJson,
  verifyFeishuWebhookRequest,
  requireWebhookSignature,
  decryptFeishuEncryptPayload,
  resolveWebhookTenantId,
  tenantContext,
  randomUUID,
  safeErrMessage,
  notifyAdminsDualWriteFailure,
  onFeishuEvent,
  resolveTenantIdDefault,
  loadTenantFeishuBitableConfig,
  getFeishuTokenByConfig,
  getFeishuAccessToken,
  getFeishuBitableData,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
  mapFeishuFieldToHrms,
  upsertTableVisitRecordFromMapped,
});


}

export function registerLegacyDomainRoutes(deps) {
  const {
    registerRemainingStateRoutes, registerGmMailboxRoutes, registerAgentDataCenterRoutes, registerAgentOpsRoutes, registerAgentRecordsRoutes, registerAgentTriggersRoutes, registerAgentFeishuBotRoutes, registerAgentRoutes, registerAgentConfigRoutes, registerMasterRoutes, registerNewScoringRoutes, registerPerformanceInvalidationRoutes, registerHRMSApiRoutes, registerSOPDistributionRoutes, registerKitchenExecutionRoutes, registerRecipeRoutes, registerTrainingRoutes, registerUploadStatusRoute, app, authRequired, pool, getSharedState, invalidateSharedStateCache, resolveTenantIdDefault, saveSharedState, pickHqManagerUsername, pickAdminUsername, addStateNotification, makeNotif, uniqUsernames, hrmsNowISO, agentPool, getAgentPerformanceMetrics, cronJobLabelZh, runAgentEvalSuite, getScheduledTaskStatus, clearAgentCache, getAgentSharedState, inferBrandFromStoreName, fetchStoreRatingForProfileDisplay, calculateStoreRating, registerFeishuUser, runDataAuditor, pushIssuesToFeishu, syncDataAuditorIssuesToMasterTasks, runChiefEvaluator, pushScoresToFeishu, sendLarkMessage, callVisionLLM, callLLM, verifyLLMHealth, getLarkTenantToken, routeMessage, onFeishuEvent, upload, uploadsDir, ensureUploadsDir, recordUploadOwnership, trainingPracticeUpload, fileRoutes
  } = deps;

registerRemainingStateRoutes(app, authRequired, {
  pool,
  getSharedState,
  invalidateSharedStateCache,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerGmMailboxRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  pickHqManagerUsername,
  pickAdminUsername,
  addStateNotification,
  makeNotif,
  uniqUsernames,
  hrmsNowISO,
});

registerAgentDataCenterRoutes(app, authRequired, {
  pool: agentPool,
  getAgentPerformanceMetrics,
  cronJobLabelZh,
});
registerAgentOpsRoutes(app, authRequired, {
  pool: agentPool,
  getAgentPerformanceMetrics,
  runAgentEvalSuite,
  getScheduledTaskStatus,
  clearAgentCache,
});
registerAgentRecordsRoutes(app, authRequired, {
  pool: agentPool,
  getSharedState: getAgentSharedState,
  inferBrandFromStoreName,
  fetchStoreRatingForProfileDisplay,
  calculateStoreRating,
  registerFeishuUser,
});
registerAgentTriggersRoutes(app, authRequired, {
  pool: agentPool,
  runDataAuditor,
  pushIssuesToFeishu,
  syncDataAuditorIssuesToMasterTasks,
  runChiefEvaluator,
  pushScoresToFeishu,
  sendLarkMessage,
  callVisionLLM,
  callLLM,
  verifyLLMHealth,
  getLarkTenantToken,
  routeMessage,
  inferBrandFromStoreName,
  calculateStoreRating,
  defaultLlmModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
});
registerAgentFeishuBotRoutes(app, {
  pool: agentPool,
  onFeishuEvent,
});
registerAgentRoutes(app, authRequired);
registerAgentConfigRoutes(app, authRequired);

registerMasterRoutes(app, authRequired);
registerNewScoringRoutes(app, authRequired);
registerPerformanceInvalidationRoutes(app, authRequired);
registerHRMSApiRoutes(app, authRequired);
registerSOPDistributionRoutes(app, authRequired);
registerKitchenExecutionRoutes(app, authRequired);
registerRecipeRoutes(app, authRequired, {
  upload,
  uploadsDir,
  ensureUploadsDir,
  recordUploadOwnership,
});
registerTrainingRoutes(app, authRequired, trainingPracticeUpload, { getSharedState });
registerUploadStatusRoute(app, { pool, getSharedState, authRequired });
app.use('/api', authRequired, fileRoutes);
}

export function registerApplicationRoutes(app, deps) {
  const routeDeps = { app, ...deps };
  registerIdentityAndApprovalRoutes(routeDeps);
  registerOperationsDomainRoutes(routeDeps);
  registerIntegrationDomainRoutes(routeDeps);
  registerLegacyDomainRoutes(routeDeps);
}
