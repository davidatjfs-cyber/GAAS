/**
 * HQ Planner — HQ Brain 对话入口 (Feishu 消息路由)
 * 从 hq-planner-agent.js 拆出。ctx = { pool, callLLMTiered, log }（避免反向 import）。
 */
import { resolveTenantIdForStore } from '../../growth-api.js';
import { tenantContext } from '../../utils/database.js';
import {
  traceCausalChain,
  getStoreHealthOverview,
  crossStoreComparison,
  formatGraphContextForLLM
} from '../../knowledge-graph.js';
import { isHqRole } from '../../hq-brain-config.js';
import { generateActionPlan } from './generate-plan.js';
import { approvePlan } from './plan-lifecycle.js';
import { formatPlanReply } from './plan-reply-format.js';

// 门店名模糊匹配: 用户输入 "洪潮久光店" → 匹配 DB 中的 "洪潮大宁久光店"
export async function fuzzyMatchStoreName(ctx, input) {
  if (!input) return input;
  try {
    const r = await ctx.pool().query(`SELECT DISTINCT store FROM feishu_users WHERE store IS NOT NULL AND store != '' AND store != '总部'`);
    const stores = (r.rows || []).map(row => row.store);
    // 精确匹配
    const exact = stores.find(s => s === input);
    if (exact) return exact;
    // 包含匹配: DB中的店名包含用户输入 或 用户输入包含DB中的店名
    const contains = stores.find(s => s.includes(input) || input.includes(s));
    if (contains) return contains;
    // 关键字匹配: 去掉品牌前缀后的核心部分
    const core = input.replace(/^(洪潮|马己仙)/, '');
    if (core.length >= 2) {
      const fuzzy = stores.find(s => s.includes(core));
      if (fuzzy) return fuzzy;
    }
    return input; // 兜底返回原始输入
  } catch (e) {
    return input;
  }
}

// 从用户消息中提取门店名 (止于 "店" 字, 排除关键词干扰)
export function extractStoreName(text) {
  const m = text.match(/(洪潮[^\s,，。的生为请]+?店|马己仙[^\s,，。的生为请]+?店)/);
  return m ? m[1] : null;
}

async function handlePlanRequest(ctx, t, { role, username, store }) {
  let targetStore = store;
  const extracted = extractStoreName(t);
  if (extracted) targetStore = await fuzzyMatchStoreName(ctx, extracted);

  const goalMatch = t.match(/目标[：:]\s*(.+?)(?=[，。\n]|$)/);
  const goal = goalMatch ? goalMatch[1] : t;

  if (!targetStore) {
    return { handled: true, response: '请指定目标门店（如：为洪潮大宁久光店生成行动计划）' };
  }

  const daysBackMatch = t.match(/近\s*(\d{1,3})\s*天/);
  const requestedDays = daysBackMatch ? Number(daysBackMatch[1]) : 30;
  const result = await generateActionPlan(ctx, {
    store: targetStore,
    goal,
    role,
    createdBy: username,
    daysBack: Math.max(7, Math.min(90, requestedDays || 30))
  });
  if (!result.ok) {
    return { handled: true, response: `行动计划生成失败: ${result.message || result.error}` };
  }

  return { handled: true, response: formatPlanReply(result, targetStore) };
}

async function handleHealthQuery(ctx, t, { store }) {
  let targetStore = store;
  const extracted = extractStoreName(t);
  if (extracted) targetStore = await fuzzyMatchStoreName(ctx, extracted);

  if (!targetStore) {
    return { handled: true, response: '请指定门店名称（如：洪潮大宁久光店健康度）' };
  }

  const overview = await getStoreHealthOverview(targetStore, 30);
  const bd = overview.scoreBreakdown || {};
  let resp = `🏥 ${targetStore} 健康诊断\n`;
  resp += `综合健康分: ${overview.healthScore}/100 | ${overview.period}\n`;
  resp += `扣分: 异常${bd.anomalyDeduct || 0} 原料${bd.materialDeduct || 0} 收档${bd.closingDeduct || 0} 投诉${bd.complaintDeduct || 0}\n`;

  if (overview.anomalies?.length) {
    resp += `\n⚠️ 异常任务:\n${overview.anomalies.map(a => `  · ${a.category}(${a.severity}): ${a.count}次`).join('\n')}\n`;
  }
  if (overview.materialIssues?.length) {
    resp += `\n🥬 原料问题:\n${overview.materialIssues.map(m => `  · ${m.material}${m.severity ? '(' + m.severity + ')' : ''}: ${m.count}次`).join('\n')}\n`;
  }
  const insp = overview.inspections || {};
  if (insp.closingTotal > 0) {
    resp += `\n📋 收档检查: ${insp.closingTotal}次, 通过率${insp.closingPassRate}, 平均分${insp.closingAvgScore}\n`;
  }
  const tv = overview.complaints || {};
  if (tv.tableVisitTotal > 0) {
    resp += `\n📢 桌访: ${tv.tableVisitTotal}次, 投诉${tv.withComplaints}次(${tv.complaintRate})\n`;
  }
  const sales = overview.sales || {};
  if (sales.daysWithData > 0) {
    resp += `\n💰 销售: ${sales.daysWithData}天数据, 日均￥${sales.avgDailyRevenue}\n`;
  }

  return { handled: true, response: resp };
}

