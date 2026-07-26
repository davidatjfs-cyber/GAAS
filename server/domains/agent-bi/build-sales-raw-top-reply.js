/**
 * Deterministic sales TOP/bottom reply from pos_sales_detail (Wave A5b).
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicSalesRawTopReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    normalizeStoreKey,
    normalizeStoreLike,
  } = deps;

  return async function buildBiDeterministicSalesRawTopReply(store, text) {

    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    // 避免误拦截“投诉/差评产品”类问题（应由差评查询处理）
    if (/(投诉|差评|负评|客诉|点评|评价.*差)/.test(q)) return '';
    // 只在明确“销售/销量”语义时触发，避免“产品/菜品”泛词造成误路由
    if (!/(热销|畅销|top|TOP|销量|卖得|卖的|销售明细|销售排行|销售排名|卖得最好|卖得最差|卖的最好|卖的最差|最好.*(产品|菜品)|最差.*(产品|菜品)|前\d+|后\d+)/.test(q)) return '';

    const period = resolveDateRangeFromQuestion(q, 30);
    let bizSql = '';
    if (/(外卖|takeaway|delivery)/i.test(q)) {
      bizSql = ` AND lower(regexp_replace(COALESCE(s.biz_type, ''), '\\s+', '', 'g')) IN ('takeaway','delivery','外卖','外送')`;
    } else if (/(堂食|dinein|店内)/i.test(q)) {
      bizSql = ` AND lower(regexp_replace(COALESCE(s.biz_type, ''), '\\s+', '', 'g')) IN ('dinein','堂食','店内','堂食点餐')`;
    }
    const limitMatch = q.match(/(top|TOP|前)\s*(\d{1,2})/);
    const limit = Math.max(1, Math.min(20, Number(limitMatch?.[2] || 10) || 10));
    const askWorst = /(最差|最不好卖|最难卖|倒数|垫底|卖不动|后\d+)/.test(q);
    const sortSql = askWorst ? 'ASC' : 'DESC';

    try {
      const r = await pool().query(
        `SELECT
           s.dish_name,
           ROUND(SUM(COALESCE(s.qty,0))::numeric, 2) AS total_qty,
           ROUND(SUM(COALESCE(s.sales_amount,0))::numeric, 2) AS total_sales,
           ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS total_revenue
         FROM pos_sales_detail s
         WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) = $1
           AND s.date BETWEEN $2 AND $3
           ${bizSql}
           AND COALESCE(s.dish_name,'') <> ''
         GROUP BY s.dish_name
         HAVING SUM(COALESCE(s.qty,0)) > 0
         ORDER BY SUM(COALESCE(s.sales_amount,0)) ${sortSql}
         LIMIT ${limit}`,
        [normalizeStoreKey(targetStore), period.start, period.end]
      );
      const rows = r.rows || [];
      if (!rows.length) {
        return `📦 ${period.label}销售数据（${targetStore}）：暂无可用销售明细数据。`;
      }

      const title = askWorst ? `销售倒数${limit}` : `销售TOP${limit}`;
      const lines = [`📦 ${title}（${targetStore}·${period.label}）`];
      rows.forEach((x, i) => {
        const sales = Number(x.total_sales || 0);
        const rev = Number(x.total_revenue || 0);
        const discRate = sales > 0 ? ((sales - rev) / sales * 100).toFixed(1) : '0.0';
        lines.push(`${i + 1}. ${x.dish_name}｜折前¥${sales.toFixed(0)}｜实收¥${rev.toFixed(0)}｜销量${Number(x.total_qty || 0).toFixed(0)}份｜折扣率${discRate}%`);
      });

      // 时段分析（slot breakdown）
      try {
        const slotR = await pool().query(
          `SELECT COALESCE(s.slot, '未知') AS slot,
                  ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS total_revenue,
                  ROUND(SUM(COALESCE(s.qty,0))::numeric, 0) AS total_qty
           FROM pos_sales_detail s
           WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) = $1
             AND s.date BETWEEN $2 AND $3
             ${bizSql}
           GROUP BY s.slot
           ORDER BY SUM(COALESCE(s.revenue,0)) DESC`,
          [normalizeStoreKey(targetStore), period.start, period.end]
        );
        const slotRows = slotR.rows || [];
        if (slotRows.length) {
          lines.push('', '⏰ **时段分析**');
          for (const sr of slotRows) {
            const slotName = String(sr.slot || '未知').trim() || '未知';
            lines.push(`- ${slotName}：¥${Number(sr.total_revenue || 0).toFixed(0)}（${Number(sr.total_qty || 0).toFixed(0)}份）`);
          }
        }
      } catch (_e) { /* ignore */ }

      // 毛利率（从 daily_reports 获取该时段平均毛利率）
      try {
        const marginR = await pool().query(
          `SELECT ROUND(AVG(actual_margin)::numeric, 1) AS avg_margin
           FROM daily_reports
           WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1
             AND date BETWEEN $2 AND $3 AND actual_margin IS NOT NULL`,
          [normalizeStoreLike(targetStore), period.start, period.end]
        );
        const avgMargin = marginR.rows?.[0]?.avg_margin;
        if (avgMargin != null) {
          lines.push(``, `📊 **同期平均毛利率**: ${avgMargin}%`);
        }
      } catch (_e) { /* ignore */ }

      lines.push('> 数据源：pos_sales_detail（门店销售明细）');
      return lines.join('\n');
    } catch (e) {
      return `销售排行查询失败：${e?.message || '未知错误'}`;
    }

  };
}
