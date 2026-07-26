import { PROBLEMS } from './problems.js';

export function ymd(d) { return d.toISOString().slice(0, 10); }
export function daysAgo(n) { return ymd(new Date(Date.now() - n * 86400000)); }
export function brandKeyOf(store) {
  const s = String(store || '');
  if (s.includes('马己仙')) return '马己仙';
  if (s.includes('洪潮')) return '洪潮';
  return s;
}
export function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }

export function normalizeDishName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/【[^】]*】|（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, '');
  s = s.replace(/[\s_/+·,，。、!！?？:：;；'"~～()（）\[\]【】-]/g, '');
  return s.toLowerCase();
}
export function normalizeBiz(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/外卖|takeaway|delivery|外送/.test(s)) return 'takeaway';
  return 'dinein';
}

export function median(vals) {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function lookupCost(costMap, biz, key) {
  const m = biz === 'takeaway' ? costMap.takeaway : costMap.dinein;
  if (m.has(key)) return m.get(key);
  if (costMap.any.has(key)) return costMap.any.get(key);
  return null;
}

export function quadrantsForChannel(rows) {
  const matched = rows.filter((r) => r.profit != null);
  const byCategory = new Map();
  for (const r of matched) {
    const cat = r.category || '未分类';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(r);
  }
  const buckets = { star: [], traffic: [], potential: [], eliminate: [] };
  let qtyMedSum = 0, profitMedSum = 0, catCount = 0;
  for (const [, catRows] of byCategory) {
    const qtyMed = median(catRows.map((r) => r.qty));
    const profitMed = median(catRows.map((r) => r.profit));
    qtyMedSum += qtyMed; profitMedSum += profitMed; catCount += 1;
    for (const r of catRows) {
      const hiQty = r.qty >= qtyMed, hiProfit = r.profit >= profitMed;
      const item = { dish: r.dish, category: r.category, qty: r.qty, profit: r.profit, margin: r.margin };
      if (hiQty && hiProfit) buckets.star.push(item);
      else if (hiQty) buckets.traffic.push(item);
      else if (hiProfit) buckets.potential.push(item);
      else buckets.eliminate.push(item);
    }
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => b.qty - a.qty);
    buckets[k] = buckets[k].slice(0, 10);
  }
  return {
    qty_median: catCount ? round2(qtyMedSum / catCount) : 0,
    profit_median: catCount ? round2(profitMedSum / catCount) : 0,
    matched: matched.length, ...buckets,
  };
}

// 把computeMetric()算出来的真实数据摊平成给LLM读的文字摘要，用于existing模式的
// 二次分析调用——不同problem_key的detail结构不一样，这里按各自最有信息量的字段挑着写。
export function summarizeMetricForAnalysis(problemKey, current) {
  const p = PROBLEMS[problemKey];
  const base = `近30天${p.metric}：${current.value}${p.unit}`;
  const d = current.detail || {};
  if (problemKey === 'menu_optimization') {
    const dinein = d.quadrants?.dinein || {};
    const takeaway = d.quadrants?.takeaway || {};
    return `${base}（本轮处理问题菜品数）。
堂食：明星${(dinein.star || []).length}道、引流${(dinein.traffic || []).length}道、潜力${(dinein.potential || []).length}道、淘汰${(dinein.eliminate || []).length}道。
外卖：明星${(takeaway.star || []).length}道、引流${(takeaway.traffic || []).length}道、潜力${(takeaway.potential || []).length}道、淘汰${(takeaway.eliminate || []).length}道。
高投诉菜品(近30天桌访反馈)：${(d.complaint_dishes || []).slice(0, 5).map(c => c.dish).join('、') || '无'}。`;
  }
  if (problemKey === 'revenue') {
    return `${base}。统计天数${d.days || 0}天。高流失风险沉睡客户${d.sleeping_customers || 0}人(其中高风险${d.sleeping_high || 0}人)。`;
  }
  if (problemKey === 'staff_efficiency') {
    return `${base}。统计期折前营业额${d.pre_discount_revenue || 0}元，总人天${d.person_days || 0}天，统计天数${d.days || 0}天。`;
  }
  if (problemKey === 'training_replication') {
    return `${base}。应完成认证${d.required || 0}项，已覆盖${d.covered || 0}项，缺口${d.gap_count || 0}项。`;
  }
  return `${base}。`;
}

// 依据已关闭轮次推算下一轮目标;返回 null 表示已封顶
export function nextTarget(problemKey, baseline, originBaseline, _closedRounds) {
  const ladder = PROBLEMS[problemKey]?.ladder;
  if (!ladder) return null;
  const origin = Number(originBaseline ?? baseline) || 0;
  const base = Number(baseline) || 0;
  if (ladder.type === 'pct') {
    const capValue = origin * (1 + ladder.cap);
    if (base >= capValue) return null;
    return round2(Math.min(base * (1 + ladder.step), capValue));
  }
  if (ladder.type === 'pp') {
    const capValue = origin + ladder.cap;
    if (base >= capValue) return null;
    return round2(Math.min(base + ladder.step, capValue));
  }
  if (ladder.type === 'ladder') {
    const next = ladder.steps.find((s) => s > base + 0.01);
    return next != null ? next : null;
  }
  if (ladder.type === 'count') {
    if (base <= 0) return null;
    return Math.min(ladder.perRound, Math.round(base));
  }
  return null;
}

export function summarizeCard(key, current) {
  if (!current) return '';
  const d = current.detail || {};
  switch (key) {
    case 'staff_efficiency': return `折前营收 ¥${d.pre_discount_revenue ?? 0} / ${d.person_days ?? 0} 人天`;
    case 'revenue': return `可召回沉睡池 ${d.sleeping_customers ?? 0} 位(高 ${d.sleeping_high ?? 0}/中 ${d.sleeping_medium ?? 0})`;
    case 'kitchen_standard': return `应打点 ${d.expected ?? 0} 次,实际 ${d.confirmed ?? 0} 次`;
    case 'menu_optimization': return `高投诉 ${Array.isArray(d.complaint_dishes) ? d.complaint_dishes.length : 0} 道,淘汰象限见详情`;
    case 'gross_margin': return `已匹配成本 ${d.matched_dishes ?? 0} 道,缺成本 ${d.unmatched_dishes ?? 0} 道`;
    case 'training_replication': return `必修 ${d.required ?? 0} 项,缺口 ${d.gap_count ?? 0} 项`;
    default: return '';
  }
}
