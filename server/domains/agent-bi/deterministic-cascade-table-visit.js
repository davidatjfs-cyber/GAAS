/**
 * BI deterministic table-visit reply.
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicTableVisitReply(deps) {
  const {
    isBiSourceEnabled,
    resolveDateRangeFromQuestion,
    loadUnifiedTableVisitRowsByStore,
  } = deps;

  return async function buildBiDeterministicTableVisitReply(store, text) {
    const q = String(text || '').trim();
    const s = String(store || '').trim();
    if (!s) return '';
    if (!/(桌访|桌巡|巡台|不满意.*菜|菜品.*不满意|出品.*不满意|最不满意|不满意在哪|主要不满意|不满意.*原因|哪里不满意|什么不满意)/.test(q)) return '';
    if (!isBiSourceEnabled('table_visit_records') && !isBiSourceEnabled('table_visit_bitable')) return '';
    const p = resolveDateRangeFromQuestion(q, 7);
    try {
      const rows = await loadUnifiedTableVisitRowsByStore(s, p.start, p.end);
      if (!rows.length) return `📋 ${p.label}桌访记录（${s}）：暂无桌访数据。`;
      const dishMap = {};
      for (const row of rows) {
        const items = String(row.dissatisfaction_dish || '').split(/[，,、]+/).map((x) => x.trim()).filter((x) => x && !/卤鹅/.test(x));
        for (const d of items) {
          dishMap[d] = (dishMap[d] || 0) + 1;
        }
      }
      const dishSorted = Object.entries(dishMap).sort((a, b) => b[1] - a[1]);
      const fbMap = {};
      const blockedFb = new Set(['无', '没有', '暂无', '不清楚', '未知', '其他', '']);
      for (const row of rows) {
        const fb = String(row.unsatisfied_items || '').trim();
        if (fb && !blockedFb.has(fb)) {
          fb.split(/[，,、]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
            fbMap[x] = (fbMap[x] || 0) + 1;
          });
        }
      }
      const fbSorted = Object.entries(fbMap).sort((a, b) => b[1] - a[1]);
      const dishNames = dishSorted.map(([d]) => d);
      const mentionedDish = dishNames.find((d) => q.includes(d));
      if (mentionedDish) {
        const dishRows = rows.filter((row) => String(row.dissatisfaction_dish || '').includes(mentionedDish));
        const dishFb = {};
        for (const row of dishRows) {
          const fb = String(row.unsatisfied_items || '').trim();
          if (fb && !blockedFb.has(fb)) {
            fb.split(/[，,、]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
              dishFb[x] = (dishFb[x] || 0) + 1;
            });
          }
        }
        const dishFbSorted = Object.entries(dishFb).sort((a, b) => b[1] - a[1]);
        const dl = [`📋 「${mentionedDish}」桌访不满意详情（${s}·${p.label}）【数据来源：桌访巡台记录】`, `提及「${mentionedDish}」的桌访共${dishRows.length}条（总${rows.length}条中）`];
        if (dishFbSorted.length) {
          dl.push('', '🔔 关联不满意反馈：');
          dishFbSorted.slice(0, 8).forEach(([d, c], i) => dl.push(`${i + 1}. ${d}（${c}次）`));
        } else {
          dl.push('', '桌访记录中未记录该菜品的具体不满意原因，仅记录了菜品名称。');
        }
        return dl.join('\n');
      }
      const lines = [`📋 桌访反馈（${s}·${p.label}）【数据来源：桌访巡台记录，非大众点评】`, `共${rows.length}条桌访记录`];
      if (fbSorted.length) {
        lines.push('', '🔔 桌访不满意反馈TOP：');
        fbSorted.slice(0, 8).forEach(([d, c], i) => lines.push(`${i + 1}. ${d}（${c}次）`));
      }
      if (dishSorted.length) {
        lines.push('', '🍽 桌访不满意菜品TOP：');
        dishSorted.slice(0, 8).forEach(([d, c], i) => lines.push(`${i + 1}. ${d}（${c}次）`));
      }
      if (!fbSorted.length && !dishSorted.length) {
        lines.push('', '该时段桌访未记录明确不满意内容。');
      }
      return lines.join('\n');
    } catch (e) {
      return `桌访数据查询失败：${e?.message || '未知错误'}`;
    }
  };
}
