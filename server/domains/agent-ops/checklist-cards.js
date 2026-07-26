/**
 * Ops checklist cards + in-memory progress (P2 peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';
import {
  buildOpsChecklistAbnormalItemsCard as buildAbnormalItemsCardBody,
  buildOpsChecklistCard as buildCardBody,
  buildOpsChecklistItemDetailCard,
  buildOpsChecklistItemsCard as buildItemsCardBody,
  buildOpsChecklistTemplateText as buildTemplateTextBody,
  countOpsChecklistAbnormal,
  countOpsChecklistCompleted,
  detectOpsChecklistType,
  formatChecklistTypeLabel,
  getOpsChecklistItems as getOpsChecklistItemsBody,
  getOpsChecklistProgressKey,
} from './checklist-cards-helpers.js';

const log = childLogger({ domain: 'agent-ops', handler: 'checklist-cards' });

/**
 * @param {object} deps
 * @param {() => object} deps.getOpsAgentConfig
 * @param {boolean} [deps.startProgressCleanup=true]
 */
export function createOpsChecklistCardsApi(deps) {
  const { getOpsAgentConfig, startProgressCleanup = true } = deps;
  const opsChecklistProgress = new Map();

  if (startProgressCleanup) {
    // M3-FIX: 定期清理过期的检查表进度（每30分钟清理超过2小时的条目）
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, progress] of opsChecklistProgress.entries()) {
        const createdAt = progress?.createdAt || 0;
        if (now - createdAt > 2 * 60 * 60 * 1000) {
          opsChecklistProgress.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) log.info(`[ops] cleaned ${cleaned} expired checklist progress entries`);
    }, 30 * 60 * 1000).unref?.();
  }

  const getOpsChecklistItems = (checkType, storeName = '', brandName = '') =>
    getOpsChecklistItemsBody(getOpsAgentConfig, checkType, storeName, brandName);

  return {
    opsChecklistProgress,
    formatChecklistTypeLabel,
    getOpsChecklistProgressKey,
    countOpsChecklistCompleted,
    countOpsChecklistAbnormal,
    detectOpsChecklistType,
    getOpsChecklistItems,
    buildOpsChecklistItemDetailCard,
    buildOpsChecklistItemsCard: (args) => buildItemsCardBody(getOpsAgentConfig, args),
    buildOpsChecklistAbnormalItemsCard: (args) => buildAbnormalItemsCardBody(getOpsAgentConfig, args),
    buildOpsChecklistCard: (args) => buildCardBody(getOpsAgentConfig, args),
    buildOpsChecklistTemplateText: (args) => buildTemplateTextBody(getOpsAgentConfig, args),
  };
}
