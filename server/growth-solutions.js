// 经营诊断·六大增长方案模块
// 问题 → 现状(真实数据) → 阶梯目标 → 任务方案(责任人必填) → 轮次闭环(观察期→复盘→进阶/重跑)
// 规则:达成率 = 实际/目标,≥90% 算达成;同一(门店,问题)同时只允许一个未关闭轮次

import { pool as getPool } from './utils/database.js';

function pool() { return getPool(); }

const OBSERVATION_DAYS = 30;   // 任务全部完成后的观察期
const METRIC_WINDOW_DAYS = 30; // 指标统计窗口
const SUCCESS_RATE = 0.9;      // 达成率≥90%算成功

// ─── 六大问题定义:指标口径 + 阶梯规则 ─────────────────────
export const PROBLEMS = {
  staff_efficiency: {
    title: '提升员工效率',
    metric: '人效(折前营业额/人天)',
    unit: '元/人天',
    ladder: { type: 'pct', step: 0.10, cap: 0.30 },
  },
  revenue: {
    title: '提升营业额',
    metric: '近30天营业额',
    unit: '元',
    ladder: { type: 'pct', step: 0.05, cap: 0.20 },
  },
  kitchen_standard: {
    title: '提升出品标准',
    metric: 'SOP打点完成率',
    unit: '%',
    ladder: { type: 'ladder', steps: [80, 90, 95] },
  },
  menu_optimization: {
    title: '提升菜单质量',
    metric: '本轮处理问题菜品数',
    unit: '道',
    ladder: { type: 'count', perRound: 5 },
  },
  gross_margin: {
    title: '提升菜品毛利率',
    metric: '综合毛利率(已匹配成本菜品)',
    unit: '%',
    ladder: { type: 'pp', step: 1, cap: 3 },
  },
  training_replication: {
    title: '复制培养人才',
    metric: '关键岗位必修认证覆盖率',
    unit: '%',
    ladder: { type: 'ladder', steps: [50, 80, 100] },
  },
};

// 责任角色 → 岗位关键词(用于预填候选人)
const ROLE_POSITIONS = {
  store_manager: ['店长', '主管', '前厅经理'],
  production_manager: ['出品经理', '厨师长'],
  kitchen_staff: ['炒锅', '砧板', '烧味', '刺身', '汤档', '打荷', '蒸笼'],
  front_staff: ['服务员', '传菜', '水吧', '迎宾'],
  hr: ['人事'],
};

