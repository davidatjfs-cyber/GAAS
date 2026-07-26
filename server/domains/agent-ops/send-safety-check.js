/**
 * Random food-safety spot check dispatch (Wave A10a peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-ops', handler: 'send-safety-check' });

/**
 * @param {object} deps
 * @returns {(config: object) => Promise<void>}
 */
export function createSendSafetyCheck(deps) {
  const {
    getSharedState,
    isLikelySameStore,
    normalizeStoreKey,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    opsTaskReplyAuditLarkMd,
    nowFn = Date.now,
    randomFn = Math.random,
  } = deps;

  return async function sendSafetyCheck(config) {
    if (config?.enabled === false) {
      log.info({ msg: 'safety_check_disabled' });
      return;
    }
    const sharedState = await getSharedState();
    const rawStores = sharedState.stores || [];
    const storeList = Array.isArray(rawStores) ? rawStores : Object.values(rawStores);

    if (!storeList.length) {
      log.info({ msg: 'no_stores_available' });
      return;
    }

    const configStore = String(config?.store || '').trim();
    const configBrand = String(config?.brand || '').trim();
    const targetStores = configStore
      ? storeList.filter((s) => isLikelySameStore(s?.name, configStore))
      : configBrand
        ? storeList.filter((s) => String(s?.brand || '').trim() === configBrand)
        : storeList;
    if (!targetStores.length) {
      log.info({ msg: 'no_stores_matched', store: configStore, brand: configBrand });
      return;
    }

    const pickedStore = targetStores[Math.floor(randomFn() * targetStores.length)];
    const roles =
      Array.isArray(config?.assigneeRoles) && config.assigneeRoles.length
        ? config.assigneeRoles.map((r) => String(r || '').trim()).filter(Boolean)
        : ['store_manager', 'store_production_manager'];
    const allStaff = [
      ...(Array.isArray(sharedState.employees) ? sharedState.employees : []),
      ...(Array.isArray(sharedState.users) ? sharedState.users : []),
    ];
    const assignees = allStaff.filter(
      (u) =>
        normalizeStoreKey(u?.store) === normalizeStoreKey(pickedStore?.name) &&
        roles.includes(String(u?.role || '').trim())
    );
    const usernames = [
      ...new Set(assignees.map((u) => String(u?.username || '').trim()).filter(Boolean)),
    ];

    const taskDesc = String(config?.description || '').trim() || '请完成本次食安抽检';
    const replyExtra = String(config?.replyRequirements || config?.replyHint || '').trim();
    const auditBlock = replyExtra
      ? `${opsTaskReplyAuditLarkMd}\n\n**本任务补充**：${replyExtra}`
      : opsTaskReplyAuditLarkMd;
    const timeWindow = Math.max(1, Math.floor(Number(config?.timeWindow) || 15));
    const taskType = String(config?.type || '').trim() || '食安抽检';
    const timeNow = new Date(nowFn()).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const deadlineAt = new Date(nowFn() + timeWindow * 60 * 1000).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const message = `🔔 随机抽检通知\n\n门店：${pickedStore?.name || '-'}\n类型：${taskType}\n任务：${taskDesc}\n时间：${timeNow}\n时限：${timeWindow}分钟内完成\n截止：${deadlineAt}\n\n请在本对话回复文字说明（建议附照片）。\n${auditBlock.replace(/\*\*/g, '')}`;
    const safetyCard = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🔔 随机抽检 · ${taskType}` },
        template: 'yellow',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**门店**：${pickedStore?.name || '-'}\n**类型**：${taskType}\n**任务**：${taskDesc}`,
          },
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**时间**：${timeNow}\n**时限**：${timeWindow}分钟内完成\n**截止**：${deadlineAt}`,
          },
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: '📸 请在本对话直接回复：**文字说明**（建议附照片）。',
          },
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: auditBlock } },
        { tag: 'note', elements: [{ tag: 'plain_text', content: `小年 · ${taskType}` }] },
      ],
    };

    if (!usernames.length) {
      const fallbackUser = await lookupFeishuUserByUsername(
        String(pickedStore?.manager || '').trim()
      );
      if (!fallbackUser?.open_id) {
        log.info({
          msg: 'no_assignee_found',
          store: pickedStore?.name || '-',
          roles: roles.join(','),
        });
        return;
      }
      const r = await sendLarkCard(fallbackUser.open_id, safetyCard);
      if (!r.ok) {
        await sendLarkMessage(
          fallbackUser.open_id,
          prefixWithAgentName('ops_supervisor', message)
        );
      }
      log.info({
        msg: 'sent_fallback_manager',
        store: pickedStore?.name || '-',
        task_type: taskType,
      });
      return;
    }

    for (const username of usernames) {
      const feishuUser = await lookupFeishuUserByUsername(username);
      if (!feishuUser?.open_id) continue;
      const r = await sendLarkCard(feishuUser.open_id, safetyCard);
      if (!r.ok) {
        await sendLarkMessage(feishuUser.open_id, prefixWithAgentName('ops_supervisor', message));
      }
    }
    log.info({
      msg: 'sent_safety_check',
      store: pickedStore?.name || '-',
      usernames: usernames.join(','),
      task_type: taskType,
    });
  };
}
