/**
 * P4 peel: formatReportMarkdown section helpers.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function createMarkdownFormatters(deps) {
  const {
    COST_COVERAGE_GOOD_THRESHOLD_PCT,
    COST_COVERAGE_WARN_THRESHOLD_PCT,
    wow,
  } = deps;

  const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—（无有效基数）' : `${v.toFixed(1)}%`);
  const fmtSignedPct = (v) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—（无上期可对比）';
    const sign = v > 0 ? '↑' : v < 0 ? '↓' : '→';
    return `${sign}${Math.abs(v).toFixed(1)}%`;
  };
  const fmtMoney = (v) => {
    const n = toNum(v);
    if (n >= 10000) return `¥${(n / 10000).toFixed(2)}万`;
    return `¥${n.toFixed(0)}`;
  };
  const fmtMoneyPlain = (v) => `¥${toNum(v).toFixed(0)}`;
  const sep = '─'.repeat(18);
  const coverageLabel = (v) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—（无数据）';
    if (v >= COST_COVERAGE_GOOD_THRESHOLD_PCT) return `✅${v.toFixed(1)}%`;
    if (v >= COST_COVERAGE_WARN_THRESHOLD_PCT) return `⚠️${v.toFixed(1)}%`;
    return `🚨${v.toFixed(1)}%`;
  };

  return { fmtPct, fmtSignedPct, fmtMoney, fmtMoneyPlain, sep, coverageLabel, wow };
}

export function formatReportHeader(r, fmt, deps) {
  const { dataDays, actualStart, actualEnd, periodLabel } = deps.reportMeta;
  let md = '';
  md += `**${r.store}**\n`;
  if (r.storeDbKey && String(r.storeDbKey) !== String(r.store)) {
    md += `> 数据查询门店：**${r.storeDbKey}**（与展示名不一致时已自动/提示对齐）\n`;
  }
  md += `**${periodLabel}经营分析报告**\n`;
  md += `${actualStart} ~ ${actualEnd}（共${dataDays}天 pos_sales_detail 有数据）\n`;
  if (actualStart !== r.weekStart || actualEnd !== r.weekEnd) {
    md += `> 注：统计周期 ${r.weekStart}~${r.weekEnd}，pos_sales_detail 实际有数据 ${dataDays} 天\n`;
  }
  const warns = r.dataQualityWarnings || [];
  if (warns.length) {
    md += `\n**⚠ 数据质量提醒**\n`;
    warns.forEach((w) => { md += `- ${w}\n`; });
  }
  return md;
}

export function formatReportExecutiveSummary(r, fmt, deps) {
  const { dataDays } = deps.reportMeta;
  const { fmtMoney, fmtSignedPct, sep } = fmt;
  let md = `\n${sep}\n`;
  md += `**一、执行摘要**\n\n`;
  const fb = r.sections.fallbackDaily;
  const fbDailyDays = fb && fb.current ? Number(fb.current.days || 0) : 0;
  const fbHasNumbers = fb && fb.current && (toNum(fb.current.revenue) > 0 || toNum(fb.current.orders) > 0);
  if (fb && fb.current && fbHasNumbers) {
    md += `**营业日报兜底（daily_reports）** — pos_sales_detail 缺数时仍可对账\n\n`;
    md += `| 指标 | 本期 | 环比 |\n|:--|--:|--:|\n`;
    const asp = fb.current.orders > 0 ? fb.current.revenue / fb.current.orders : null;
    const aspPrev = fb.previous && toNum(fb.previous.orders) > 0 ? toNum(fb.previous.revenue) / toNum(fb.previous.orders) : null;
    const aspWow = Number.isFinite(asp) && Number.isFinite(aspPrev) && aspPrev !== 0 ? fmt.wow(asp, aspPrev) : null;
    md += `| 营业额(日报) | **${fmtMoney(fb.current.revenue)}**（${fb.current.days}天有日报） | ${fmtSignedPct(fb.revenueWowPct)} |\n`;
    md += `| 订单数 | **${toNum(fb.current.orders).toFixed(0)}** | ${fmtSignedPct(fb.ordersWowPct)} |\n`;
    md += `| 客单价(估) | **${asp != null ? fmtMoney(asp) : '—'}** | ${fmtSignedPct(aspWow)} |\n\n`;
  } else if (dataDays === 0) {
    if (fbDailyDays > 0) {
      md += `**【需确认】** **pos_sales_detail** 本周期无行；**daily_reports** 有 **${fbDailyDays}** 天记录但营业额/订单合计为 0，请核对日报是否未填报或字段映射（actual_revenue / dine_orders）。\n\n`;
    } else {
      md += `**【需确认】** 本周期在 **pos_sales_detail** 与 **daily_reports** 均未拉到有效数据，请检查店名是否与数据库一致、是否未上传销售/日报。\n\n`;
    }
  }

  const allRaw = r.sections.salesRawTotals || { gross: 0, net: 0 };
  const dnRaw = r.sections.dineinRawTotals || { gross: 0, net: 0 };
  const twRaw = r.sections.takeawayRawTotals || { gross: 0, net: 0 };
  const fbH = r.sections.fallbackDaily;
  const useDailyH = fbH?.current && Number(fbH.current.days) > 0;
  const netHeadline = useDailyH ? toNum(fbH.current.revenue) : toNum(allRaw.net);
  const grossHeadline = toNum(dnRaw.gross);
  const rawDiscExec = Math.max(0, grossHeadline - netHeadline);
  const wowSec = r.sections.wow || {};
  const m = r.sections.theoreticalMargins || {};
  const hasTakeaway = deps.reportMeta.hasTakeaway;

  md += `**经营主指标（与营业日报 / 堂食 POS 可对账）**\n\n`;
  md += `| 指标 | 本期 | 环比 |\n|:--|--:|--:|\n`;
  md += `| 折前营业额（堂食 pos_sales_detail） | **${fmtMoney(grossHeadline)}** | ${fmtSignedPct(wowSec.salesWowPct)} |\n`;
  md += `| 实收营业额${useDailyH ? '（营业日报）' : '（pos_sales_detail 全渠道）'} | **${fmtMoney(netHeadline)}** | ${fmtSignedPct(wowSec.revenueWowPct)} |\n`;
  md += `| 折扣(堂食折前−上列实收) | ${fmtMoney(rawDiscExec)} | ${fmtSignedPct(wowSec.discountWowPct)} |\n`;
  md += `| 实收毛利率（仅成本命中子集） | **${fmt.fmtPct(m.totalNetMarginPct)}** | ${fmtSignedPct(wowSec.netMarginWowPct)} |\n`;
  if (hasTakeaway && toNum(twRaw.gross) > 0) {
    md += `| 外卖（pos_sales_detail 另计） | 折前 **${fmtMoney(twRaw.gross)}** / 实收 **${fmtMoney(twRaw.net)}** | — |\n`;
  }
  md += `| 全渠道 pos_sales_detail 参考 | 折前 ${fmtMoney(allRaw.gross)} / 实收 ${fmtMoney(allRaw.net)} | — |\n`;
  md += `\n> 说明：此前误用「全渠道 pos_sales_detail」作主表，会与日报实收严重偏离（有外卖门店尤甚）。「实收毛利率」仍来自下方理论毛利表（**dish_library_costs** 命中子集）。\n\n`;
  return { md, grossHeadline };
}

export function formatReportMarginSection(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { fmtPct, fmtMoneyPlain, sep, coverageLabel } = fmt;
  const m = r.sections.theoreticalMargins || {};
  const totals = m.totals || {};
  const costCoverage = r.sections.costCoverage || {};

  let md = `\n${sep}\n`;
  md += `**二、理论毛利分析**（折前/实收双口径）\n\n`;
  md += `> 口径说明：以下毛利率按“已匹配到成本”的销售明细计算；未命中成本的记录不计入收入与成本。\n`;
  md += `> 基于菜品库成本计算\n\n`;

  const marginRows = [
    { label: '📊 总计', data: totals.total, pre: m.totalPreDiscountMarginPct, net: m.totalNetMarginPct },
    { label: '🍽 堂食', data: totals.dinein, pre: m.dineinPreDiscountMarginPct, net: m.dineinNetMarginPct },
  ];
  if (hasTakeaway) {
    marginRows.push({ label: '🛵 外卖', data: totals.takeaway, pre: m.takeawayPreDiscountMarginPct, net: m.takeawayNetMarginPct });
  }

  md += `| 类型 | 折前营收 | 实收营收 | 成本 | 折前毛利 | 实收毛利 |\n`;
  md += `|:--|--:|--:|--:|--:|--:|\n`;
  for (const row of marginRows) {
    md += `| ${row.label} | ${fmtMoneyPlain(row.data?.sales)} | ${fmtMoneyPlain(row.data?.revenue)} | ${fmtMoneyPlain(row.data?.cost)} | ${fmtPct(row.pre)} | **${fmtPct(row.net)}** |\n`;
  }

  md += `\n**成本覆盖率（覆盖率越高，毛利越可信）**\n`;
  md += `| 类型 | 销售额覆盖率 | 实收覆盖率 |\n`;
  md += `|:--|--:|--:|\n`;
  md += `| 📊 总计 | ${coverageLabel(costCoverage.total?.salesCoveragePct)} | ${coverageLabel(costCoverage.total?.revenueCoveragePct)} |\n`;
  md += `| 🍽 堂食 | ${coverageLabel(costCoverage.byBiz?.dinein?.salesCoveragePct)} | ${coverageLabel(costCoverage.byBiz?.dinein?.revenueCoveragePct)} |\n`;
  if (hasTakeaway) {
    md += `| 🛵 外卖 | ${coverageLabel(costCoverage.byBiz?.takeaway?.salesCoveragePct)} | ${coverageLabel(costCoverage.byBiz?.takeaway?.revenueCoveragePct)} |\n`;
  }
  return md;
}

export function formatReportSlotSection(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { BIZ_TYPES, BIZ_CN, SLOT_TYPES, SLOT_CN } = deps;
  const { fmtPct, fmtMoneyPlain, sep } = fmt;
  const grossHeadline = deps.grossHeadline || 0;

  let md = `\n${sep}\n`;
  md += `**三、时段经营**（午市/下午茶/晚市，**仅堂食**）\n\n`;
  md += `> 每时段 **折前/实收** 为 **堂食 pos_sales_detail** 按 slot/下单时刻分档，加总应与主表「折前（堂食）」一致；**成本与毛利率** 仍仅统计已匹配成本的明细。\n\n`;
  const slotMargins = r.sections.slotMargins || {};
  const slotRawTotals = r.sections.slotRawTotals || {};
  let slotAny = false;
  for (const slot of SLOT_TYPES) {
    const rawS = slotRawTotals[slot] || { gross: 0, net: 0 };
    const sec = slotMargins[slot];
    if (toNum(rawS.gross) === 0 && (!sec || toNum(sec.total?.sales) === 0)) continue;
    slotAny = true;
    md += `**${SLOT_CN[slot]}**\n`;
    md += `折前 ${fmtMoneyPlain(rawS.gross)} ｜ 实收 ${fmtMoneyPlain(rawS.net)}（全量）\n`;
    if (sec && (toNum(sec.total?.sales) > 0 || toNum(sec.total?.revenue) > 0 || toNum(sec.total?.cost) > 0)) {
      md += `已匹配成本子集：折前 ${fmtMoneyPlain(sec.total?.sales)} ｜ 实收 ${fmtMoneyPlain(sec.total?.revenue)} ｜ 成本 ${fmtMoneyPlain(sec.total?.cost)}\n`;
      md += `折前毛利 **${fmtPct(sec.margins?.preDiscountMarginPct)}** ｜ 实收毛利 **${fmtPct(sec.margins?.netMarginPct)}**\n`;
    }
    const bizList = hasTakeaway ? BIZ_TYPES : ['dinein'];
    for (const biz of bizList) {
      const b = sec?.byBiz?.[biz] || {};
      if (toNum(b.sales) === 0) continue;
      const net = deps.pct(toNum(b.revenue) - toNum(b.cost), toNum(b.revenue));
      md += `- ${BIZ_CN[biz]}（成本命中）: 折前${fmtMoneyPlain(b.sales)} / 实收${fmtMoneyPlain(b.revenue)} / 实收毛利${fmtPct(net)}\n`;
    }
    md += `\n`;
  }
  const rawOther = slotRawTotals.other;
  if (rawOther && toNum(rawOther.gross) > 0) {
    slotAny = true;
    md += `**${SLOT_CN.other}**\n`;
    md += `折前 ${fmtMoneyPlain(rawOther.gross)} ｜ 实收 ${fmtMoneyPlain(rawOther.net)}（全量，slot/下单时刻无法分档的明细）\n\n`;
  }
  const sumSlotGross =
    grossHeadline > 0
      ? SLOT_TYPES.reduce((a, s) => a + toNum(slotRawTotals[s]?.gross), 0) + toNum(slotRawTotals.other?.gross)
      : 0;
  if (grossHeadline > 0 && sumSlotGross > 0 && Math.abs(sumSlotGross - grossHeadline) > 0.02) {
    md += `> **校验提醒**：各时段折前合计 **¥${sumSlotGross.toFixed(2)}** 与主表堂食折前 **¥${grossHeadline.toFixed(2)}** 不一致，请排查时段字段或分档规则。\n\n`;
  }
  if (!slotAny) {
    md += `**【需说明】** 本周期无可用时段拆分销售（多为 pos_sales_detail 无行或各时段销售额为 0）。\n\n`;
  }
  return md;
}

export function formatReportDiningDuration(r, fmt, deps) {
  const { SLOT_CN } = deps;
  const { sep } = fmt;
  let md = `${sep}\n`;
  md += `**四、用餐时长**（堂食）\n\n`;
  const durationRows = r.sections.diningDuration || [];
  if (!durationRows.length) {
    md += `暂无可用堂食结账时长数据\n`;
  } else {
    for (const d of durationRows) {
      md += `- **${SLOT_CN[d.slot] || d.slot}** ${d.avg_min}分钟（${d.cnt}单）\n`;
    }
  }
  return md;
}

export function formatReportRankingSection(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { BIZ_TYPES, BIZ_CN } = deps;
  const { fmtMoneyPlain, sep } = fmt;
  let md = `\n${sep}\n`;
  md += `**五、菜品销售TOP/末位**\n`;
  md += `> 已剔除赠品/饮品/指定非排名菜品\n\n`;
  const bizForRanking = hasTakeaway ? BIZ_TYPES : ['dinein'];
  for (const biz of bizForRanking) {
    const bizCN = BIZ_CN[biz];
    const sec = r.sections[`ranking_${biz}`] || {};
    md += `**${bizCN}**\n`;
    if (!sec.top10?.length) {
      md += `暂无有效菜品数据\n\n`;
      continue;
    }
    md += `🔥 TOP10\n`;
    sec.top10.forEach((d, i) => {
      md += `${String(i + 1).padStart(2, ' ')}. ${d.dish_name}  ${fmtMoneyPlain(d.total_sales)}（${toNum(d.total_qty).toFixed(0)}份）\n`;
    });
    if (sec.bottom10?.length) {
      md += `📉 末位10\n`;
      sec.bottom10.forEach((d, i) => {
        md += `${String(i + 1).padStart(2, ' ')}. ${d.dish_name}  ${fmtMoneyPlain(d.total_sales)}（${toNum(d.total_qty).toFixed(0)}份）\n`;
      });
    }
    md += `\n`;
  }
  return md;
}

export function formatReportWeekdayRatios(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { WEEKDAY_CN } = deps;
  const { fmtMoneyPlain, sep } = fmt;
  if (!hasTakeaway) return '';
  let md = `${sep}\n`;
  md += `**六、每日营业占比**（堂食/外卖）\n\n`;
  const byDay = {};
  for (const w of (r.sections.weekdayRatios || [])) {
    if (!byDay[w.weekday]) byDay[w.weekday] = {};
    byDay[w.weekday][w.biz_type] = { orders: Number(w.order_cnt), sales: Number(w.total_sales) };
  }
  for (let d = 1; d <= 7; d++) {
    const day = byDay[d];
    if (!day) continue;
    const di = day.dinein || { orders: 0, sales: 0 };
    const tk = day.takeaway || { orders: 0, sales: 0 };
    const to = di.orders + tk.orders;
    if (!to) continue;
    md += `**${WEEKDAY_CN[d]}** 堂食${di.orders}单(${(di.orders / to * 100).toFixed(0)}%) ${fmtMoneyPlain(di.sales)}`;
    if (tk.orders) md += ` ｜ 外卖${tk.orders}单(${(tk.orders / to * 100).toFixed(0)}%) ${fmtMoneyPlain(tk.sales)}`;
    md += `\n`;
  }
  return md;
}

export function formatReportHourlyPeaks(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { WEEKDAY_CN } = deps;
  const { sep } = fmt;
  let md = `\n${sep}\n`;
  md += `**${hasTakeaway ? '七' : '六'}、高峰/低峰时段**\n\n`;
  const byDayHour = {};
  for (const h of (r.sections.hourlyOrders || [])) {
    const k = `${h.weekday}`;
    if (!byDayHour[k]) byDayHour[k] = {};
    const hh = h.hour;
    byDayHour[k][hh] = (byDayHour[k][hh] || 0) + Number(h.cnt);
  }
  for (let d = 1; d <= 7; d++) {
    const hrs = byDayHour[d];
    if (!hrs) continue;
    const sorted = Object.entries(hrs).sort((a, b) => b[1] - a[1]);
    const peak = sorted.slice(0, 3).map(([h, c]) => `${h}:00(${c})`).join(' ');
    const low = sorted.slice(-3).reverse().map(([h, c]) => `${h}:00(${c})`).join(' ');
    md += `**${WEEKDAY_CN[d]}** 高峰 ${peak} ｜ 低峰 ${low}\n`;
  }
  return md;
}

export function formatReportAnalysisSummary(r, fmt, deps) {
  const { hasTakeaway } = deps.reportMeta;
  const { sep } = fmt;
  const sectionNum = hasTakeaway ? '八' : '七';
  let md = `\n${sep}\n`;
  md += `**${sectionNum}、数据分析总结**\n\n`;
  const summary = Array.isArray(r.sections.analysisSummary) ? r.sections.analysisSummary : [];
  if (!summary.length) {
    md += `暂无足够数据生成自动总结\n`;
  } else {
    summary.forEach((line, idx) => {
      md += `${idx + 1}. ${line}\n`;
    });
  }
  return md;
}

export function formatReportUnmatchedAppendix(r, fmt, deps) {
  const { BIZ_CN } = deps;
  const { fmtMoneyPlain, sep } = fmt;
  const costCoverage = r.sections.costCoverage || {};
  const unmatchedTop = Array.isArray(costCoverage.unmatchedTop) ? costCoverage.unmatchedTop : [];
  if (!unmatchedTop.length) return '';
  let md = `\n${sep}\n`;
  md += `**附录：未匹配成本菜品TOP（按折前营收）**\n\n`;
  unmatchedTop.slice(0, 15).forEach((x, idx) => {
    const bizCn = BIZ_CN[String(x.bizType || '').trim()] || String(x.bizType || '-').trim() || '-';
    const resolvedHint = x.resolvedDishName && x.resolvedDishName !== x.dishName ? ` → 标准名:${x.resolvedDishName}` : '';
    md += `${String(idx + 1).padStart(2, ' ')}. [${bizCn}] ${x.dishName}${resolvedHint} ｜ 折前${fmtMoneyPlain(x.sales)} ｜ 实收${fmtMoneyPlain(x.revenue)} ｜ 数量${toNum(x.qty).toFixed(0)}\n`;
  });
  return md;
}

export function composeReportMarkdown(r, deps) {
  const isMonthly = r.reportType === 'monthly';
  const hasTakeaway = r.hasTakeaway !== false;
  const periodLabel = isMonthly ? '月度' : '周度';
  const adr = r.actualDateRange || {};
  const actualStart = adr.start || r.weekStart;
  const actualEnd = adr.end || r.weekEnd;
  const dataDays = adr.dataDays || 0;

  const fmt = createMarkdownFormatters(deps);
  const ctx = {
    ...deps,
    reportMeta: { isMonthly, hasTakeaway, periodLabel, actualStart, actualEnd, dataDays },
  };

  let md = formatReportHeader(r, fmt, ctx);
  const exec = formatReportExecutiveSummary(r, fmt, ctx);
  md += exec.md;
  ctx.grossHeadline = exec.grossHeadline;
  md += formatReportMarginSection(r, fmt, ctx);
  md += formatReportSlotSection(r, fmt, ctx);
  md += formatReportDiningDuration(r, fmt, ctx);
  md += formatReportRankingSection(r, fmt, ctx);
  md += formatReportWeekdayRatios(r, fmt, ctx);
  md += formatReportHourlyPeaks(r, fmt, ctx);
  md += formatReportAnalysisSummary(r, fmt, ctx);
  md += formatReportUnmatchedAppendix(r, fmt, ctx);
  md += `\n> 折扣 = 折前营收 - 实收营收（取推导值与源表较大者）\n`;
  return md;
}
