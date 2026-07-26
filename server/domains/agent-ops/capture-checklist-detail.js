/**
 * Capture ops checklist detail from Feishu chat (P2 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {Map} deps.opsChecklistProgress
 * @param {(progress: object) => number} deps.countOpsChecklistAbnormal
 * @param {Function} deps.sendLarkMessage
 * @param {Function} deps.prefixWithAgentName
 */
export function createTryCaptureOpsChecklistDetailFromChat(deps) {
  const { opsChecklistProgress, countOpsChecklistAbnormal, sendLarkMessage, prefixWithAgentName } = deps;

  return async function tryCaptureOpsChecklistDetailFromChat(openId, feishuUser, text, imageUrls) {
    const storeName = String(feishuUser?.store || '').trim();
    if (!openId || !storeName) return { handled: false };

    const candidates = [];
    const today = new Date().toISOString().slice(0, 10);
    candidates.push(`${openId}||${storeName}||opening||${today}`);
    candidates.push(`${openId}||${storeName}||closing||${today}`);

    let matchedKey = '';
    let progress = null;
    for (const key of candidates) {
      const p = opsChecklistProgress.get(key);
      if (p && Number.isFinite(p.pendingItemIndex) && p.pendingItemIndex >= 0) {
        matchedKey = key;
        progress = p;
        break;
      }
    }
    if (!progress) return { handled: false };

    const idx = progress.pendingItemIndex;
    const itemName = String(progress.pendingItemName || '').trim() || `第${idx + 1}项`;
    if (!progress.itemDetails[idx]) progress.itemDetails[idx] = { status: '', remark: '', photoCount: 0 };

    let changed = false;
    if (text) {
      const normalized = text.replace(/^说明[：:]/, '').trim();
      if (normalized) {
        progress.itemDetails[idx].remark = normalized;
        changed = true;
      }
    }
    if (Array.isArray(imageUrls) && imageUrls.length) {
      progress.itemDetails[idx].photoCount = (Number(progress.itemDetails[idx].photoCount) || 0) + imageUrls.length;
      changed = true;
    }

    if (!changed) return { handled: false };

    const abnormalCount = countOpsChecklistAbnormal(progress);
    const detail = progress.itemDetails[idx] || {};
    const statusText = detail.status === 'pass' ? '合格' : detail.status === 'fail' ? '异常' : '未标记';
    const remarkText = String(detail.remark || '').trim() ? '已填写' : '未填写';
    const photoText = `${Number(detail.photoCount) || 0}张`;

    await sendLarkMessage(
      openId,
      prefixWithAgentName(
        'ops_supervisor',
        `已更新【${itemName}】\n状态：${statusText}\n说明：${remarkText}\n照片：${photoText}\n\n当前已记录异常：${abnormalCount}项`
      )
    );

    return { handled: true, progressKey: matchedKey, abnormalCount };
  };
}
