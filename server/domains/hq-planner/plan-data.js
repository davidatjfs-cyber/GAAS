/**
 * HQ Planner — 行动计划数据规整 (纯函数, 无外部依赖)
 * 从 hq-planner-agent.js 拆出。
 */

export function extractFirstJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) { /* ignore */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function normalizeTextArray(input, maxCount = 6) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const item of arr) {
    const v = String(item || '').replace(/\s+/g, ' ').trim();
    if (!v) continue;
    if (out.includes(v)) continue;
    out.push(v.slice(0, 120));
    if (out.length >= maxCount) break;
  }
  return out;
}

export function buildRuleBasedActions(storeHealth = {}) {
  const bd = storeHealth.scoreBreakdown || {};
  const scored = [
    { key: 'anomalyDeduct', label: '异常任务闭环', role: 'store_manager', deadline: '3天', kpi: '近7天异常任务响应时效<2小时，逾期任务清零', verify: '复核master_tasks响应时长与状态流转' },
    { key: 'materialDeduct', label: '原料异常处置', role: 'store_production_manager', deadline: '7天', kpi: '原料异常重复发生率下降30%', verify: '复核原料日报异常字段与整改记录' },
    { key: 'closingDeduct', label: '收档标准执行', role: 'store_production_manager', deadline: '7天', kpi: '收档合格率≥95%，平均分提升至90+', verify: '复核收档表通过率与均分' },
    { key: 'complaintDeduct', label: '桌访投诉治理', role: 'store_manager', deadline: '7天', kpi: '投诉率较近30天下降20%', verify: '复核桌访投诉率趋势' }
  ].sort((a, b) => Number(bd[b.key] || 0) - Number(bd[a.key] || 0));
  const actions = [];
  for (const item of scored) {
    if (Number(bd[item.key] || 0) <= 0) continue;
    actions.push({
      priority: actions.length + 1,
      action: `针对${item.label}制定周执行清单并每日复盘，明确责任人与完成时限。`,
      responsibleRole: item.role,
      deadline: item.deadline,
      kpiTarget: item.kpi,
      verificationMethod: item.verify
    });
    if (actions.length >= 4) break;
  }
  if (!actions.length) {
    actions.push({
      priority: 1,
      action: '建立门店周度经营复盘机制，固定追踪异常、投诉与巡检通过率。',
      responsibleRole: 'store_manager',
      deadline: '7天',
      kpiTarget: '健康分较当前提升5分以上',
      verificationMethod: '复核下周期健康分与扣分结构'
    });
  }
  return actions;
}

export function normalizePlanData(planData, { store, goal, storeHealth, rawContent }) {
  const src = planData && typeof planData === 'object' ? planData : {};
  const title = String(src.title || `${store} 改善行动计划`).trim() || `${store} 改善行动计划`;
  const summaryBase = String(src.summary || '').replace(/\s+/g, ' ').trim();
  const summary = (summaryBase || `围绕“${goal || '综合提升门店运营表现'}”聚焦主要扣分项进行分阶段改善。`).slice(0, 120);

  const rootCauses = normalizeTextArray(src.rootCauses, 5);
  const rawActions = Array.isArray(src.actions) ? src.actions : [];
  const actions = rawActions
    .map((a, idx) => ({
      priority: Math.max(1, Math.min(10, Number(a?.priority) || idx + 1)),
      action: String(a?.action || '').replace(/\s+/g, ' ').trim(),
      responsibleRole: /store_production_manager|出品/.test(String(a?.responsibleRole || '')) ? 'store_production_manager' : 'store_manager',
      deadline: String(a?.deadline || '').replace(/\s+/g, ' ').trim() || '7天',
      kpiTarget: String(a?.kpiTarget || '').replace(/\s+/g, ' ').trim() || '关键指标连续7天改善',
      verificationMethod: String(a?.verificationMethod || '').replace(/\s+/g, ' ').trim() || '由总部按周复核关键数据'
    }))
    .filter((a) => !!a.action)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6);

  const safeActions = actions.length ? actions : buildRuleBasedActions(storeHealth);
  const expectedOutcome = String(src.expectedOutcome || '').replace(/\s+/g, ' ').trim() || '预计2-4周内健康分回升，异常闭环与投诉率明显改善。';
  const dataGaps = normalizeTextArray(src.dataGaps, 4);

  const normalized = {
    title,
    summary,
    rootCauses,
    actions: safeActions,
    expectedOutcome,
    dataGaps
  };
  if (rawContent && !src.actions?.length) normalized.rawContent = String(rawContent || '').slice(0, 800);
  return normalized;
}

export function inferBrand(storeName) {
  const s = String(storeName || '').trim();
  if (s.includes('洪潮')) return '洪潮传统潮汕菜';
  if (s.includes('马己仙')) return '马己仙广东小馆';
  return '';
}
