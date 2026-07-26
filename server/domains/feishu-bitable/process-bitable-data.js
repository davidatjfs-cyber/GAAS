/**
 * processBitableData entry (P2 peel from agents.js).
 * Typed processors live in process-bitable-data-helpers.js.
 */
import { childLogger } from '../../utils/logger.js';
import {
  processBadReviewData,
  processChecklistData,
  processClosingReportData,
  processGenericData,
  processMaterialReportData,
  processMeetingReportData,
  processOpeningReportData,
  processTableVisitData,
} from './process-bitable-data-helpers.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'process-bitable-data' });

/**
 * @param {object} deps
 * @param {() => object} deps.pool
 * @param {object} deps.bitableConfigs
 * @param {{ run: (tenantId: string, fn: Function) => Promise<any> }} deps.tenantContext
 * @param {(fields: object) => string} deps.extractDissatisfactionDishFromFields
 * @param {(fields: object) => string} deps.extractDissatisfactionReasonFromFields
 * @param {(v: unknown, fallback?: string) => string} deps.normalizeBitableDateValue
 * @param {(name: string) => string} deps.normalizeCanonicalStoreName
 * @param {(v: unknown) => string} deps.extractBitableFieldText
 * @returns {(configKey: string, records: object[]) => Promise<void>}
 */
export function createProcessBitableData(deps) {
  const {
    bitableConfigs,
    tenantContext,
    pool,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    normalizeBitableDateValue,
    normalizeCanonicalStoreName,
    extractBitableFieldText,
  } = deps;

  const processorDeps = {
    pool,
    log,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    normalizeBitableDateValue,
    normalizeCanonicalStoreName,
    extractBitableFieldText,
  };

  return async function processBitableData(configKey, records) {
    const config = bitableConfigs[configKey];
    if (!config) {
      log.error(`[bitable] invalid config key: ${configKey}`);
      return;
    }

    // REVIEWED_COMPAT_DEFAULT: bitable 处理入口；single 现网等价 default。
    // multi 下应由调用方按 app_token 解析租户后再包 ALS（见 resolveWebhookTenantId）。
    // 此函数是PG LISTEN/NOTIFY、catchup、回退轮询三条路径的唯一公共入口，
    // 但调用方均未建立ALS——导致内部写agent_messages时tenant_id列值('default')
    // 与会话变量(空sentinel)不一致，被严格RLS的WITH CHECK拒绝。这里统一建ALS。
    return await tenantContext.run('default', async () => {
      switch (config.type) {
        case 'checklist':
          return await processChecklistData(processorDeps, records);
        case 'table_visit':
          return await processTableVisitData(processorDeps, records);
        case 'bad_review':
          return await processBadReviewData(processorDeps, records);
        case 'closing_report':
          return await processClosingReportData(processorDeps, records);
        case 'opening_report':
          return await processOpeningReportData(processorDeps, records);
        case 'meeting_report':
          return await processMeetingReportData(processorDeps, records);
        case 'material_report':
          return await processMaterialReportData(processorDeps, records, config.brand);
        default:
          log.info(`[bitable][${configKey}] unknown type: ${config.type}, processing as generic`);
          return await processGenericData(processorDeps, records, configKey);
      }
    });
  };
}
