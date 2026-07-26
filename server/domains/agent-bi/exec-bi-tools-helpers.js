/**
 * BI function-tool executors (P2 peel from agents.js).
 * Each helper takes deps as first arg — no closure over agents.js.
 */
import { clampInt, resolveToolPeriod } from './bi-tool-period.js';

export async function execBiToolSalesRanking(deps, store, args = {}, originalQuery = '') {
  const { pool, normalizeStoreLike } = deps;
  const targetStore = String(store || '').trim();
  if (!targetStore) return { ok: false, text: '当前账号未绑定门店，无法查询销售排行。', source: 'pos_sales_detail' };

  const period = resolveToolPeriod(args, 30, originalQuery);
  const limit = clampInt(args.limit, 1, 20, 10);
  const metric = ['sales_amount', 'revenue', 'qty'].includes(String(args.metric || '')) ? String(args.metric) : 'sales_amount';
  const sortOrder = String(args.sort_order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const bizType = String(args.biz_type || 'all').toLowerCase();

  let bizSql = '';
  if (bizType === 'takeaway') {
    bizSql = ` AND lower(regexp_replace(COALESCE(s.biz_type, ''), '\\s+', '', 'g')) IN ('takeaway','delivery','外卖','外送')`;
  } else if (bizType === 'dinein') {
    bizSql = ` AND lower(regexp_replace(COALESCE(s.biz_type, ''), '\\s+', '', 'g')) IN ('dinein','堂食','店内','堂食点餐')`;
  }

  const metricSql = metric === 'qty'
    ? 'SUM(COALESCE(s.qty,0))'
    : metric === 'revenue'
      ? 'SUM(COALESCE(s.revenue,0))'
      : 'SUM(COALESCE(s.sales_amount,0))';

  try {
    const r = await pool().query(
      `SELECT
         s.dish_name,
         ROUND(SUM(COALESCE(s.qty,0))::numeric, 2) AS total_qty,
         ROUND(SUM(COALESCE(s.sales_amount,0))::numeric, 2) AS total_sales,
         ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS total_revenue
       FROM pos_sales_detail s
       WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) LIKE $1
         AND s.date BETWEEN $2 AND $3
         ${bizSql}
         AND COALESCE(s.dish_name,'') <> ''
       GROUP BY s.dish_name
       HAVING SUM(COALESCE(s.qty,0)) > 0
       ORDER BY ${metricSql} ${sortOrder}
       LIMIT ${limit}`,
      [normalizeStoreLike(targetStore), period.start, period.end]
    );

    let rows = r.rows || [];
    if (!rows.length) {
      // Fallback: check available data range and use most recent data
      try {
        const rangeR = await pool().query(
          `SELECT MAX(date)::text as max_d, MIN(date)::text as min_d FROM pos_sales_detail WHERE lower(regexp_replace(COALESCE(store,''), '\\s+', '', 'g')) LIKE $1`,
          [normalizeStoreLike(targetStore)]
        );
        const maxDate = rangeR.rows?.[0]?.max_d;
        if (maxDate && maxDate < period.start) {
          // Data exists but not for requested period - use last 7 days of available data
          const fbEnd = maxDate;
          const fbStartD = new Date(new Date(maxDate).getTime() - 6 * 86400000);
          const fbStart = fbStartD.toISOString().slice(0, 10);
          const fbR = await pool().query(
            `SELECT s.dish_name, ROUND(SUM(COALESCE(s.qty,0))::numeric,2) AS total_qty, ROUND(SUM(COALESCE(s.sales_amount,0))::numeric,2) AS total_sales, ROUND(SUM(COALESCE(s.revenue,0))::numeric,2) AS total_revenue
             FROM pos_sales_detail s WHERE lower(regexp_replace(COALESCE(s.store,''), '\\s+', '', 'g')) LIKE $1 AND s.date BETWEEN $2 AND $3 ${bizSql} AND COALESCE(s.dish_name,'') <> ''
             GROUP BY s.dish_name HAVING SUM(COALESCE(s.qty,0)) > 0 ORDER BY ${metricSql} ${sortOrder} LIMIT ${limit}`,
            [normalizeStoreLike(targetStore), fbStart, fbEnd]
          );
          rows = fbR.rows || [];
          if (rows.length) {
            const fbTitle = sortOrder === 'ASC' ? `销售倒数${limit}` : `销售TOP${limit}`;
            const fbMetricLabel = metric === 'qty' ? '销量' : metric === 'revenue' ? '实收金额' : '折前金额';
            const fbScope = bizType === 'all' ? '全部业态' : (bizType === 'dinein' ? '堂食' : '外卖');
            const lines = [`⚠️ ${period.label}暂无销售数据，以下为最近可用数据（${fbStart} ~ ${fbEnd}）：`, `📦 ${fbTitle}（${targetStore}·${fbScope}）`, `排序口径：${fbMetricLabel}`];
            rows.forEach((x, i) => {
              lines.push(`${i + 1}. ${x.dish_name}｜折前¥${Number(x.total_sales || 0).toFixed(0)}｜实收¥${Number(x.total_revenue || 0).toFixed(0)}｜销量${Number(x.total_qty || 0).toFixed(0)}份`);
            });
            lines.push(`> ⚠️ 销售数据最新截至 ${maxDate}，请上传最新销售数据`);
            return { ok: true, source: 'pos_sales_detail', text: lines.join('\n') };
          }
          return { ok: true, source: 'pos_sales_detail', text: `📦 ${period.label}销售数据（${targetStore}）：暂无可用销售明细。\n⚠️ 销售数据最新截至 ${maxDate}，请上传最新数据。` };
        }
      } catch (_e) { /* ignore */ }
      return { ok: true, source: 'pos_sales_detail', text: `📦 ${period.label}销售数据（${targetStore}）：暂无可用销售明细。` };
    }

    const title = sortOrder === 'ASC' ? `销售倒数${limit}` : `销售TOP${limit}`;
    const metricLabel = metric === 'qty' ? '销量' : metric === 'revenue' ? '实收金额' : '折前金额';
    const scope = bizType === 'all' ? '全部业态' : (bizType === 'dinein' ? '堂食' : '外卖');
    const lines = [`📦 ${title}（${targetStore}·${period.label}·${scope}）`, `排序口径：${metricLabel}`];
    rows.forEach((x, i) => {
      lines.push(`${i + 1}. ${x.dish_name}｜折前¥${Number(x.total_sales || 0).toFixed(0)}｜实收¥${Number(x.total_revenue || 0).toFixed(0)}｜销量${Number(x.total_qty || 0).toFixed(0)}份`);
    });
    lines.push('> 数据源：pos_sales_detail（门店销售明细）');
    return { ok: true, source: 'pos_sales_detail', text: lines.join('\n') };
  } catch (e) {
    return { ok: false, source: 'pos_sales_detail', text: `销售排行查询失败：${e?.message || '未知错误'}` };
  }
}

export async function execBiToolComplaintRanking(deps, store, args = {}, originalQuery = '') {
  const {
    pool,
    getBadReviewTableId,
    normalizeBitableDateValue,
    extractBitableFieldText,
    isLikelySameStore,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
  } = deps;
  const targetStore = String(store || '').trim();
  if (!targetStore) return { ok: false, text: '当前账号未绑定门店，无法查询投诉排行。', source: 'bad_reviews' };

  const period = resolveToolPeriod(args, 30, originalQuery);
  const limit = clampInt(args.limit, 1, 20, 10);
  const asc = String(args.sort_order || 'desc').toLowerCase() === 'asc';
  const badReviewTableId = String(getBadReviewTableId?.() || '').trim();

  try {
    const normalizeReviewDate = (fields, createdAt) => normalizeBitableDateValue(
      fields?.['差评日期'] || fields?.['创建日期'] || fields?.['日期'] || fields?.['提交时间'] || fields?.['评价日期'] || fields?.date,
      createdAt
    );
    let rows = [];
    if (badReviewTableId) {
      const r = await pool().query(
        `SELECT fields, created_at FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 3000`,
        [badReviewTableId]
      );
      rows = (r.rows || []).filter((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const rowStore = extractBitableFieldText(f['差评门店'] || f['门店'] || f['所属门店']);
        if (!isLikelySameStore(rowStore, targetStore)) return false;
        const d = normalizeReviewDate(f, row?.created_at);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
    }

    if (!rows.length) {
      const r2 = await pool().query(
        `SELECT agent_data as fields, created_at FROM agent_messages WHERE content_type = 'negative_review' ORDER BY created_at DESC LIMIT 3000`
      );
      rows = (r2.rows || []).filter((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const rowStore = extractBitableFieldText(
          f['差评门店'] || f['门店'] || f['所属门店'] || f.store || f?.fields?.store || f?.fields?.['所属门店']
        );
        if (!isLikelySameStore(rowStore, targetStore)) return false;
        const d = normalizeReviewDate(f, row?.created_at);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
    }

    // 补充桌访不满意菜品数据
    let tableVisitDishMap = new Map();
    try {
      const tvRows = await loadUnifiedTableVisitRowsByStore(targetStore, period.start, period.end);
      for (const row of tvRows) {
        const items = String(row.dissatisfaction_dish || '').split(/[，,、]+/).map((x) => x.trim()).filter((x) => x && x !== '无');
        for (const item of items) { tableVisitDishMap.set(item, (tableVisitDishMap.get(item) || 0) + 1); }
      }
    } catch (_e) { /* ignore */ }

    if (!rows.length && !tableVisitDishMap.size) {
      return { ok: true, source: 'bad_reviews', text: `📊 ${period.label}投诉数据（${targetStore}）：暂无投诉/差评记录，桌访也无不满意菜品。` };
    }

    const productTop = new Map();
    rows.forEach((row) => {
      const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
      const product = extractBitableFieldText(f['差评产品'] || f.product_name || f['菜品'] || f['产品']);
      if (product && product !== '无') {
        productTop.set(product, (productTop.get(product) || 0) + 1);
      }
    });

    // 合并桌访不满意菜品到排行
    for (const [dish, count] of tableVisitDishMap.entries()) {
      productTop.set(dish, (productTop.get(dish) || 0) + count);
    }

    const sorted = Array.from(productTop.entries()).sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1])).slice(0, limit);
    if (!sorted.length) {
      return { ok: true, source: 'bad_reviews', text: `📊 ${period.label}投诉数据（${targetStore}）：未提取到有效菜品字段。` };
    }

    const title = asc ? `投诉最少产品TOP${limit}` : `投诉最多产品TOP${limit}`;
    const lines = [`📊 ${title}（${targetStore}·${period.label}）`];
    sorted.forEach(([name, count], idx) => lines.push(`${idx + 1}. ${name}（${count}次）`));
    lines.push('> 数据源：差评报告 + 桌访巡台记录');
    return { ok: true, source: 'bad_reviews', text: lines.join('\n') };
  } catch (e) {
    return { ok: false, source: 'bad_reviews', text: `投诉排行查询失败：${e?.message || '未知错误'}` };
  }
}

export async function execBiToolRevenueSummary(deps, store, args = {}, originalQuery = '') {
  const { pool, normalizeStoreLike } = deps;
  const targetStore = String(store || '').trim();
  if (!targetStore) return { ok: false, text: '当前账号未绑定门店，无法查询营业汇总。', source: 'daily_reports' };

  const period = resolveToolPeriod(args, 7, originalQuery);
  try {
    const r = await pool().query(
      `SELECT date, actual_revenue, target_revenue, actual_margin, dianping_rating
       FROM daily_reports
       WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1
         AND date BETWEEN $2 AND $3
       ORDER BY date DESC
       LIMIT 90`,
      [normalizeStoreLike(targetStore), period.start, period.end]
    );
    const rows = r.rows || [];
    if (rows.length) {
      const totalRevenue = rows.reduce((s, x) => s + (parseFloat(x.actual_revenue) || 0), 0);
      const totalTarget = rows.reduce((s, x) => s + (parseFloat(x.target_revenue) || 0), 0);
      const achieveRate = totalTarget > 0 ? (totalRevenue / totalTarget * 100).toFixed(1) : null;
      const avgMarginRows = rows.filter((x) => x.actual_margin != null);
      const avgMargin = avgMarginRows.length
        ? (avgMarginRows.reduce((s, x) => s + (parseFloat(x.actual_margin) || 0), 0) / avgMarginRows.length).toFixed(1)
        : null;

      const lines = [`📊 营业汇总（${targetStore}·${period.label}）`, `- 统计天数：${rows.length}天`, `- 累计营收：¥${totalRevenue.toFixed(0)}`];
      if (totalTarget > 0) lines.push(`- 目标营收：¥${totalTarget.toFixed(0)}（达成率 ${achieveRate}%）`);
      lines.push(`- 日均营收：¥${(totalRevenue / rows.length).toFixed(0)}`);
      if (avgMargin != null) lines.push(`- 平均毛利率：${avgMargin}%`);
      lines.push('> 数据源：daily_reports（营业日报）');
      return { ok: true, source: 'daily_reports', text: lines.join('\n') };
    }

    // Fallback: daily_reports 无数据时从 pos_sales_detail 按日汇总
    const salesR = await pool().query(
      `SELECT s.date::text AS date, ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS day_revenue,
              ROUND(SUM(COALESCE(s.sales_amount,0))::numeric, 2) AS day_sales
       FROM pos_sales_detail s
       WHERE lower(regexp_replace(coalesce(s.store,''), '\\s+', '', 'g')) LIKE $1
         AND s.date BETWEEN $2 AND $3
       GROUP BY s.date
       ORDER BY s.date DESC
       LIMIT 90`,
      [normalizeStoreLike(targetStore), period.start, period.end]
    );
    const salesRows = salesR.rows || [];
    if (!salesRows.length) {
      return { ok: true, source: 'daily_reports', text: `📊 ${period.label}营业数据（${targetStore}）：暂无营业数据（日报和销售明细均无记录）。` };
    }
    const totalSalesRevenue = salesRows.reduce((s, x) => s + (parseFloat(x.day_revenue) || 0), 0);
    const totalSalesAmount = salesRows.reduce((s, x) => s + (parseFloat(x.day_sales) || 0), 0);
    const sLines = [`📊 营业汇总（${targetStore}·${period.label}）`, `- 统计天数：${salesRows.length}天`, `- 累计实收：¥${totalSalesRevenue.toFixed(0)}`];
    if (totalSalesAmount > 0) sLines.push(`- 累计折前：¥${totalSalesAmount.toFixed(0)}`);
    sLines.push(`- 日均实收：¥${(totalSalesRevenue / salesRows.length).toFixed(0)}`);
    sLines.push('> 数据源：pos_sales_detail（销售明细按日汇总，营业日报暂无数据）');
    return { ok: true, source: 'pos_sales_detail', text: sLines.join('\n') };
  } catch (e) {
    return { ok: false, source: 'daily_reports', text: `营业汇总查询失败：${e?.message || '未知错误'}` };
  }
}

/** Pure weighted forecast used by revenue next-day tool. */
export function scoredRevenueForecast(rows, revKey, tomorrow, tomorrowDow) {
  if (!rows.length) return { pred: 0, min: 0, max: 0, sameDow: 0 };
  let sW = 0; let sV = 0; let lo = Infinity; let hi = 0; let sameDow = 0;
  for (const r of rows) {
    const v = Number(r[revKey]) || 0;
    if (v <= 0) continue;
    const d = new Date(`${String(r.date)}T00:00:00`);
    if (!Number.isFinite(d.getTime())) continue;
    const dow = d.getDay();
    let sc = 1;
    if (dow === tomorrowDow) { sc += 3.0; sameDow++; }
    else {
      const adj = Math.min(Math.abs(dow - tomorrowDow), 7 - Math.abs(dow - tomorrowDow));
      if (adj === 1) sc += 0.4;
    }
    const dd = Math.abs(Math.round((tomorrow.getTime() - d.getTime()) / 86400000));
    sc += Math.max(0, 1.0 - Math.min(1.0, dd / 60));
    sW += sc; sV += v * sc;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  if (sW <= 0) return { pred: 0, min: 0, max: 0, sameDow: 0 };
  return { pred: sV / sW, min: lo, max: hi, sameDow };
}

export async function execBiToolRevenueForecastNextDay(deps, store, args = {}) {
  const { pool, normalizeStoreLike, formatDate } = deps;
  const targetStore = String(store || '').trim();
  if (!targetStore) return { ok: false, text: '当前账号未绑定门店，无法预测营业额。', source: 'daily_reports' };

  const lookbackDays = Math.max(28, clampInt(args.lookback_days, 14, 90, 60));
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (lookbackDays - 1));
  const startText = formatDate(start);
  const endText = formatDate(end);
  const tomorrow = new Date(end);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowText = formatDate(tomorrow);
  const tomorrowDow = tomorrow.getDay();

  try {
    const dailyR = await pool().query(
      `SELECT date, actual_revenue
       FROM daily_reports
       WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1
         AND date BETWEEN $2 AND $3
         AND actual_revenue IS NOT NULL
       ORDER BY date DESC
       LIMIT 60`,
      [normalizeStoreLike(targetStore), startText, endText]
    );
    const dailyRows = dailyR.rows || [];
    if (dailyRows.length >= 3) {
      const f = scoredRevenueForecast(dailyRows, 'actual_revenue', tomorrow, tomorrowDow);
      const pred = f.pred;
      const minV = f.min;
      const maxV = f.max;
      return {
        ok: true,
        source: 'daily_reports',
        text: `📈 明日营业额预测（${targetStore}）\n- 预测日期：${tomorrowText}（${'日一二三四五六'[tomorrowDow]}）\n- 预测值：¥${pred.toFixed(0)}\n- 参考区间：¥${minV.toFixed(0)} ~ ¥${maxV.toFixed(0)}\n- 同星期样本：${f.sameDow}天（权重×4）\n- 依据样本：近${lookbackDays}天营业日报（${dailyRows.length}天有效样本）\n> 算法：星期相似度加权+时间衰减，数据源：daily_reports`,
      };
    }

    // 回退到 pos_sales_detail 的按日实收汇总
    const salesR = await pool().query(
      `SELECT s.date, ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS day_revenue
       FROM pos_sales_detail s
       WHERE lower(regexp_replace(coalesce(s.store,''), '\\s+', '', 'g')) LIKE $1
         AND s.date BETWEEN $2 AND $3
       GROUP BY s.date
       ORDER BY s.date DESC
       LIMIT 60`,
      [normalizeStoreLike(targetStore), startText, endText]
    );
    const salesRows = salesR.rows || [];
    if (salesRows.length < 3) {
      // 兜底：扩大窗口到近60天，给出低置信预测，避免“等于没回答”
      const longR = await pool().query(
        `SELECT s.date, ROUND(SUM(COALESCE(s.revenue,0))::numeric, 2) AS day_revenue
         FROM pos_sales_detail s
         WHERE lower(regexp_replace(coalesce(s.store,''), '\\s+', '', 'g')) LIKE $1
           AND s.date BETWEEN $2 AND $3
         GROUP BY s.date
         ORDER BY s.date DESC
         LIMIT 60`,
        [normalizeStoreLike(targetStore), formatDate(new Date(Date.now() - 59 * 86400000)), endText]
      );
      const longRows = longR.rows || [];
      if (longRows.length < 3) {
        return { ok: true, source: 'daily_reports', text: `📈 明日营业额预测（${targetStore}）：样本不足（近${lookbackDays}天有效样本少于3天，近60天也不足3天），暂无法给出可信预测。` };
      }
      const lf = scoredRevenueForecast(longRows, 'day_revenue', tomorrow, tomorrowDow);
      const longPred = lf.pred;
      const longMin = lf.min;
      const longMax = lf.max;
      return {
        ok: true,
        source: 'pos_sales_detail',
        text: `📈 明日营业额预测（${targetStore}）\n- 预测日期：${tomorrowText}（${'日一二三四五六'[tomorrowDow]}）\n- 预测值：¥${longPred.toFixed(0)}\n- 参考区间：¥${longMin.toFixed(0)} ~ ¥${longMax.toFixed(0)}\n- 同星期样本：${lf.sameDow}天（权重×4）\n- 依据样本：近60天销售明细按日汇总（${longRows.length}天有效样本）\n- 置信度：较低（近期样本不足，已启用长窗口兜底）\n> 算法：星期相似度加权+时间衰减，数据源：pos_sales_detail`,
      };
    }
    const sf = scoredRevenueForecast(salesRows, 'day_revenue', tomorrow, tomorrowDow);
    const pred = sf.pred;
    const minV = sf.min;
    const maxV = sf.max;
    return {
      ok: true,
      source: 'pos_sales_detail',
      text: `📈 明日营业额预测（${targetStore}）\n- 预测日期：${tomorrowText}（${'日一二三四五六'[tomorrowDow]}）\n- 预测值：¥${pred.toFixed(0)}\n- 参考区间：¥${minV.toFixed(0)} ~ ¥${maxV.toFixed(0)}\n- 同星期样本：${sf.sameDow}天（权重×4）\n- 依据样本：近${lookbackDays}天销售明细按日汇总（${salesRows.length}天有效样本）\n> 算法：星期相似度加权+时间衰减，数据源：pos_sales_detail`,
    };
  } catch (e) {
    return { ok: false, source: 'daily_reports', text: `营业额预测查询失败：${e?.message || '未知错误'}` };
  }
}

export async function execBiToolTableVisit(deps, store, args = {}, originalQuery = '') {
  const { loadUnifiedTableVisitRowsByStore } = deps;
  const targetStore = String(store || '').trim();
  if (!targetStore) return { ok: false, text: '当前账号未绑定门店，无法查询桌访记录。', source: 'table_visit_records' };

  const period = resolveToolPeriod(args, 7, originalQuery);
  try {
    const rows = await loadUnifiedTableVisitRowsByStore(targetStore, period.start, period.end, true);
    if (!rows.length) {
      return { ok: true, source: 'table_visit_records', text: `📋 ${period.label}桌访记录（${targetStore}）：暂无桌访数据。` };
    }
    // 维度1：不满意菜品（dissatisfaction_dish）
    const dishMap = {};
    for (const row of rows) {
      const items = String(row.dissatisfaction_dish || '').split(/[，,、]+/).map((x) => x.trim()).filter((x) => x && !/卤鹅/.test(x));
      for (const item of items) { dishMap[item] = (dishMap[item] || 0) + 1; }
    }
    const dishSorted = Object.entries(dishMap).sort((a, b) => b[1] - a[1]);
    // 维度2：顾客反馈/不满意原因（unsatisfied_items）— 这是桌访现场反馈，非大众点评差评
    const feedbackMap = {};
    const blockedFb = new Set(['无', '没有', '暂无', '不清楚', '未知', '其他', '']);
    for (const row of rows) {
      const fb = String(row.unsatisfied_items || '').trim();
      if (fb && !blockedFb.has(fb)) {
        fb.split(/[，,、]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => { feedbackMap[x] = (feedbackMap[x] || 0) + 1; });
      }
    }
    const fbSorted = Object.entries(feedbackMap).sort((a, b) => b[1] - a[1]);

    const lines = [`📋 桌访反馈（${targetStore}·${period.label}）【注意：此数据来源于门店桌访巡台，非大众点评差评】`, `共${rows.length}条桌访记录`];
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
    lines.push('', '> 数据源：table_visit_records（桌访巡台记录，非大众点评）');
    return { ok: true, source: 'table_visit_records', text: lines.join('\n') };
  } catch (e) {
    return { ok: false, source: 'table_visit_records', text: `桌访数据查询失败：${e?.message || '未知错误'}` };
  }
}

export async function runBiFunctionToolBody(deps, toolName, store, args = {}, originalQuery = '', ctx = {}) {
  const { pool, logAgentOperation } = deps;
  const auditBase = {
    operatorUsername: ctx.operatorUsername || null,
    operatorRole: ctx.operatorRole || null,
    tenantId: ctx.tenantId || null,
    toolName,
    storeId: store || null,
    args,
  };
  try { await logAgentOperation(pool(), { ...auditBase, resultSummary: 'tool execution started', status: 'started' }); } catch (_e) { /* ignore */ }
  let result;
  try {
    if (toolName === 'query_sales_ranking') result = await execBiToolSalesRanking(deps, store, args, originalQuery);
    else if (toolName === 'query_complaint_product_ranking') result = await execBiToolComplaintRanking(deps, store, args, originalQuery);
    else if (toolName === 'query_revenue_summary') result = await execBiToolRevenueSummary(deps, store, args, originalQuery);
    else if (toolName === 'query_revenue_forecast_next_day') result = await execBiToolRevenueForecastNextDay(deps, store, args);
    else if (toolName === 'query_table_visit') result = await execBiToolTableVisit(deps, store, args, originalQuery);
    else result = { ok: false, source: 'unknown', text: `不支持的工具：${toolName}` };
  } catch (e) {
    try { await logAgentOperation(pool(), { ...auditBase, resultSummary: null, status: 'error', errorMessage: e?.message || String(e) }); } catch (_e2) { /* ignore */ }
    throw e;
  }
  try {
    await logAgentOperation(pool(), {
      ...auditBase,
      resultSummary: String(result?.text || '').slice(0, 500),
      status: result?.ok ? 'success' : 'error',
      errorMessage: result?.ok ? null : String(result?.text || '').slice(0, 500),
    });
  } catch (_e) { /* ignore */ }
  return result;
}