async function handleCausalQuery(ctx, t, { store }) {
  let targetStore = store;
  const extracted = extractStoreName(t);
  if (extracted) targetStore = await fuzzyMatchStoreName(ctx, extracted);

  if (!targetStore) return null;

  const chain = await traceCausalChain('store', targetStore, 3, 30);
  if (!chain.length) {
    return { handled: true, response: `${targetStore} 的因果关系图谱中暂无关联数据。数据将随着日常运营自动积累。` };
  }
  const formatted = formatGraphContextForLLM(chain, 20);
  return { handled: true, response: `🔗 ${targetStore} 因果关系链 (近30天):\n\n${formatted}` };
}

async function handleApproveCommand(ctx, approveMatch, { username }) {
  const result = await approvePlan(ctx, approveMatch[1], username);
  if (result.ok) {
    return { handled: true, response: `✅ 计划 ${approveMatch[1]} 已审批通过，已拆解为 ${result.createdTasks} 个执行任务并进入派发流程。` };
  }
  return { handled: true, response: `审批失败: ${result.error}` };
}

async function handleCompareQuery(ctx, t) {
  const rawMatches = t.match(/(洪潮[^\s,，。的生为请]+?店|马己仙[^\s,，。的生为请]+?店)/g);
  const storeMatches = rawMatches ? await Promise.all(rawMatches.map(s => fuzzyMatchStoreName(ctx, s))) : null;
  if (!(storeMatches?.length >= 2)) return null;

  const comparison = await crossStoreComparison(storeMatches, 30);
  let resp = `📊 门店对比分析:\n\n`;
  for (const [s, data] of Object.entries(comparison)) {
    const anomalyCnt = Array.isArray(data?.anomalies) ? data.anomalies.length : 0;
    const complaintCnt = Number(data?.complaints?.withComplaints || 0);
    resp += `【${s}】健康分: ${data.healthScore}/100 | 异常${anomalyCnt}类 | 投诉${complaintCnt}次\n`;
  }
  return { handled: true, response: resp };
}

async function routeHqBrainIntent(ctx, t, params) {
  if (t.includes('行动计划') || t.includes('改善方案') || t.includes('策略') || t.includes('整改方案')) {
    return handlePlanRequest(ctx, t, params);
  }

  if (t.includes('健康度') || t.includes('健康分') || t.includes('门店诊断')) {
    return handleHealthQuery(ctx, t, params);
  }

  if (t.includes('因果') || t.includes('原因') || t.includes('为什么') || t.includes('根因')) {
    const result = await handleCausalQuery(ctx, t, params);
    if (result) return result;
  }

  const approveMatch = t.match(/审批通过\s*(AP-[a-z0-9-]+)/i);
  if (approveMatch) {
    return handleApproveCommand(ctx, approveMatch, params);
  }

  if (t.includes('对比') || t.includes('比较')) {
    const result = await handleCompareQuery(ctx, t);
    if (result) return result;
  }

  return null;
}

export async function handleHqBrainMessage(ctx, { text, role, username, store }) {
  if (!isHqRole(role)) {
    return null; // 非 HQ 角色不处理
  }

  // 飞书机器人消息没有JWT/ALS上下文，按门店反查真实租户，整段包裹，
  // 避免fuzzyMatchStoreName/listPlans等内部查询在FORCE RLS下读不到数据。
  const hqTenantId = await resolveTenantIdForStore(ctx.pool(), store);
  return await tenantContext.run(hqTenantId, async () => {
    const t = String(text || '').trim();
    return routeHqBrainIntent(ctx, t, { role, username, store });
  });
}
