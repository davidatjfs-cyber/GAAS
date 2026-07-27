/**
 * 飞书表格同步模块
 * 负责同步开档报告、收档报告、例会报告、原料收货日报
 *
 * 实现已拆分至 server/domains/feishu-reports-sync/*；本文件保留为薄编排/re-export层，
 * 保证现有 import 路径（index.js、feishu-bitable/config-lookup.js 等）不变。
 */

export { FEISHU_TABLE_CONFIG, resolveWebhookTenantId, loadTenantFeishuConfig as loadTenantFeishuBitableConfig } from './domains/feishu-reports-sync/config.js';
export { extractClosingReportFields, extractOpeningReportFields, extractMeetingReportFields, extractMaterialReportFields } from './domains/feishu-reports-sync/field-extractors.js';
export { getFeishuAccessToken, fetchTableRecords } from './domains/feishu-reports-sync/api.js';
export { setFeishuSyncFailureNotifier } from './domains/feishu-reports-sync/notify.js';
export { syncKitchenReports, syncMeetingReports, syncMaterialReports } from './domains/feishu-reports-sync/report-sync.js';
export { syncDishLibraryCosts } from './domains/feishu-reports-sync/dish-library-sync.js';
export { syncSopSteps } from './domains/feishu-reports-sync/sop-sync.js';
export { syncAllFeishuTables, startDailyFeishuSync } from './domains/feishu-reports-sync/orchestrator.js';
