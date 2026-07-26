/**
 * Deterministic daily_reports BI reply (Wave A5a peel from agents.js).
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicDailyReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    normalizeStoreLike,
    normalizeStoreKey,
  } = deps;

  return async function buildBiDeterministicDailyReportReply(store, text) {

    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(营业额|营收|日报|毛利|点评评分|大众点评.*分|dianping|revenue|翻台|订单|客单价|会员|充值|业绩|达成率|目标|生意|经营情况|经营)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 7);
    const storeLike = normalizeStoreLike(targetStore);
    try {
      let sql = `SELECT * FROM daily_reports WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`;
      const params = [storeLike];
      if (period.start) { sql += ` AND date >= $${params.length + 1}`; params.push(period.start); }
      if (period.end) { sql += ` AND date <= $${params.length + 1}`; params.push(period.end); }
      sql += ' ORDER BY date DESC LIMIT 60';
      const r = await pool().query(sql, params);
      const rows = r.rows || [];
      if (!rows.length) {
        // Fallback: 从 pos_sales_detail 按日汇总
        try {
          const salesR = await pool().query(
            `SELECT s.date::text AS date, ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS day_revenue,
                    ROUND(SUM(COALESCE(s.sales_amount,0))::numeric, 2) AS day_sales
             FROM pos_sales_detail s
             WHERE lower(regexp_replace(coalesce(s.store,''), '\\s+', '', 'g')) = $1
               AND s.date BETWEEN $2 AND $3
             GROUP BY s.date ORDER BY s.date DESC LIMIT 60`,
            [normalizeStoreKey(targetStore), period.start, period.end]
          );
          const sRows = salesR.rows || [];
          if (sRows.length) {
            const tRev = sRows.reduce((s, x) => s + (parseFloat(x.day_revenue) || 0), 0);
            const tSales = sRows.reduce((s, x) => s + (parseFloat(x.day_sales) || 0), 0);
            const sLines = [`📊 营收分析（${targetStore} | ${period.label}）`];
            sLines.push(`\n- **实收营业额**: ${tRev.toFixed(2)} (已扣优惠)`);
            if (tSales > 0) sLines.push(`- **折前营业额**: ${tSales.toFixed(1)} (含优惠前金额)`);
            if (tSales > 0 && tRev > 0) sLines.push(`- **总折扣金额**: ${(tSales - tRev).toFixed(2)} (含优惠前金额)`);
            sLines.push(`\n> 数据源：pos_sales_detail（销售明细按日汇总，共${sRows.length}天）`);
            return sLines.join('\n');
          }
        } catch (_e) { /* ignore */ }
        return `📊 ${period.label}营收分析（${targetStore}）：暂无营业数据。`;
      }

      // ── 查本月累计数据（用于补充指标） ──
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      let cumRev = 0, cumPre = 0, monthBudget = 0, monthDays = 0, cumLabor = 0;
      try {
        const mR = await pool().query(
          `SELECT COALESCE(SUM(actual_revenue),0) as cum_rev, COALESCE(SUM(pre_discount_revenue),0) as cum_pre,
                  COALESCE(SUM(budget),0) as budget, COUNT(*) as days, COALESCE(SUM(labor_total),0) as cum_labor
           FROM daily_reports WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1
             AND date >= $2 AND date <= $3`,
          [storeLike, monthStart, period.end || monthStart]
        );
        const m = mR.rows?.[0] || {};
        cumRev = parseFloat(m.cum_rev) || 0;
        cumPre = parseFloat(m.cum_pre) || 0;
        monthBudget = parseFloat(m.budget) || 0;
        monthDays = parseInt(m.days) || 0;
        cumLabor = parseFloat(m.cum_labor) || 0;
      } catch (_e) { /* ignore */ }
      // 优先使用 revenue_targets 表的月目标
      try {
        const rtR = await pool().query(
          `SELECT target_revenue FROM revenue_targets WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1 AND period = $2 LIMIT 1`,
          [storeLike, monthStart.slice(0, 7)]
        );
        if (rtR.rows?.[0]?.target_revenue) monthBudget = parseFloat(rtR.rows[0].target_revenue) || monthBudget;
      } catch (_e) { /* ignore */ }

      // ── 单日/短期（≤2天）：详细格式 ──
      if (rows.length <= 2) {
        const row = rows[0];
        const actualRev = parseFloat(row.actual_revenue) || 0;
        const preDiscount = parseFloat(row.pre_discount_revenue) || 0;
        const totalDiscount = parseFloat(row.total_discount) || 0;
        if (!monthBudget) monthBudget = parseFloat(row.budget) || 0;

        const lines = [`📊 **营收分析 | ${targetStore}**`, `📅 ${period.label}`];
        lines.push('─────────────────────');
        lines.push(`💰 **实收营业额**: ¥${actualRev.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}（已扣优惠）`);
        if (preDiscount > 0) lines.push(`💳 **折前营业额**: ¥${preDiscount.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
        if (totalDiscount > 0) lines.push(`🏷️ **总折扣金额**: ¥${totalDiscount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        lines.push('─────────────────────');
        lines.push('📈 **目标达成情况**');
        if (monthBudget > 0) {
          const achRate = (cumRev / monthBudget * 100).toFixed(1);
          const theoRate = (monthDays / totalDaysInMonth * 100).toFixed(1);
          const achNum = parseFloat(achRate);
          const theoNum = parseFloat(theoRate);
          const achIcon = achNum >= theoNum ? '✅' : achNum >= theoNum - 5 ? '⚠️' : '🔴';
          lines.push(`${achIcon} **实收达成率**: ${achRate}%（累计 ¥${cumRev.toLocaleString('zh-CN', { minimumFractionDigits: 0 })} / 目标 ¥${monthBudget.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}）`);
          lines.push(`📐 **理论达成率**: ${theoRate}%（${monthDays}/${totalDaysInMonth}天）`);
          const gap = achNum - theoNum;
          lines.push(`${gap >= 0 ? '🟢' : '🔴'} **进度差值**: ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%（${gap >= 0 ? '超前' : '落后'}目标进度）`);
        }
        lines.push('─────────────────────');
        lines.push('🔍 **其他指标**');
        const margin = row.actual_margin != null ? parseFloat(row.actual_margin) : null;
        lines.push(margin != null && !isNaN(margin) ? `📊 **毛利率**: ${margin.toFixed(1)}%` : `📊 **毛利率**: 暂无（当日明细未录入）`);
        const dp = row.dianping_rating != null ? parseFloat(row.dianping_rating) : null;
        if (dp != null && !isNaN(dp)) lines.push(`⭐ **大众点评**: ${dp.toFixed(2)} 分`);
        const eff = row.efficiency != null ? parseFloat(row.efficiency) : null;
        const labor = row.labor_total != null ? parseFloat(row.labor_total) : null;
        if (eff != null && !isNaN(eff) && eff > 0) {
          const laborTxt = labor != null && !isNaN(labor) && labor > 0 ? `（出勤 ${labor.toFixed(0)} 工时）` : '';
          lines.push(`👥 **今日人效值**: ¥${Math.round(eff).toLocaleString('zh-CN')}${laborTxt}`);
        } else if (labor != null && !isNaN(labor) && labor > 0 && actualRev > 0) {
          lines.push(`👥 **今日人效值**: ¥${Math.round(actualRev / labor).toLocaleString('zh-CN')}（实收÷工时，出勤 ${labor.toFixed(0)} 工时）`);
        } else {
          lines.push(`👥 **今日人效值**: 暂无（出勤工时未录入）`);
        }
        if (cumLabor > 0 && cumPre > 0) {
          const cumEff = Math.round(cumPre / cumLabor);
          lines.push(`📦 **本月累计人效**: ¥${cumEff.toLocaleString('zh-CN')}（折前 ¥${Math.round(cumPre).toLocaleString('zh-CN')} / 出勤 ${cumLabor.toFixed(1)} 工时）`);
        } else if (cumLabor > 0 && cumRev > 0) {
          lines.push(`📦 **本月累计人效**: ¥${Math.round(cumRev / cumLabor).toLocaleString('zh-CN')}（实收÷工时）`);
        }
        // 堂食/外卖单数（单日）
        try {
          const dayDate = row.date || period.start;
          if (dayDate) {
            const bizR = await pool().query(
              `SELECT COALESCE(s.biz_type, '') AS biz_type,
                      ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS total_revenue,
                      ROUND(SUM(COALESCE(s.qty,0))::numeric, 0) AS total_qty
               FROM pos_sales_detail s
               WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) LIKE $1
                 AND s.date = $2
               GROUP BY s.biz_type`,
              [storeLike, dayDate]
            );
            const bizRows = bizR.rows || [];
            if (bizRows.length) {
              lines.push('─────────────────────');
              lines.push('🍽 **堂食/外卖拆分**');
              for (const bRow of bizRows) {
                const bt = String(bRow.biz_type || '').trim().toLowerCase();
                const label = (bt === 'dinein' || bt === 'dine_in' || bt === '堂食') ? '堂食'
                  : (bt === 'takeaway' || bt === 'delivery' || bt === '外卖' || bt === '外送') ? '外卖'
                  : bt || '其他';
                const rev = parseFloat(bRow.total_revenue) || 0;
                const qty = parseInt(bRow.total_qty) || 0;
                lines.push(`- ${label}：¥${rev.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}（${qty}份）`);
              }
            }
          }
        } catch (_e) { /* ignore */ }
        return lines.join('\n');
      }

      // ── 多日：汇总格式 ──
      const totalRevenue = rows.reduce((s, r) => s + (parseFloat(r.actual_revenue) || 0), 0);
      const totalPre = rows.reduce((s, r) => s + (parseFloat(r.pre_discount_revenue) || 0), 0);
      const totalDisc = rows.reduce((s, r) => s + (parseFloat(r.total_discount) || 0), 0);
      const avgMarginArr = rows.filter(r => r.actual_margin != null);
      const avgMarginVal = avgMarginArr.length ? (avgMarginArr.reduce((s, r) => s + parseFloat(r.actual_margin), 0) / avgMarginArr.length).toFixed(1) : null;
      const dianpingRows = rows.filter(r => r.dianping_rating != null);
      const avgDianping = dianpingRows.length ? (dianpingRows.reduce((s, r) => s + parseFloat(r.dianping_rating), 0) / dianpingRows.length).toFixed(2) : null;
      const lines = [`📊 **营收分析 | ${targetStore}**`, `📅 ${period.label}`];
      lines.push('─────────────────────');
      lines.push(`💰 **实收营业额**: ¥${totalRevenue.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}（${rows.length}天合计）`);
      if (totalPre > 0) lines.push(`💳 **折前营业额**: ¥${totalPre.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
      if (totalDisc > 0) lines.push(`🏷️ **总折扣金额**: ¥${totalDisc.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
      lines.push(`📆 **日均实收**: ¥${Math.round(totalRevenue / rows.length).toLocaleString('zh-CN')}`);
      lines.push('─────────────────────');
      lines.push('📈 **目标达成情况**');
      if (monthBudget > 0) {
        const achRate = (cumRev / monthBudget * 100).toFixed(1);
        const theoRate = (monthDays / totalDaysInMonth * 100).toFixed(1);
        const achNum = parseFloat(achRate);
        const theoNum = parseFloat(theoRate);
        const achIcon = achNum >= theoNum ? '✅' : achNum >= theoNum - 5 ? '⚠️' : '🔴';
        lines.push(`${achIcon} **实收达成率**: ${achRate}%（累计 ¥${cumRev.toLocaleString('zh-CN', { minimumFractionDigits: 0 })} / 目标 ¥${monthBudget.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}）`);
        lines.push(`📐 **理论达成率**: ${theoRate}%（${monthDays}/${totalDaysInMonth}天）`);
        const gap = achNum - theoNum;
        lines.push(`${gap >= 0 ? '🟢' : '🔴'} **进度差值**: ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%（${gap >= 0 ? '超前' : '落后'}目标进度）`);
      }
      if (avgMarginVal) lines.push(`📊 **平均毛利率**: ${avgMarginVal}%`);
      if (avgDianping) lines.push(`⭐ **大众点评均分**: ${avgDianping}`);
      // 人效值
      const effRows = rows.filter(r => r.efficiency != null && parseFloat(r.efficiency) > 0);
      const laborRows = rows.filter(r => r.labor_total != null && parseFloat(r.labor_total) > 0);
      if (effRows.length) {
        const avgEff = effRows.reduce((s, r) => s + parseFloat(r.efficiency), 0) / effRows.length;
        const totalLabor = laborRows.reduce((s, r) => s + parseFloat(r.labor_total), 0);
        lines.push(`👥 **平均人效值**: ¥${Math.round(avgEff).toLocaleString('zh-CN')}${totalLabor > 0 ? `（总出勤 ${totalLabor.toFixed(1)} 工时）` : ''}`);
      }
      if (cumLabor > 0 && cumPre > 0) {
        const cumEff = Math.round(cumPre / cumLabor);
        lines.push(`📦 **本月累计人效**: ¥${cumEff.toLocaleString('zh-CN')}`);
      }
      // 堂食/外卖单数（从 pos_sales_detail 查询）
      try {
        const bizR = await pool().query(
          `SELECT
             COALESCE(s.biz_type, '') AS biz_type,
             COUNT(DISTINCT s.date) AS days,
             ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS total_revenue,
             ROUND(SUM(COALESCE(s.qty,0))::numeric, 0) AS total_qty
           FROM pos_sales_detail s
           WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) LIKE $1
             AND s.date BETWEEN $2 AND $3
           GROUP BY s.biz_type`,
          [storeLike, period.start, period.end]
        );
        const bizRows = bizR.rows || [];
        if (bizRows.length) {
          lines.push('─────────────────────');
          lines.push('🍽 **堂食/外卖拆分**');
          for (const bRow of bizRows) {
            const bt = String(bRow.biz_type || '').trim().toLowerCase();
            const label = (bt === 'dinein' || bt === 'dine_in' || bt === '堂食') ? '堂食'
              : (bt === 'takeaway' || bt === 'delivery' || bt === '外卖' || bt === '外送') ? '外卖'
              : bt || '其他';
            const rev = parseFloat(bRow.total_revenue) || 0;
            const qty = parseInt(bRow.total_qty) || 0;
            lines.push(`- ${label}：¥${rev.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}（${qty}份）`);
          }
        }
      } catch (_e) { /* ignore */ }
      if (rows.length >= 4) {
        const recent3 = rows.slice(0, 3).reduce((s, r) => s + (parseFloat(r.actual_revenue) || 0), 0) / 3;
        const older = rows.slice(3).reduce((s, r) => s + (parseFloat(r.actual_revenue) || 0), 0) / rows.slice(3).length;
        if (older > 0) {
          const trend = ((recent3 - older) / older * 100).toFixed(1);
          lines.push(`📉 **近期趋势**: 近3天日均 vs 之前 ${Number(trend) >= 0 ? '+' : ''}${trend}%`);
        }
      }
      return lines.join('\n');
    } catch (e) {
      return `营收分析查询失败：${e?.message || '未知错误'}`;
    }

  };
}
