/**
 * Feishu ops checklist card action handler (Wave A7 peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-ops', handler: 'checklist-card-action' });

/**
 * @param {object} deps
 * @returns {(event: object) => Promise<object>}
 */
export function createHandleOpsChecklistCardAction(deps) {
  const {
    pool,
    lookupFeishuUser,
    sendLarkMessage,
    sendLarkCard,
    getSharedState,
    resolveBrandContextByStore,
    getOpsChecklistProgressKey,
    getOpsChecklistItems,
    opsChecklistProgress,
    buildOpsChecklistAbnormalItemsCard,
    prefixWithAgentName,
    formatChecklistTypeLabel,
    countOpsChecklistAbnormal,
    resolveTenantIdDefault,
  } = deps;

  return async function handleOpsChecklistCardAction(event) {
    const openId = String(
      event?.operator?.operator_id?.open_id ||
        event?.operator?.open_id ||
        event?.user?.open_id ||
        ''
    ).trim();
    if (!openId) return { ok: true, skipped: 'no_open_id' };

    const actionValue = event?.action?.value || {};
    const action = String(actionValue.action || '').trim();
    if (!action.startsWith('ops_checklist_')) return { ok: true, skipped: 'not_ops_checklist_action' };

    const feishuUser = await lookupFeishuUser(openId);
    if (!feishuUser || !feishuUser.registered) {
      await sendLarkMessage(openId, '请先完成HRMS账号绑定后再提交检查表。');
      return { ok: true, skipped: 'unregistered_user' };
    }

    const sharedState = await getSharedState();
    const brandContext = resolveBrandContextByStore(sharedState, feishuUser.store || '');
    const brandName = String(brandContext?.brandName || '').trim();
    const storeName = String(feishuUser.store || '').trim();
    const checkType = String(actionValue.checkType || '').trim() || 'opening';
    const progressKey = getOpsChecklistProgressKey(openId, checkType, storeName);
    const checklistItems = getOpsChecklistItems(checkType, storeName, brandName);

    if (!opsChecklistProgress.has(progressKey)) {
      opsChecklistProgress.set(progressKey, {
        checked: new Set(),
        items: checklistItems,
        itemDetails: {},
        pendingItemIndex: null,
        pendingItemName: '',
      });
    }
    const progress = opsChecklistProgress.get(progressKey);
    if (Array.isArray(progress?.items) && progress.items.length === 0 && checklistItems.length) {
      progress.items = checklistItems;
    }

    if (action === 'ops_checklist_abnormal_open') {
      const card = buildOpsChecklistAbnormalItemsCard({ checkType, brandName, storeName });
      const sendRes = await sendLarkCard(openId, card);
      if (!sendRes.ok) {
        await sendLarkMessage(
          openId,
          prefixWithAgentName('ops_supervisor', '异常项选择卡片发送失败，请稍后重试。')
        );
        return {
          toast: { type: 'error', content: '异常项卡片发送失败' },
          ok: true,
          checklistAction: 'abnormal_open_failed',
        };
      }
      return {
        toast: { type: 'info', content: '请选择异常项提交' },
        ok: true,
        route: 'ops_supervisor',
        checklistAction: 'abnormal_opened',
      };
    }

    if (action === 'ops_checklist_abnormal_item') {
      const itemName = String(actionValue.itemName || '其他异常').trim() || '其他异常';
      const typeLabel = formatChecklistTypeLabel(checkType);
      const structured = {
        source: 'feishu_card_action',
        route: 'ops_supervisor',
        checkType,
        checkTypeLabel: typeLabel,
        status: 'fail',
        brand: brandName,
        store: storeName,
        username: feishuUser.username,
        abnormalItem: itemName,
        submittedAt: new Date().toISOString(),
      };

      try {
        await pool().query(
          `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, tenant_id)
         VALUES ('in','feishu',$1,$2,$3,$4,'ops_supervisor','card_action',$5,$6::jsonb,$7)`,
          [
            openId,
            feishuUser.username,
            feishuUser.name || feishuUser.username,
            feishuUser.role || '',
            `${typeLabel}异常项提交：${itemName}`,
            JSON.stringify(structured),
            resolveTenantIdDefault(),
          ]
        );
      } catch (e) {
        log.error({ msg: 'save_checklist_abnormal_item_failed', err: String(e?.message || e) });
      }

      progress.pendingItemIndex = Number.parseInt(String(actionValue.itemIndex || '-1'), 10);
      progress.pendingItemName = itemName;
      if (Number.isFinite(progress.pendingItemIndex) && progress.pendingItemIndex >= 0) {
        if (!progress.itemDetails[progress.pendingItemIndex]) {
          progress.itemDetails[progress.pendingItemIndex] = { status: '', remark: '', photoCount: 0 };
        }
        progress.itemDetails[progress.pendingItemIndex].status = 'fail';
      }

      await sendLarkMessage(
        openId,
        prefixWithAgentName(
          'ops_supervisor',
          `已记录异常项：${itemName}。\n请直接回复：说明：你的说明\n并上传该项现场照片。`
        )
      );
      return {
        toast: { type: 'success', content: `已提交异常：${itemName}` },
        ok: true,
        route: 'ops_supervisor',
        checklistAction: 'abnormal_item_submitted',
      };
    }

    if (action === 'ops_checklist_submit') {
      const typeLabel = formatChecklistTypeLabel(checkType);
      const items = progress?.items?.length ? progress.items : checklistItems;
      const total = Math.max(1, items.length);
      const abnormalCount = countOpsChecklistAbnormal(progress);

      const standardized = {
        source: 'feishu_card_action',
        route: 'ops_supervisor',
        checkType,
        checkTypeLabel: typeLabel,
        status: abnormalCount > 0 ? 'fail' : 'pass',
        brand: brandName,
        store: storeName,
        username: feishuUser.username,
        checklist: items,
        checklistProgress: { total, abnormalCount, passCount: Math.max(0, total - abnormalCount) },
        itemDetails: progress?.itemDetails || {},
        submittedAt: new Date().toISOString(),
      };

      try {
        await pool().query(
          `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, tenant_id)
         VALUES ('in','feishu',$1,$2,$3,$4,'ops_supervisor','card_action',$5,$6::jsonb,$7)`,
          [
            openId,
            feishuUser.username,
            feishuUser.name || feishuUser.username,
            feishuUser.role || '',
            `${typeLabel}检查表提交（异常${abnormalCount}项）`,
            JSON.stringify(standardized),
            resolveTenantIdDefault(),
          ]
        );
      } catch (e) {
        log.error({ msg: 'save_checklist_card_action_failed', err: String(e?.message || e) });
      }

      const reply = `已收到你的${typeLabel}检查表提交 ✅\n异常项：${abnormalCount}，其余默认合格。\n如需补充异常说明/照片，可继续发送“说明：xxx”+图片。`;
      await sendLarkMessage(openId, prefixWithAgentName('ops_supervisor', reply));
      opsChecklistProgress.delete(progressKey);
      return {
        toast: { type: 'success', content: '检查表已提交' },
        ok: true,
        route: 'ops_supervisor',
        checklistAction: 'submit',
      };
    }

    return { ok: true, skipped: 'unknown_ops_action' };
  };
}
