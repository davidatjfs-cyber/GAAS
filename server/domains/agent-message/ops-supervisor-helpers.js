/**
 * ops_supervisor：图片审核结果文案 + 图片路径编排。
 */

/**
 * @param {Array<{ duplicate?: boolean, result?: string, findings?: string }>} auditResults
 */
export function formatOpsImageAuditResponse(auditResults) {
  const list = Array.isArray(auditResults) ? auditResults : [];
  const anyDuplicate = list.some((r) => r.duplicate);
  // 与原逻辑一致：[].every(...) === true
  const allPass = list.every((r) => r.result === 'pass');
  const anyFail = list.some((r) => r.result === 'fail');

  if (anyDuplicate) {
    return '⚠️ 检测到重复图片，请重新拍摄并上传。系统已记录此次异常。';
  }
  if (allPass) {
    const summaries = list.map((r) => r.findings).filter(Boolean).join('；');
    return `收到，照片识别合格 ✅\n${summaries || '图片内容符合要求。'}\n已记录整改措施，感谢配合。`;
  }
  if (anyFail) {
    const failFindings = list
      .filter((r) => r.result === 'fail')
      .map((r) => r.findings)
      .join('；');
    return `照片审核未通过 ❌\n${failFindings}\n请整改后重新拍照上传。`;
  }
  return '照片已收到，正在审核中。部分图片无法自动判定，已转交值班经理人工复核。';
}

/**
 * @param {{
 *   imageUrls: string[],
 *   store: string,
 *   brand: string,
 *   senderUsername: string,
 *   route: string,
 *   brandId: string,
 *   brandConfig: unknown,
 * }} ctx
 * @param {{ auditImage: (url: string, type: string, meta: object) => Promise<object> }} deps
 * @returns {Promise<{ handled: true, response: string, agentData: object } | { handled: false }>}
 */
export async function tryHandleOpsSupervisorImages(ctx, deps) {
  const imageUrls = Array.isArray(ctx.imageUrls) ? ctx.imageUrls.filter(Boolean) : [];
  if (!imageUrls.length) return { handled: false };

  const auditResults = [];
  for (const imgUrl of imageUrls) {
    const result = await deps.auditImage(imgUrl, 'general', {
      store: ctx.store,
      brand: ctx.brand,
      username: ctx.senderUsername,
    });
    auditResults.push(result);
  }

  return {
    handled: true,
    response: formatOpsImageAuditResponse(auditResults),
    agentData: {
      route: ctx.route,
      auditResults,
      brandId: ctx.brandId,
      brandConfig: ctx.brandConfig,
    },
  };
}

export function buildOpsSupervisorLlmSystemPrompt(opts) {
  const nowText =
    opts.nowText ||
    new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const activeTaskContext = opts.activeTaskContext || '';
  return `你是"小年"，年年有喜餐饮集团AI助理，当前协助营运检查。当前时间：${nowText}。门店：${opts.store}（${opts.brand}）。简洁专业，注重实操。严格约束：禁止编造任何数据（员工人数、日期等），无数据时说明"暂无数据"。${activeTaskContext}`;
}