// ─── 任务模板库(种子数据) ────────────────────────────────
const TASK_TEMPLATE_SEED = [
  // 员工效率
  { problem_key: 'staff_efficiency', code: 'enable_daily_rating', title: '开启每日执行力AI评分', description: '全员纳入每日执行力评分,评分结果次日推送店长', assignee_role: 'store_manager', phase: '第1周', sort: 1 },
  { problem_key: 'staff_efficiency', code: 'launch_points_incentive', title: '上线积分现金激励规则', description: '配置标准动作→当日积分规则,积分可兑现金券,排行榜公示', assignee_role: 'store_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'staff_efficiency', code: 'assign_cert_training', title: '为缺认证员工指派必修培训', description: '按岗位晋升要求,为缺认证员工批量指派培训任务', assignee_role: 'production_manager', phase: '第2-4周', sort: 3 },
  { problem_key: 'staff_efficiency', code: 'weekly_efficiency_review', title: '每周对比人效曲线与目标线', description: '每周复盘人效走势,识别排班与客流错配', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 营业额
  { problem_key: 'revenue', code: 'review_churn_list', title: '审核高流失风险客户名单', description: 'AI已按流失风险排好优先级,确认本批召回名单', assignee_role: 'store_manager', phase: '第1周', sort: 1 },
  { problem_key: 'revenue', code: 'launch_recall_campaign', title: '分批发起沉睡客户召回', description: '按名单发起企微召回活动(AI生成文案+匹配优惠券)', assignee_role: 'store_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'revenue', code: 'track_redemption', title: '跟踪核销与到店回访', description: '记录召回客户到店与核销情况,桌访收集反馈', assignee_role: 'front_staff', phase: '第2-4周', sort: 3 },
  { problem_key: 'revenue', code: 'weekly_revenue_review', title: '每周复盘营收与召回效果', description: '对比营收曲线与召回批次,沉淀有效方案', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 出品标准化
  { problem_key: 'kitchen_standard', code: 'config_station_mapping', title: '配置岗位×菜品打点计划', description: '在厨房执行模块配置岗位菜品映射与每日打点时间', assignee_role: 'production_manager', phase: '第1周', sort: 1 },
  { problem_key: 'kitchen_standard', code: 'enable_punch_card', title: 'SOP打点卡上线并培训', description: '关键岗位学会使用打点卡,明确漏打点提醒规则', assignee_role: 'production_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'kitchen_standard', code: 'daily_punch', title: '每日按计划完成SOP打点', description: '各岗位按时完成打点,漏打点当日整改', assignee_role: 'kitchen_staff', phase: '持续', sort: 3 },
  { problem_key: 'kitchen_standard', code: 'review_timeout', title: '每周复盘出餐超时与漏打点', description: '结合出餐超时报告与打点看板,定位问题岗位', assignee_role: 'production_manager', phase: '每周', sort: 4 },
  // 菜单优化
  { problem_key: 'menu_optimization', code: 'review_complaint_dishes', title: '审核高投诉菜品清单', description: '核对桌访不满意菜品与差评,确认问题菜品名单', assignee_role: 'production_manager', phase: '第1周', sort: 1 },
  { problem_key: 'menu_optimization', code: 'decide_elimination', title: '确认淘汰/重做/优化名单', description: '按四象限与淘汰建议,拍板每道问题菜的处理方式', assignee_role: 'store_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'menu_optimization', code: 'rework_recipes', title: '重做菜品更新配方与SOP', description: '对重做菜品更新配方、SOP与打点步骤', assignee_role: 'production_manager', phase: '第2-4周', sort: 3 },
  { problem_key: 'menu_optimization', code: 'next_cycle_review', title: '下周期复盘四象限变化', description: '对比处理前后的四象限与投诉变化', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 门店毛利
  { problem_key: 'gross_margin', code: 'complete_cost_library', title: '补全菜品成本库', description: '为缺失成本的在售菜品补录单位成本', assignee_role: 'production_manager', phase: '第1-2周', sort: 1 },
  { problem_key: 'gross_margin', code: 'handle_low_margin', title: '处理低毛利TOP菜品', description: '对低毛利菜逐道决策:提价/换料/缩份/下架', assignee_role: 'store_manager', phase: '第2-3周', sort: 2 },
  { problem_key: 'gross_margin', code: 'procurement_review', title: '按采购建议核对进货', description: '对高消耗原料核对进货价格与用量', assignee_role: 'production_manager', phase: '持续', sort: 3 },
  { problem_key: 'gross_margin', code: 'monthly_margin_review', title: '每月复盘综合毛利率', description: '对比毛利率曲线与目标,复盘措施有效性', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 培训复制
  { problem_key: 'training_replication', code: 'mount_materials', title: '为知识点挂载教材', description: '为必修知识点补齐视频/文档教材', assignee_role: 'production_manager', phase: '第1-2周', sort: 1 },
  { problem_key: 'training_replication', code: 'batch_assign', title: '批量指派岗位必修培训', description: '按岗位晋升要求为在职员工批量指派培训', assignee_role: 'store_manager', phase: '第1周', sort: 2 },
  { problem_key: 'training_replication', code: 'ai_exam', title: '员工完成AI陪练与考试', description: '员工在移动端完成AI陪练对话与随堂考试', assignee_role: 'kitchen_staff', phase: '第2-4周', sort: 3 },
  { problem_key: 'training_replication', code: 'cert_review', title: '认证审核与到期复审', description: '管理端审核实操认证,到期自动复审', assignee_role: 'production_manager', phase: '持续', sort: 4 },
];

// ─── 建表 ───────────────────────────────────────────────
export async function ensureGrowthSolutionsSchema() {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS growth_task_templates (
      id BIGSERIAL PRIMARY KEY,
      problem_key VARCHAR(60) NOT NULL,
      code VARCHAR(80) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      assignee_role VARCHAR(40) NOT NULL DEFAULT 'store_manager',
      phase VARCHAR(40),
      sort INT NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (problem_key, code)
    )
  `);
  await pool().query(`
    CREATE TABLE IF NOT EXISTS growth_solution_rounds (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      store VARCHAR(200) NOT NULL,
      problem_key VARCHAR(120) NOT NULL,
      problem_title VARCHAR(255),
      round_no INT NOT NULL DEFAULT 1,
      metric_label VARCHAR(120),
      metric_key VARCHAR(60),
      unit VARCHAR(20),
      baseline_value NUMERIC(14,2),
      origin_baseline NUMERIC(14,2),
      target_value NUMERIC(14,2),
      actual_value NUMERIC(14,2),
      achievement_rate NUMERIC(6,4),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tasks_done_at TIMESTAMPTZ,
      measure_end_date DATE,
      review_report JSONB,
      decision VARCHAR(20),
      closed_at TIMESTAMPTZ,
      created_by VARCHAR(120)
    )
  `);
  await pool().query(`ALTER TABLE growth_solution_rounds ADD COLUMN IF NOT EXISTS metric_key VARCHAR(60)`);
  await pool().query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_solution_round_open
      ON growth_solution_rounds (store, problem_key)
      WHERE status <> 'closed'
  `);
  await pool().query(`
    CREATE TABLE IF NOT EXISTS growth_solution_tasks (
      id BIGSERIAL PRIMARY KEY,
      round_id BIGINT NOT NULL REFERENCES growth_solution_rounds(id) ON DELETE CASCADE,
      template_code VARCHAR(80),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      assignee_username VARCHAR(120) NOT NULL,
      assignee_name VARCHAR(120),
      due_date DATE,
      phase VARCHAR(40),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      done_at TIMESTAMPTZ,
      done_note TEXT,
      reminder_count INT NOT NULL DEFAULT 0,
      last_reminded_at TIMESTAMPTZ,
      sort INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool().query(`ALTER TABLE growth_solution_tasks ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0`);
  await pool().query(`ALTER TABLE growth_solution_tasks ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ`);
  // 种子模板:存在则跳过
  for (const t of TASK_TEMPLATE_SEED) {
    await pool().query(
      `INSERT INTO growth_task_templates (problem_key, code, title, description, assignee_role, phase, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (problem_key, code) DO NOTHING`,
      [t.problem_key, t.code, t.title, t.description, t.assignee_role, t.phase, t.sort]
    );
  }
}

// ─── 工具 ───────────────────────────────────────────────
function ymd(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { return ymd(new Date(Date.now() - n * 86400000)); }
function brandKeyOf(store) {
  const s = String(store || '');
  if (s.includes('马己仙')) return '马己仙';
  if (s.includes('洪潮')) return '洪潮';
  return s;
}
function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }

function normalizeDishName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/【[^】]*】|（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, '');
  s = s.replace(/[\s_/+·,，。、!！?？:：;；'"~～()（）\[\]【】-]/g, '');
  return s.toLowerCase();
}
function normalizeBiz(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/外卖|takeaway|delivery|外送/.test(s)) return 'takeaway';
  return 'dinein';
}

// ─── 现状指标计算(六个问题) ──────────────────────────────
async function metricStaffEfficiency(store, startDate, endDate) {
  const r = await pool().query(
    `SELECT pre_discount_revenue, staff FROM daily_reports
     WHERE store = $1 AND date >= $2 AND date <= $3`,
    [store, startDate, endDate]
  );
  let revenue = 0, personDays = 0;
  for (const row of r.rows) {
    revenue += Number(row.pre_discount_revenue || 0);
    const staff = row.staff || {};
    for (const arr of Object.values(staff)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) personDays += Number(p?.days || 0);
    }
  }
  const value = personDays > 0 ? revenue / personDays : 0;
  return { value: round2(value), detail: { pre_discount_revenue: round2(revenue), person_days: round2(personDays), days: r.rows.length } };
}

async function metricRevenue(store, startDate, endDate) {
  const r = await pool().query(
    `SELECT COALESCE(SUM(actual_revenue),0) AS rev, COUNT(*) AS days
     FROM daily_reports WHERE store = $1 AND date >= $2 AND date <= $3`,
    [store, startDate, endDate]
  );
  const storeCode = store.includes('马己仙') ? '51866138' : (store.includes('洪潮') ? '64822111' : '');
  let sleeping = 0;
  if (storeCode) {
    const c = await pool().query(
      `SELECT COUNT(*) AS n FROM growth_churn_predictions
       WHERE store_code = $1 AND risk_level IN ('high','critical','高','极高')
         AND prediction_date = (SELECT MAX(prediction_date) FROM growth_churn_predictions WHERE store_code = $1)`,
      [storeCode]
    );
    sleeping = Number(c.rows[0]?.n || 0);
  }
  return { value: round2(r.rows[0]?.rev), detail: { days: Number(r.rows[0]?.days || 0), sleeping_customers: sleeping } };
}

async function metricKitchenStandard(store, startDate, endDate) {
  // 期望打点数:启用的岗位×菜品映射 × 每日计划时段 × 天数;实际 = kitchen_exec_logs 确认数
  const maps = await pool().query(
    `SELECT scheduled_times FROM dish_station_mapping WHERE store = $1 AND enabled = TRUE`,
    [store]
  );
  let slotsPerDay = 0;
  for (const row of maps.rows) {
    const raw = Array.isArray(row.scheduled_times) ? row.scheduled_times : String(row.scheduled_times || '').split(/[，,\s]+/);
    const n = raw.map((x) => String(x || '').trim()).filter((x) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(x)).length;
    slotsPerDay += n || 1;
  }
  const dayCount = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
  const expected = slotsPerDay * dayCount;
  const logs = await pool().query(
    `SELECT COUNT(*) AS n FROM kitchen_exec_logs WHERE store = $1 AND task_date >= $2 AND task_date <= $3`,
    [store, startDate, endDate]
  );
  const confirmed = Number(logs.rows[0]?.n || 0);
  const rate = expected > 0 ? Math.min(100, (confirmed / expected) * 100) : 0;
  return { value: round2(rate), detail: { expected, confirmed, mappings: maps.rows.length } };
}

async function complaintDishes(store, startDate, endDate) {
  const brand = brandKeyOf(store);
  const r = await pool().query(
    `SELECT trim(dissatisfaction_dish) AS dish, COUNT(*) AS n
     FROM table_visit_records
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
       AND coalesce(trim(dissatisfaction_dish), '') <> ''
     GROUP BY trim(dissatisfaction_dish) ORDER BY n DESC LIMIT 20`,
    [brand, startDate, endDate]
  );
  return r.rows.map((x) => ({ dish: x.dish, count: Number(x.n) }));
}

async function loadCostMap(store) {
  const brand = brandKeyOf(store);
  const r = await pool().query(
    `SELECT dish_name, unit_cost, biz_type FROM dish_library_costs
     WHERE enabled = TRUE AND (brand = $1 OR brand = '*')`,
    [brand]
  );
  const map = { takeaway: new Map(), dinein: new Map(), any: new Map() };
  for (const row of r.rows) {
    const key = normalizeDishName(row.dish_name);
    if (!key) continue;
    const cost = Number(row.unit_cost || 0);
    const biz = String(row.biz_type || '').trim();
    if (/外卖|takeaway|delivery/i.test(biz)) { if (!map.takeaway.has(key)) map.takeaway.set(key, cost); }
    else if (/堂食|dinein|店内/i.test(biz)) { if (!map.dinein.has(key)) map.dinein.set(key, cost); }
    else { if (!map.any.has(key)) map.any.set(key, cost); }
  }
  return map;
}
function lookupCost(costMap, biz, key) {
  const m = biz === 'takeaway' ? costMap.takeaway : costMap.dinein;
  if (m.has(key)) return m.get(key);
  if (costMap.any.has(key)) return costMap.any.get(key);
  return null;
}

async function dishAggregates(store, startDate, endDate) {
  const brand = brandKeyOf(store);
  const r = await pool().query(
    `SELECT dish_name, category, biz_type,
            SUM(qty) AS qty, SUM(revenue) AS revenue
     FROM sales_raw
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
       AND coalesce(trim(dish_name), '') <> ''
     GROUP BY dish_name, category, biz_type`,
    [brand, startDate, endDate]
  );
  const costMap = await loadCostMap(store);
  return r.rows.map((row) => {
    const biz = normalizeBiz(row.biz_type);
    const key = normalizeDishName(row.dish_name);
    const qty = Number(row.qty || 0);
    const revenue = Number(row.revenue || 0);
    const unitCost = lookupCost(costMap, biz, key);
    const cost = unitCost != null ? unitCost * qty : null;
    return {
      dish: row.dish_name, category: row.category || '未分类', biz,
      qty, revenue: round2(revenue),
      cost: cost != null ? round2(cost) : null,
      profit: cost != null ? round2(revenue - cost) : null,
      margin: cost != null && revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : null,
    };
  });
}

function median(vals) {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function quadrantsForChannel(rows) {
  const matched = rows.filter((r) => r.profit != null);
  const qtyMed = median(matched.map((r) => r.qty));
  const profitMed = median(matched.map((r) => r.profit));
  const buckets = { star: [], traffic: [], potential: [], eliminate: [] };
  for (const r of matched) {
    const hiQty = r.qty >= qtyMed, hiProfit = r.profit >= profitMed;
    const item = { dish: r.dish, category: r.category, qty: r.qty, profit: r.profit, margin: r.margin };
    if (hiQty && hiProfit) buckets.star.push(item);
    else if (hiQty) buckets.traffic.push(item);
    else if (hiProfit) buckets.potential.push(item);
    else buckets.eliminate.push(item);
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => b.qty - a.qty);
    buckets[k] = buckets[k].slice(0, 10);
  }
  return { qty_median: round2(qtyMed), profit_median: round2(profitMed), matched: matched.length, ...buckets };
}

async function metricMenuOptimization(store, startDate, endDate) {
  const [complaints, dishes] = await Promise.all([
    complaintDishes(store, startDate, endDate),
    dishAggregates(store, startDate, endDate),
  ]);
  const dinein = quadrantsForChannel(dishes.filter((d) => d.biz === 'dinein'));
  const takeaway = quadrantsForChannel(dishes.filter((d) => d.biz === 'takeaway'));
  const issueCount = new Set([
    ...complaints.map((c) => normalizeDishName(c.dish)),
    ...dinein.eliminate.map((d) => normalizeDishName(d.dish)),
    ...takeaway.eliminate.map((d) => normalizeDishName(d.dish)),
  ]).size;
  return {
    value: issueCount,
    detail: { complaint_dishes: complaints, quadrants: { dinein, takeaway } },
  };
}

async function metricGrossMargin(store, startDate, endDate) {
  const dishes = await dishAggregates(store, startDate, endDate);
  const matched = dishes.filter((d) => d.cost != null);
  const rev = matched.reduce((s, d) => s + d.revenue, 0);
  const cost = matched.reduce((s, d) => s + d.cost, 0);
  const margin = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
  const lowMargin = matched
    .filter((d) => d.revenue > 0 && d.qty >= 5)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))
    .slice(0, 10)
    .map((d) => ({ dish: d.dish, category: d.category, biz: d.biz, qty: d.qty, revenue: d.revenue, margin: d.margin }));
  const unmatched = dishes.filter((d) => d.cost == null).length;
  return {
    value: round2(margin),
    detail: { matched_dishes: matched.length, unmatched_dishes: unmatched, matched_revenue: round2(rev), low_margin_top: lowMargin },
  };
}

async function metricTrainingReplication(store) {
  const brand = brandKeyOf(store);
  const emps = await pool().query(
    `SELECT username, name, position FROM employees
     WHERE store ILIKE '%' || $1 || '%'
       AND coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')
       AND coalesce(trim(position), '') <> ''`,
    [brand]
  );
  const topics = await pool().query(
    `SELECT id, title, position FROM training_topics WHERE is_active = TRUE AND promotion_required = TRUE`
  );
  const certs = await pool().query(
    `SELECT employee_username, topic_id FROM training_certifications
     WHERE coalesce(manager_verdict, ai_verdict, '') IN ('pass','approved','通过')`
  );
  const certSet = new Set(certs.rows.map((c) => `${c.employee_username}@@${c.topic_id}`));
  let required = 0, covered = 0;
  const gaps = [];
  for (const e of emps.rows) {
    const myTopics = topics.rows.filter((t) => {
      const positions = String(t.position || '').split(',').map((x) => x.trim());
      return positions.includes(String(e.position || '').trim());
    });
    for (const t of myTopics) {
      required += 1;
      if (certSet.has(`${e.username}@@${t.id}`)) covered += 1;
      else gaps.push({ username: e.username, name: e.name, position: e.position, topic_id: t.id, topic: t.title });
    }
  }
  const rate = required > 0 ? (covered / required) * 100 : 0;
  return { value: round2(rate), detail: { required, covered, gaps: gaps.slice(0, 50), gap_count: gaps.length } };
}

export async function computeMetric(problemKey, store, startDate, endDate) {
  switch (problemKey) {
    case 'staff_efficiency': return metricStaffEfficiency(store, startDate, endDate);
    case 'revenue': return metricRevenue(store, startDate, endDate);
    case 'kitchen_standard': return metricKitchenStandard(store, startDate, endDate);
    case 'menu_optimization': return metricMenuOptimization(store, startDate, endDate);
    case 'gross_margin': return metricGrossMargin(store, startDate, endDate);
    case 'training_replication': return metricTrainingReplication(store);
    default: throw new Error(`unknown problem_key: ${problemKey}`);
  }
}

// ─── 阶梯目标 ───────────────────────────────────────────
// 依据已关闭轮次推算下一轮目标;返回 null 表示已封顶
export function nextTarget(problemKey, baseline, originBaseline, closedRounds) {
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
    // 问题菜品数:目标 = 本轮处理 min(perRound, 当前问题数) 道
    if (base <= 0) return null;
    return Math.min(ladder.perRound, Math.round(base));
  }
  return null;
}

// ─── 责任人候选 ─────────────────────────────────────────
async function suggestAssignees(store, role) {
  const brand = brandKeyOf(store);
  const positions = ROLE_POSITIONS[role] || ROLE_POSITIONS.store_manager;
  const clauses = positions.map((_, i) => `position ILIKE '%' || $${i + 2} || '%'`).join(' OR ');
  const r = await pool().query(
    `SELECT username, name, position FROM employees
     WHERE store ILIKE '%' || $1 || '%'
       AND coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')
       AND (${clauses})
     ORDER BY position, name LIMIT 20`,
    [brand, ...positions]
  );
  return r.rows;
}

// ─── 方案生成(模板 + 真实数据缺口 → 任务清单) ─────────────
async function buildPlan(problemKey, store, currentDetail) {
  const templates = await pool().query(
    `SELECT code, title, description, assignee_role, phase, sort
     FROM growth_task_templates WHERE problem_key = $1 AND enabled = TRUE ORDER BY sort`,
    [problemKey]
  );
  const plan = [];
  for (const t of templates.rows) {
    let description = t.description || '';
    // 用真实数据充实任务描述
    if (t.code === 'assign_cert_training' || t.code === 'batch_assign') {
      const gapCount = currentDetail?.gap_count;
      if (gapCount > 0) description += `(当前共 ${gapCount} 项认证缺口)`;
    }
    if (t.code === 'review_churn_list' && currentDetail?.sleeping_customers > 0) {
      description += `(当前高风险流失客户 ${currentDetail.sleeping_customers} 位)`;
    }
    if (t.code === 'complete_cost_library' && currentDetail?.unmatched_dishes > 0) {
      description += `(当前 ${currentDetail.unmatched_dishes} 道在售菜品缺成本)`;
    }
    if (t.code === 'review_complaint_dishes' && Array.isArray(currentDetail?.complaint_dishes) && currentDetail.complaint_dishes.length) {
      const top = currentDetail.complaint_dishes.slice(0, 5).map((c) => `${c.dish}(${c.count}次)`).join('、');
      description += `(高投诉:${top})`;
    }
    const suggested = await suggestAssignees(store, t.assignee_role);
    plan.push({
      template_code: t.code,
      title: t.title,
      description,
      phase: t.phase,
      assignee_role: t.assignee_role,
      suggested_assignees: suggested,
      default_assignee: suggested[0] || null,
    });
  }
  return plan;
}

// ─── 轮次查询 ───────────────────────────────────────────
async function getOpenRound(store, problemKey) {
  const r = await pool().query(
    `SELECT * FROM growth_solution_rounds WHERE store = $1 AND problem_key = $2 AND status <> 'closed' LIMIT 1`,
    [store, problemKey]
  );
  if (!r.rows.length) return null;
  const round = r.rows[0];
  const tasks = await pool().query(
    `SELECT * FROM growth_solution_tasks WHERE round_id = $1 ORDER BY sort, id`,
    [round.id]
  );
  round.tasks = tasks.rows;
  return round;
}

async function getClosedRounds(store, problemKey) {
  const r = await pool().query(
    `SELECT * FROM growth_solution_rounds
     WHERE store = $1 AND problem_key = $2 AND status = 'closed'
     ORDER BY round_no`,
    [store, problemKey]
  );
  return r.rows;
}

// ─── 通知钩子(index.js 注入,复用 Lark 发送) ─────────────
let _notify = null;
export function setSolutionNotifier(fn) { _notify = fn; }
async function notify(msg) {
  if (_notify) { try { await _notify(msg); } catch { /* ignore */ } }
}

// LLM 归因钩子(可选注入;未注入时用确定性文本)
let _llm = null;
export function setSolutionLLM(fn) { _llm = fn; }

// ─── 培训任务下发钩子(index.js 注入 createTrainingAssignment) ──
let _createTrainingAssignment = null;
export function setTrainingAssigner(fn) { _createTrainingAssignment = fn; }

// ─── 复盘 ───────────────────────────────────────────────
async function generateReview(round) {
  const endDate = ymd(new Date());
  const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
  const metricKey = round.metric_key || round.problem_key;
  const metric = await computeMetric(metricKey, round.store, startDate, endDate);
  let actual = metric.value;
  // count 型(菜单优化):实际 = 问题菜品减少数(基线 - 当前),下限0
  if (PROBLEMS[metricKey]?.ladder?.type === 'count') {
    actual = Math.max(0, Number(round.baseline_value) - metric.value);
  }
  const target = Number(round.target_value) || 0;
  const rate = target > 0 ? actual / target : 0;
  const success = rate >= SUCCESS_RATE;

  const tasks = await pool().query(
    `SELECT title, assignee_name, assignee_username, status, done_at, due_date, reminder_count
     FROM growth_solution_tasks WHERE round_id = $1 ORDER BY sort`, [round.id]
  );
  const today = new Date();
  const taskRows = tasks.rows.map((t) => {
    const due = t.due_date ? new Date(String(t.due_date).slice(0, 10) + 'T23:59:59') : null;
    const doneAt = t.done_at ? new Date(t.done_at) : null;
    let daysLate = 0;
    if (due && doneAt && doneAt > due) daysLate = Math.ceil((doneAt - due) / 86400000);
    if (due && !doneAt && today > due) daysLate = Math.ceil((today - due) / 86400000);
    return {
      title: t.title, assignee: t.assignee_name || t.assignee_username,
      assignee_username: t.assignee_username,
      status: t.status, done_at: t.done_at, due_date: t.due_date,
      on_time: due && doneAt ? doneAt <= due : (doneAt ? true : null),
      days_late: daysLate,
      reminder_count: Number(t.reminder_count || 0),
    };
  });

  // ── 执行力问责:逐条点名,达成与否都必须客观直说 ──
  const execFindings = [];
  const perPerson = new Map();
  for (const t of taskRows) {
    if (!perPerson.has(t.assignee)) perPerson.set(t.assignee, { assignee: t.assignee, total: 0, done: 0, on_time: 0, late: 0, undone: 0, reminders: 0, max_days_late: 0 });
    const p = perPerson.get(t.assignee);
    p.total += 1;
    p.reminders += t.reminder_count;
    if (t.status === 'done') {
      p.done += 1;
      if (t.on_time === false) {
        p.late += 1;
        p.max_days_late = Math.max(p.max_days_late, t.days_late);
        if (t.reminder_count > 0) {
          execFindings.push(`任务「${t.title}」责任人 ${t.assignee}:逾期 ${t.days_late} 天,系统催促 ${t.reminder_count} 次后才完成`);
        } else {
          execFindings.push(`任务「${t.title}」责任人 ${t.assignee}:逾期 ${t.days_late} 天完成`);
        }
      } else {
        p.on_time += 1;
      }
    } else {
      p.undone += 1;
      execFindings.push(`任务「${t.title}」责任人 ${t.assignee}:至复盘时仍未完成${t.days_late > 0 ? `(已逾期 ${t.days_late} 天` : '('}${t.reminder_count > 0 ? `,催促 ${t.reminder_count} 次无果)` : ')'}`);
    }
  }
  const doneCount = taskRows.filter((t) => t.status === 'done').length;
  const onTimeCount = taskRows.filter((t) => t.status === 'done' && t.on_time !== false).length;
  const execution = {
    total: taskRows.length,
    done: doneCount,
    on_time: onTimeCount,
    on_time_rate: taskRows.length ? Math.round((onTimeCount / taskRows.length) * 1000) / 10 : 0,
    per_person: Array.from(perPerson.values()),
    findings: execFindings,
    verdict: execFindings.length === 0
      ? '全部任务按时完成,本轮结果差异与执行力无关,可直接归因于方案本身。'
      : `本轮存在 ${execFindings.length} 项执行问题(见上),方案与结果的差异需优先从执行力找原因。`,
  };

  let attribution = `本轮共 ${taskRows.length} 项任务,已完成 ${doneCount} 项,按时完成率 ${execution.on_time_rate}%。`
    + `基线 ${round.baseline_value}${round.unit},目标 ${round.target_value}${round.unit},观察期实际 ${actual}${round.unit},达成率 ${(rate * 100).toFixed(1)}%。`;
  if (_llm) {
    try {
      const prompt = `你是餐厅经营分析师。请基于以下事实,用中文写一段150字以内的归因分析,要求:客观、直截了当、不留情面也不夸大。`
        + `必须明确回答:结果与目标的差异,多大程度是执行力问题(逾期/催促无果/未完成),多大程度是方案本身问题。有执行问题就点名说清,没有就明说执行到位。\n`
        + `问题:${round.problem_title};指标:${round.metric_label};基线:${round.baseline_value}${round.unit};目标:${round.target_value}${round.unit};实际:${actual}${round.unit};达成率:${(rate * 100).toFixed(1)}%\n`
        + `任务执行明细:${JSON.stringify(taskRows)}\n执行问题清单:${JSON.stringify(execFindings)}`;
      const llmText = await _llm(prompt);
      if (llmText) attribution = String(llmText).trim();
    } catch { /* 用确定性文本兜底 */ }
  }

  return {
    actual_value: round2(actual),
    achievement_rate: Math.round(rate * 10000) / 10000,
    success,
    report: {
      baseline: Number(round.baseline_value),
      target: Number(round.target_value),
      actual: round2(actual),
      achievement_rate: Math.round(rate * 1000) / 10,
      success,
      unit: round.unit,
      tasks: taskRows,
      execution,
      attribution,
      suggestion: success
        ? '达成目标,建议确认进入下一轮(新基线=本轮实际值,目标上一档)'
        : '未达成目标,建议同目标重跑一轮,系统将重组任务方案(未起效动作将被替换)',
      metric_snapshot: metric.detail,
      generated_at: new Date().toISOString(),
    },
  };
}

// 观察期扫描:任务全部完成→observing;observing 到期→reviewing+生成报告
export async function runSolutionSweep() {
  const active = await pool().query(`SELECT * FROM growth_solution_rounds WHERE status = 'active'`);
  for (const round of active.rows) {
    // 逾期催促:每任务每天最多1次,记录催促次数(复盘时逐条点名)
    const overdue = await pool().query(
      `UPDATE growth_solution_tasks
       SET reminder_count = reminder_count + 1, last_reminded_at = NOW()
       WHERE round_id = $1 AND status <> 'done' AND due_date < CURRENT_DATE
         AND (last_reminded_at IS NULL OR last_reminded_at::date < CURRENT_DATE)
       RETURNING title, assignee_name, assignee_username, due_date, reminder_count`,
      [round.id]
    );
    if (overdue.rows.length) {
      const lines = overdue.rows.map((t) =>
        `· ${t.title} — ${t.assignee_name || t.assignee_username},截止 ${String(t.due_date).slice(0, 10)},第 ${t.reminder_count} 次催促`
      ).join('\n');
      await notify(`【增长方案·逾期催促】${round.store}「${round.problem_title}」第${round.round_no}轮有 ${overdue.rows.length} 项任务逾期未完成:\n${lines}\n催促次数将如实写入复盘报告。`);
    }
    const t = await pool().query(
      `SELECT COUNT(*) FILTER (WHERE status <> 'done') AS open, COUNT(*) AS total
       FROM growth_solution_tasks WHERE round_id = $1`, [round.id]
    );
    if (Number(t.rows[0].total) > 0 && Number(t.rows[0].open) === 0) {
      const measureEnd = ymd(new Date(Date.now() + OBSERVATION_DAYS * 86400000));
      await pool().query(
        `UPDATE growth_solution_rounds SET status='observing', tasks_done_at=NOW(), measure_end_date=$2 WHERE id=$1`,
        [round.id, measureEnd]
      );
      await notify(`【增长方案】${round.store}「${round.problem_title}」第${round.round_no}轮任务全部完成,进入${OBSERVATION_DAYS}天观察期,${measureEnd} 自动复盘。`);
    }
  }
  const observing = await pool().query(
    `SELECT * FROM growth_solution_rounds WHERE status = 'observing' AND measure_end_date <= CURRENT_DATE`
  );
  for (const round of observing.rows) {
    try {
      const review = await generateReview(round);
      await pool().query(
        `UPDATE growth_solution_rounds
         SET status='reviewing', actual_value=$2, achievement_rate=$3, review_report=$4 WHERE id=$1`,
        [round.id, review.actual_value, review.achievement_rate, JSON.stringify(review.report)]
      );
      await notify(`【增长方案·复盘】${round.store}「${round.problem_title}」第${round.round_no}轮:目标 ${round.target_value}${round.unit},实际 ${review.actual_value}${round.unit},达成率 ${(review.achievement_rate * 100).toFixed(1)}%(${review.success ? '达成✅' : '未达成'})。请在经营诊断页确认下一步。`);
    } catch (e) {
      console.error('[growth-solutions] review failed for round', round.id, e?.message);
    }
  }
}

let _sweepTimer = null;
export function startSolutionSweepScheduler() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => { runSolutionSweep().catch(() => {}); }, 6 * 3600 * 1000);
  setTimeout(() => { runSolutionSweep().catch(() => {}); }, 60 * 1000);
}

// ─── 路由 ───────────────────────────────────────────────
export function registerGrowthSolutionRoutes(app, authRequired) {
  // 六卡片总览
  app.get('/api/diagnosis/solutions/overview', authRequired, async (req, res) => {
    try {
      const store = String(req.query.store || '').trim();
      if (!store) return res.status(400).json({ ok: false, error: 'store required' });
      const endDate = ymd(new Date());
      const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
      const cards = [];
      for (const [key, def] of Object.entries(PROBLEMS)) {
        let current = null, error = null;
        try { current = await computeMetric(key, store, startDate, endDate); }
        catch (e) { error = e?.message; }
        const openRound = await getOpenRound(store, key);
        const closed = await getClosedRounds(store, key);
        const originBaseline = closed.length ? Number(closed[0].origin_baseline ?? closed[0].baseline_value) : (current?.value ?? 0);
        const target = current ? nextTarget(key, current.value, originBaseline, closed) : null;
        cards.push({
          problem_key: key, title: def.title, metric: def.metric, unit: def.unit,
          current_value: current?.value ?? null,
          summary: summarizeCard(key, current),
          next_target: openRound ? Number(openRound.target_value) : target,
          capped: !openRound && target == null && current != null,
          round: openRound ? {
            id: openRound.id, round_no: openRound.round_no, status: openRound.status,
            target_value: Number(openRound.target_value),
            tasks_total: openRound.tasks.length,
            tasks_done: openRound.tasks.filter((t) => t.status === 'done').length,
            measure_end_date: openRound.measure_end_date,
            achievement_rate: openRound.achievement_rate != null ? Number(openRound.achievement_rate) : null,
          } : null,
          rounds_closed: closed.length,
          error,
        });
      }
      // 进行中的自定义方案
      const customOpen = await pool().query(
        `SELECT * FROM growth_solution_rounds WHERE store = $1 AND problem_key LIKE 'custom:%' AND status <> 'closed' ORDER BY started_at DESC`,
        [store]
      );
      for (const r of customOpen.rows) {
        const t = await pool().query(
          `SELECT COUNT(*) FILTER (WHERE status='done') AS done, COUNT(*) AS total FROM growth_solution_tasks WHERE round_id = $1`, [r.id]
        );
        cards.push({
          problem_key: r.problem_key, title: r.problem_title, metric: r.metric_label, unit: r.unit,
          current_value: Number(r.baseline_value), summary: '自定义方案(AI生成)',
          next_target: Number(r.target_value), capped: false, is_custom: true,
          round: {
            id: r.id, round_no: r.round_no, status: r.status, target_value: Number(r.target_value),
            tasks_total: Number(t.rows[0].total), tasks_done: Number(t.rows[0].done),
            measure_end_date: r.measure_end_date,
            achievement_rate: r.achievement_rate != null ? Number(r.achievement_rate) : null,
          },
          rounds_closed: 0,
        });
      }
      res.json({ ok: true, store, window: { start: startDate, end: endDate }, cards });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自定义问题分析:输入"目前遇到的问题" → 归类到六大问题 或 生成自定义方案
  app.post('/api/diagnosis/solutions/custom/analyze', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      const question = String(req.body?.question || '').trim();
      if (!store || !question) return res.status(400).json({ ok: false, error: 'store 与 question 必填' });
      if (!_llm) return res.status(503).json({ ok: false, error: 'AI 服务未配置' });

      const templates = await pool().query(
        `SELECT problem_key, code, title, description, assignee_role, phase FROM growth_task_templates WHERE enabled = TRUE ORDER BY problem_key, sort`
      );
      const problemList = Object.entries(PROBLEMS).map(([k, v]) => `${k}: ${v.title}(指标:${v.metric})`).join('\n');
      const templateList = templates.rows.map((t) => `${t.problem_key}/${t.code}: ${t.title} — ${t.description}(角色:${t.assignee_role})`).join('\n');
      const prompt = `你是餐厅经营顾问。老板描述了当前遇到的问题,请判断如何处理,只输出JSON,不要其它文字。

老板的问题:"${question}"

系统现有六大标准问题:
${problemList}

系统任务模板库(problem_key/code: 标题 — 描述):
${templateList}

判断规则:
1. 如果老板的问题本质上属于六大标准问题之一,输出 {"mode":"existing","problem_key":"<key>","reason":"一句话说明"}
2. 否则输出自定义方案:
{"mode":"custom","title":"方案标题(10字内)","metric_key":"<从六大问题key中选一个最能衡量该问题的指标>","reason":"选择该指标的原因",
 "tasks":[{"code":"<模板code,可选>","title":"任务标题","description":"任务说明","assignee_role":"store_manager|production_manager|kitchen_staff|front_staff|hr","phase":"第1周"}],
 "out_of_scope":"如果问题中有系统能力覆盖不了的部分,在此如实说明;没有则为空字符串"}
任务3-5项,循序渐进,必须能落到系统功能上。`;

      const raw = await _llm(prompt);
      let parsed = null;
      try {
        const s = String(raw || '');
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start >= 0 && end > start) parsed = JSON.parse(s.slice(start, end + 1));
      } catch { /* fallthrough */ }
      if (!parsed || !parsed.mode) return res.status(502).json({ ok: false, error: 'AI 返回无法解析,请重试' });

      if (parsed.mode === 'existing' && PROBLEMS[parsed.problem_key]) {
        return res.json({ ok: true, mode: 'existing', problem_key: parsed.problem_key, reason: parsed.reason || '' });
      }
      // 自定义方案:补真实数据(指标现状+建议目标+责任人候选)
      const metricKey = PROBLEMS[parsed.metric_key] ? parsed.metric_key : 'revenue';
      const endDate = ymd(new Date());
      const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
      const current = await computeMetric(metricKey, store, startDate, endDate);
      const slug = 'custom:' + Date.now().toString(36);
      const target = nextTarget(metricKey, current.value, current.value, []);
      const plan = [];
      for (const t of (Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 8) : [])) {
        const role = ROLE_POSITIONS[t.assignee_role] ? t.assignee_role : 'store_manager';
        const suggested = await suggestAssignees(store, role);
        plan.push({
          template_code: t.code || null, title: String(t.title || '').slice(0, 200),
          description: String(t.description || ''), phase: t.phase || '',
          assignee_role: role, suggested_assignees: suggested, default_assignee: suggested[0] || null,
        });
      }
      if (!plan.length) return res.status(502).json({ ok: false, error: 'AI 未生成有效任务,请换个描述重试' });
      res.json({
        ok: true, mode: 'custom', problem_key: slug,
        title: String(parsed.title || '自定义方案').slice(0, 60),
        metric_key: metricKey, metric: PROBLEMS[metricKey].metric, unit: PROBLEMS[metricKey].unit,
        reason: parsed.reason || '', out_of_scope: parsed.out_of_scope || '',
        current, suggested_target: target, capped: target == null, plan,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 单问题详情:现状 + 建议目标 + 方案(责任人预填) + 当前轮次
  app.get('/api/diagnosis/solutions/:key', authRequired, async (req, res) => {
    try {
      const key = req.params.key;
      const store = String(req.query.store || '').trim();
      if (key.startsWith('custom:')) {
        // 自定义方案:只有进行中轮次可查
        if (!store) return res.status(400).json({ ok: false, error: 'store required' });
        const openRound = await getOpenRound(store, key);
        if (!openRound) return res.status(404).json({ ok: false, error: '该自定义方案不存在或已关闭' });
        const mk = openRound.metric_key || 'revenue';
        return res.json({
          ok: true, problem_key: key, title: openRound.problem_title, metric: openRound.metric_label,
          unit: openRound.unit, store, open_round: openRound, plan: null, history: [],
          current: { value: Number(openRound.baseline_value), detail: {} }, suggested_target: Number(openRound.target_value),
          metric_key: mk, capped: false,
        });
      }
      if (!PROBLEMS[key]) return res.status(404).json({ ok: false, error: 'unknown problem' });
      if (!store) return res.status(400).json({ ok: false, error: 'store required' });
      const endDate = ymd(new Date());
      const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
      const current = await computeMetric(key, store, startDate, endDate);
      const openRound = await getOpenRound(store, key);
      const closed = await getClosedRounds(store, key);
      const originBaseline = closed.length ? Number(closed[0].origin_baseline ?? closed[0].baseline_value) : current.value;
      const target = nextTarget(key, current.value, originBaseline, closed);
      const plan = openRound ? null : await buildPlan(key, store, current.detail);
      res.json({
        ok: true, problem_key: key, ...PROBLEMS[key], store,
        window: { start: startDate, end: endDate },
        current, suggested_target: target, capped: target == null,
        origin_baseline: originBaseline,
        history: closed.map((r) => ({
          round_no: r.round_no, baseline: Number(r.baseline_value), target: Number(r.target_value),
          actual: r.actual_value != null ? Number(r.actual_value) : null,
          achievement_rate: r.achievement_rate != null ? Number(r.achievement_rate) : null,
          decision: r.decision, closed_at: r.closed_at,
        })),
        open_round: openRound, plan,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 创建轮次(下发):所有任务必须有责任人
  app.post('/api/diagnosis/solutions/:key/rounds', authRequired, async (req, res) => {
    try {
      const key = req.params.key;
      const { store, target_value, tasks } = req.body || {};
      const isCustom = key.startsWith('custom:');
      if (!isCustom && !PROBLEMS[key]) return res.status(404).json({ ok: false, error: 'unknown problem' });
      if (isCustom && (!req.body?.custom_title || !PROBLEMS[req.body?.metric_key])) {
        return res.status(400).json({ ok: false, error: '自定义方案需提供 custom_title 与有效 metric_key' });
      }
      if (!store) return res.status(400).json({ ok: false, error: 'store required' });
      if (!Array.isArray(tasks) || !tasks.length) return res.status(400).json({ ok: false, error: '任务清单为空' });
      const missing = tasks.filter((t) => !String(t.assignee_username || '').trim());
      if (missing.length) {
        return res.status(400).json({ ok: false, error: `有 ${missing.length} 项任务未指定责任人`, missing: missing.map((t) => t.title) });
      }
      const existing = await getOpenRound(store, key);
      if (existing) return res.status(409).json({ ok: false, error: `当前已有第${existing.round_no}轮进行中(${existing.status}),全部完成并复盘关闭前不能开新轮次` });

      const metricKey = isCustom ? req.body.metric_key : key;
      const probTitle = isCustom ? String(req.body.custom_title).slice(0, 60) : PROBLEMS[key].title;
      const endDate = ymd(new Date());
      const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
      const current = await computeMetric(metricKey, store, startDate, endDate);
      const closed = await getClosedRounds(store, key);
      const originBaseline = closed.length ? Number(closed[0].origin_baseline ?? closed[0].baseline_value) : current.value;
      const suggested = nextTarget(metricKey, current.value, originBaseline, closed);
      const target = target_value != null ? Number(target_value) : suggested;
      if (target == null) return res.status(400).json({ ok: false, error: '该指标已达封顶,无需开新轮次' });
      const roundNo = closed.length + 1;

      const ins = await pool().query(
        `INSERT INTO growth_solution_rounds
           (store, problem_key, problem_title, round_no, metric_label, metric_key, unit,
            baseline_value, origin_baseline, target_value, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING id`,
        [store, key, probTitle, roundNo, PROBLEMS[metricKey].metric, metricKey, PROBLEMS[metricKey].unit,
         current.value, originBaseline, target, req.user?.username || '']
      );
      const roundId = ins.rows[0].id;
      let sort = 0;
      for (const t of tasks) {
        sort += 1;
        await pool().query(
          `INSERT INTO growth_solution_tasks
             (round_id, template_code, title, description, assignee_username, assignee_name, due_date, phase, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [roundId, t.template_code || null, t.title, t.description || '', t.assignee_username,
           t.assignee_name || '', t.due_date || null, t.phase || '', sort]
        );
        // 培训类任务:同步创建真实培训指派
        if ((t.template_code === 'assign_cert_training' || t.template_code === 'batch_assign') && _createTrainingAssignment && Array.isArray(t.training_targets)) {
          for (const tt of t.training_targets) {
            try {
              await _createTrainingAssignment({
                employeeUsername: tt.username, topicId: tt.topic_id,
                assignedBy: req.user?.username || 'growth-solution',
                dueDate: t.due_date || null, note: `增长方案第${roundNo}轮任务`, source: 'growth_solution',
              });
            } catch { /* 单条失败不阻塞 */ }
          }
        }
      }
      await notify(`【增长方案·下发】${store}「${probTitle}」第${roundNo}轮启动:基线 ${current.value}${PROBLEMS[metricKey].unit} → 目标 ${target}${PROBLEMS[metricKey].unit},共 ${tasks.length} 项任务已指定责任人。`);
      res.json({ ok: true, round_id: roundId, round_no: roundNo, baseline: current.value, target });
    } catch (e) {
      if (String(e?.message || '').includes('uq_solution_round_open')) {
        return res.status(409).json({ ok: false, error: '当前问题已有进行中的轮次' });
      }
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 任务完成登记
  app.post('/api/diagnosis/solutions/rounds/:roundId/tasks/:taskId/complete', authRequired, async (req, res) => {
    try {
      const { roundId, taskId } = req.params;
      const note = String(req.body?.note || '');
      const r = await pool().query(
        `UPDATE growth_solution_tasks SET status='done', done_at=NOW(), done_note=$3
         WHERE id=$1 AND round_id=$2 AND status <> 'done' RETURNING id`,
        [taskId, roundId, note]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: '任务不存在或已完成' });
      await runSolutionSweep(); // 立即检查是否全部完成→进观察期
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 复盘确认:advance(达成,进下一轮准备) / retry(未达成,同目标重跑)
  app.post('/api/diagnosis/solutions/rounds/:roundId/confirm', authRequired, async (req, res) => {
    try {
      const { roundId } = req.params;
      const decision = String(req.body?.decision || '');
      if (!['advance', 'retry'].includes(decision)) return res.status(400).json({ ok: false, error: 'decision must be advance|retry' });
      const r = await pool().query(`SELECT * FROM growth_solution_rounds WHERE id=$1 AND status='reviewing'`, [roundId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: '轮次不存在或不在待确认状态' });
      const round = r.rows[0];
      const rate = Number(round.achievement_rate || 0);
      if (decision === 'advance' && rate < SUCCESS_RATE) {
        return res.status(400).json({ ok: false, error: `达成率 ${(rate * 100).toFixed(1)}% 未达90%,只能选择重跑(retry)` });
      }
      await pool().query(
        `UPDATE growth_solution_rounds SET status='closed', decision=$2, closed_at=NOW() WHERE id=$1`,
        [roundId, decision]
      );
      await notify(`【增长方案·确认】${round.store}「${round.problem_title}」第${round.round_no}轮已关闭(${decision === 'advance' ? '达成,进入下一轮' : '未达成,同目标重跑'})。`);
      res.json({ ok: true, decision });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 强制复盘:任务催促无果长期不动时,老板可直接进入复盘,报告将点名未完成任务
  app.post('/api/diagnosis/solutions/rounds/:roundId/force-review', authRequired, async (req, res) => {
    try {
      const r = await pool().query(`SELECT * FROM growth_solution_rounds WHERE id=$1 AND status IN ('active','observing')`, [req.params.roundId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: '轮次不存在或已在复盘/关闭状态' });
      const round = r.rows[0];
      const review = await generateReview(round);
      await pool().query(
        `UPDATE growth_solution_rounds SET status='reviewing', actual_value=$2, achievement_rate=$3, review_report=$4 WHERE id=$1`,
        [round.id, review.actual_value, review.achievement_rate, JSON.stringify(review.report)]
      );
      await notify(`【增长方案·强制复盘】${round.store}「${round.problem_title}」第${round.round_no}轮被手动送入复盘(存在未完成任务的将在报告中如实点名)。`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 手动触发扫描(调试/演示用)
  app.post('/api/diagnosis/solutions/sweep', authRequired, async (req, res) => {
    try {
      if (String(req.user?.role || '') !== 'admin') return res.status(403).json({ ok: false, error: 'admin only' });
      await runSolutionSweep();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });
}

function summarizeCard(key, current) {
  if (!current) return '';
  const d = current.detail || {};
  switch (key) {
    case 'staff_efficiency': return `折前营收 ¥${d.pre_discount_revenue ?? 0} / ${d.person_days ?? 0} 人天`;
    case 'revenue': return `高风险流失客户 ${d.sleeping_customers ?? 0} 位可召回`;
    case 'kitchen_standard': return `应打点 ${d.expected ?? 0} 次,实际 ${d.confirmed ?? 0} 次`;
    case 'menu_optimization': return `高投诉 ${Array.isArray(d.complaint_dishes) ? d.complaint_dishes.length : 0} 道,淘汰象限见详情`;
    case 'gross_margin': return `已匹配成本 ${d.matched_dishes ?? 0} 道,缺成本 ${d.unmatched_dishes ?? 0} 道`;
    case 'training_replication': return `必修 ${d.required ?? 0} 项,缺口 ${d.gap_count ?? 0} 项`;
    default: return '';
  }
}
