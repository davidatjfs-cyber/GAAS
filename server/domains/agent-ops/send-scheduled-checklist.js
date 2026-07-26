/**
 * Scheduled ops checklist dispatch (Wave A8 peel from agents.js sendScheduledChecklist).
 */
import { childLogger } from '../../utils/logger.js';
import {
  buildScheduledChecklistCard,
  insertScheduledChecklistMasterTask,
} from './send-scheduled-checklist-helpers.js';

const log = childLogger({ domain: 'agent-ops', handler: 'send-scheduled-checklist' });

/**
 * @param {object} deps
 * @returns {(config: object) => Promise<void>}
 */
export function createSendScheduledChecklist(deps) {
  const {
    pool,
    getSharedState,
    isLikelySameStore,
    normalizeStoreKey,
    lookupFeishuUserByUsername,
    sendLarkCard,
    formatChecklistTypeLabel,
    getOpsChecklistItems,
    opsTaskReplyAuditLarkMd,
    shouldSkipHrmsScheduledChecklist,
    nowFn = Date.now,
    randomFn = Math.random,
  } = deps;

  return async function sendScheduledChecklist(config) {
    if (shouldSkipHrmsScheduledChecklist(config)) return;

    const sharedState = await getSharedState();
    const rawStores = sharedState.stores || [];
    const storeList = Array.isArray(rawStores) ? rawStores : Object.values(rawStores);
    const configStore = String(config?.store || '').trim();
    const configBrand = String(config?.brand || '').trim();
    const targetStores = configStore
      ? storeList.filter((s) => isLikelySameStore(s?.name, configStore))
      : storeList.filter((s) => String(s?.brand || '').trim() === configBrand);

    if (targetStores.length === 0) {
      log.info({ msg: 'no_stores_found', store: configStore, brand: configBrand });
      return;
    }

    const allStaff = [
      ...(Array.isArray(sharedState.employees) ? sharedState.employees : []),
      ...(Array.isArray(sharedState.users) ? sharedState.users : []),
    ];

    for (const store of targetStores) {
      try {
        const targets = allStaff.filter(
          (u) =>
            normalizeStoreKey(u?.store) === normalizeStoreKey(store.name) &&
            (u.role === 'store_manager' || u.role === 'store_production_manager')
        );
        const uniqueUsernames = [
          ...new Set(targets.map((u) => String(u.username || '').trim()).filter(Boolean)),
        ];
        if (!uniqueUsernames.length) {
          log.info({ msg: 'no_staff_found', store: store.name, all_staff: allStaff.length });
        }

        for (const username of uniqueUsernames) {
          const feishuUser = await lookupFeishuUserByUsername(username);
          if (!feishuUser?.open_id) continue;

          const { card, typeLabel, timeWindow, deadlineAt } = buildScheduledChecklistCard(
            config,
            store,
            configBrand,
            { formatChecklistTypeLabel, getOpsChecklistItems, opsTaskReplyAuditLarkMd, nowFn }
          );

          const cardResult = await sendLarkCard(feishuUser.open_id, card);
          if (!cardResult.ok) continue;

          log.info({ msg: 'sent_scheduled_checklist', store: store.name, username });

          try {
            await insertScheduledChecklistMasterTask(pool, {
              store,
              configBrand,
              username,
              targets,
              typeLabel,
              timeWindow,
              deadlineAt,
              cardResult,
              nowFn,
              randomFn,
              log,
            });
          } catch (e) {
            log.error({ msg: 'create_master_task_failed', err: String(e?.message || e) });
          }
        }
      } catch (e) {
        log.error({
          msg: 'send_checklist_store_failed',
          store: store?.name,
          err: String(e?.message || e),
        });
      }
    }
  };
}
