/**
 * Deterministic bad-review report reply (Wave A5b).
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicBadReviewReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    getBadReviewTableId,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
  } = deps;

  return async function buildBiDeterministicBadReviewReportReply(store, text) {

    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(差评|负评|投诉|点评|评价.*差|差.*评价|大众点评|美团|评价.*结果|评价.*怎么样|评价.*情况)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 30);
    const badReviewTableId = String(typeof getBadReviewTableId === 'function' ? getBadReviewTableId() : '').trim();
    try {
      const normalizeReviewDate = (fields, createdAt) => normalizeBitableDateValue(
        fields?.['差评日期'] || fields?.['创建日期'] || fields?.['日期'] || fields?.['提交时间'] || fields?.['评价日期'] || fields?.date,
        createdAt
      );
      // 从 feishu_generic_records 查差评报告原始数据
      let rows = [];
      if (badReviewTableId) {
        const r = await pool().query(
          `SELECT fields, created_at FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 3000`,
          [badReviewTableId]
        );
        rows = (r.rows || []).filter(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const rowStore = extractBitableFieldText(f['差评门店'] || f['门店'] || f['所属门店']);
          if (!isLikelySameStore(rowStore, targetStore)) return false;
          const d = normalizeReviewDate(f, row?.created_at);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
      }
      // 补充从 agent_messages 查
      if (!rows.length) {
        const r2 = await pool().query(
          `SELECT agent_data as fields, created_at FROM agent_messages WHERE content_type = 'negative_review' ORDER BY created_at DESC LIMIT 3000`
        );
        rows = (r2.rows || []).filter(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const rowStore = extractBitableFieldText(
            f['差评门店'] || f['门店'] || f['所属门店'] || f.store || f?.fields?.store || f?.fields?.['所属门店']
          );
          if (!isLikelySameStore(rowStore, targetStore)) return false;
          const d = normalizeReviewDate(f, row?.created_at);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
      }
      // 补充桌访不满意菜品数据（结合桌访表）
      let tableVisitDishMap = new Map();
      try {
        const tvRows = await loadUnifiedTableVisitRowsByStore(targetStore, period.start, period.end);
        for (const row of tvRows) {
          const items = String(row.dissatisfaction_dish || '').split(/[，,、]+/).map(x => x.trim()).filter(x => x && x !== '无');
          for (const item of items) { tableVisitDishMap.set(item, (tableVisitDishMap.get(item) || 0) + 1); }
        }
      } catch (e) { /* ignore */ }

      if (!rows.length && !tableVisitDishMap.size) {
        return `📊 ${period.label}差评数据（${targetStore}）：暂无差评记录入库，桌访也无不满意菜品记录。`;
      }
      // 统计
      const productTop = new Map();
      const keywordTop = new Map();
      const platformTop = new Map();
      const samples = [];
      rows.forEach(row => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const product = extractBitableFieldText(f['差评产品'] || f.product_name);
        const keyword = extractBitableFieldText(f['差评关键词'] || f.keywords);
        const platform = extractBitableFieldText(f['差评平台'] || f.platform);
        const reason = extractBitableFieldText(f['差评原因'] || f.content || f.reason);
        if (product && product !== '无') productTop.set(product, (productTop.get(product) || 0) + 1);
        if (keyword) keyword.split(/[,，、]/).forEach(k => { k = k.trim(); if (k) keywordTop.set(k, (keywordTop.get(k) || 0) + 1); });
        if (platform) {
          const pText = Array.isArray(platform) ? platform.join('') : String(platform);
          pText.split(/[,，、]/).forEach(p => { p = p.trim(); if (p) platformTop.set(p, (platformTop.get(p) || 0) + 1); });
        }
        if (reason && samples.length < 3) samples.push(String(reason).slice(0, 80));
      });
      const topN = (m, n = 5) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      const lines = [`📊 差评/点评数据（${targetStore}·${period.label}）`];
      if (rows.length) {
        lines.push(`- 差评总数：${rows.length}条`);
        if (platformTop.size) lines.push(`- 来源平台：${topN(platformTop, 3)}`);
        if (productTop.size) lines.push(`- 差评产品Top：${topN(productTop)}`);
        if (keywordTop.size) lines.push(`- 关键词Top：${topN(keywordTop)}`);
        if (samples.length) {
          lines.push(`- 最新样例：`);
          samples.forEach(s => lines.push(`  · ${s}`));
        }
      } else {
        lines.push(`- 差评报告：暂无差评记录入库`);
      }
      if (tableVisitDishMap.size) {
        lines.push('', '🍽 桌访不满意菜品（结合桌访巡台数据）：');
        Array.from(tableVisitDishMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, c], i) => lines.push(`${i + 1}. ${d}（${c}次）`));
      }
      lines.push('', '> 数据源：差评报告 + 桌访巡台记录');
      return lines.join('\n');
    } catch (e) {
      return `差评数据查询失败：${e?.message || '未知错误'}`;
    }

  };
}
