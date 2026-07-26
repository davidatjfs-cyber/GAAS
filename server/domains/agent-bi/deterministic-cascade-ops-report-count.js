/**
 * BI deterministic ops-report count reply (table-visit based).
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicOpsReportCountReply(deps) {
  const {
    resolveDateRangeFromQuestion,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitDishes,
  } = deps;

  return async function buildBiDeterministicOpsReportCountReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(开档|收档|例会|原料)/.test(q)) return '';
    if (!/(多少|几次|几条|总数|次数|记录数|统计|一共|有没有|是否|吗)/.test(q)) return '';

    const period = resolveDateRangeFromQuestion(q, 7);
    const periodLabel = period.label;
    const start = period.start;
    const end = period.end;
    const rows = await loadUnifiedTableVisitRowsByStore(targetStore, start, end);
    if (!rows.length) {
      return `${periodLabel}桌访数据（${targetStore}）：0条记录。该时间段暂无桌访数据入库。`;
    }

    const dishTop = new Map();
    rows.forEach((x) => {
      extractTableVisitDishes(x).forEach((k) => dishTop.set(k, (dishTop.get(k) || 0) + 1));
    });
    const dishTopList = Array.from(dishTop.entries()).sort((a, b) => b[1] - a[1]);
    const topDish = dishTopList[0] || null;

    const feedbackTop = new Map();
    const blockedFb = new Set(['无', '没有', '暂无', '不清楚', '未知', '其他', '']);
    rows.forEach((x) => {
      const reason = String(x?.unsatisfied_items || '').trim();
      if (reason && !blockedFb.has(reason)) {
        feedbackTop.set(reason, (feedbackTop.get(reason) || 0) + 1);
      }
    });
    const feedbackList = Array.from(feedbackTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const _feedbackText = feedbackList.map(([k, v]) => `「${k}」(${v}次)`).join('、') || '无';
    const feedbackCount = rows.filter((x) => {
      const r = String(x?.unsatisfied_items || '').trim();
      return r && !blockedFb.has(r);
    }).length;

    const positiveOnly = /^(.*好吃.*|.*满意.*|.*不错.*|.*喜欢.*|.*很好.*|.*挺好.*|.*可以的|.*味道好.*)$/;
    const negativePattern = /太[咸淡冷油辣热硬]|有点[咸淡冷硬腥慢小挤]|不满意|不好吃|不新鲜|不够|偏[咸淡]|等[很太]久|等了[很太]久|上菜[有稍]?[点微]?慢|不[满熟行]|肿了|太老|没有肉感|不是很满意|该[咸淡]的不[咸淡]/;
    const negFeedbackTop = new Map();
    rows.forEach((x) => {
      const reason = String(x?.unsatisfied_items || '').trim();
      if (reason && !blockedFb.has(reason) && negativePattern.test(reason) && !positiveOnly.test(reason)) {
        negFeedbackTop.set(reason, (negFeedbackTop.get(reason) || 0) + 1);
      }
    });
    const negList = Array.from(negFeedbackTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const negCount = negList.reduce((s, [, v]) => s + v, 0);
    const _negText = negList.map(([k, v]) => `「${k}」(${v}次)`).join('、');

    const dissatisfactionIntent = /(最不满意|哪里不满意|哪些不满意|不满意点|不满意.*菜|菜品.*不满意|出品.*不满意)/.test(q);
    if (dissatisfactionIntent) {
      const lines = [`📋 ${periodLabel}桌访不满意反馈（${targetStore}）`];
      lines.push(`样本：${rows.length}条桌访`);
      if (negList.length) {
        lines.push(`\n⚠️ 负面反馈（${negCount}条）：`);
        negList.forEach(([k, v]) => lines.push(`  · ${k}（${v}次）`));
      }
      if (topDish) {
        lines.push(`\n🍽 不满意菜品：`);
        dishTopList.slice(0, 5).forEach(([k, v]) => lines.push(`  · ${k}（${v}次）`));
      }
      if (!negList.length && !topDish) {
        lines.push(`\n该时段顾客未反馈明确不满意内容。`);
      }
      return lines.join('\n');
    }

    if (/(多少|几条|总数|记录|样本|一共)/.test(q)) {
      return `${periodLabel}桌访数据（${targetStore}）\n- 桌访记录：${rows.length}条\n- 含反馈记录：${feedbackCount}条`;
    }

    const lines = [`📋 ${periodLabel}桌访概况（${targetStore}）`];
    lines.push(`- 桌访记录：${rows.length}条`);
    if (negList.length) lines.push(`- 负面反馈：${negList.slice(0, 3).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
    if (topDish) lines.push(`- 不满意菜品：${dishTopList.slice(0, 3).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
    return lines.join('\n');
  };
}
