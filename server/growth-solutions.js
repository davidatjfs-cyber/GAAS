// 经营诊断·六大增长方案模块
// 问题 → 现状(真实数据) → 阶梯目标 → 任务方案(责任人必填) → 轮次闭环(观察期→复盘→进阶/重跑)
// 规则:达成率 = 实际/目标,≥90% 算达成;同一(门店,问题)同时只允许一个未关闭轮次

import { pool as getPool } from './utils/database.js';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'growth-solutions' });

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
    scope: '员工人均产出偏低(排班、人力浪费类问题)，不涉及服务态度或出品质量',
  },
  revenue: {
    title: '提升营业额',
    metric: '近30天营业额',
    unit: '元',
    ladder: { type: 'pct', step: 0.05, cap: 0.20 },
    scope: '整体营业额/客流/客单下滑，不涉及具体菜品或服务态度问题',
  },
  kitchen_standard: {
    title: '提升出品标准',
    metric: 'SOP打点完成率',
    unit: '%',
    ladder: { type: 'ladder', steps: [80, 90, 95] },
    scope: '厨房SOP执行/打点纪律问题(出餐流程是否按标准做)，不涉及具体某道菜好不好吃',
  },
  menu_optimization: {
    title: '提升菜单质量',
    metric: '本轮处理问题菜品数',
    unit: '道',
    ladder: { type: 'count', perRound: 5 },
    scope: '仅限桌访反馈里对具体菜品口味/份量/新鲜度等的不满意；不包括服务态度、上菜速度、员工礼仪、环境卫生、结账效率等非菜品类投诉',
  },
  gross_margin: {
    title: '提升菜品毛利率',
    metric: '综合毛利率(已匹配成本菜品)',
    unit: '%',
    ladder: { type: 'pp', step: 1, cap: 3 },
    scope: '菜品成本结构/毛利偏低，不涉及服务或出品质量',
  },
  training_replication: {
    title: '复制培养人才',
    metric: '关键岗位必修认证覆盖率',
    unit: '%',
    ladder: { type: 'ladder', steps: [50, 80, 100] },
    scope: '关键岗位认证覆盖率/人才梯队问题，不涉及日常服务态度好坏',
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
  { problem_key: 'staff_efficiency', code: 'enable_daily_rating', title: '开启每日执行力AI评分', description: '全员纳入每日执行力评分,评分结果次日推送店长', why: '人效偏低往往是执行不到位却没有及时发现,每日评分能第一时间暴露问题岗位/时段', acceptance_criteria: '全员评分覆盖率100%;连续7天评分数据可查', assignee_role: 'store_manager', phase: '第1周', sort: 1 },
  { problem_key: 'staff_efficiency', code: 'launch_points_incentive', title: '优化积分现金激励规则', description: '配置标准动作→当日积分规则,积分兑现为现金发放,排行榜公示', why: '单靠考核发现问题不够,需要正向激励让员工主动提升效率,积分兑现比单纯说教更有效', acceptance_criteria: '员工实际参与/申报积分制度的人数占比≥90%,积极性明显提升', assignee_role: 'store_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'staff_efficiency', code: 'assign_cert_training', title: '为缺认证员工指派必修培训', description: '按岗位晋升要求,为缺认证员工批量指派培训任务', why: '认证缺口通常直接对应技能短板,是效率提不上去的根源之一', acceptance_criteria: '缺认证员工100%收到培训指派;2周内完成率≥70%', assignee_role: 'production_manager', phase: '第2-4周', sort: 3 },
  { problem_key: 'staff_efficiency', code: 'weekly_efficiency_review', title: '每周对比人效曲线与目标线', description: '每周复盘人效走势,识别排班与客流错配', why: '前面的动作有没有见效必须靠持续对比数据才能判断,不复盘容易做完就忘', acceptance_criteria: '连续4周有复盘记录;人效曲线较基线提升', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 营业额:自动营销 + PLLM 双引擎(对营业额最有效的组合)
  { problem_key: 'revenue', code: 'enable_auto_marketing', title: '开启营销自动驾驶', description: 'AI每日结合营收环比与节假日自动生成召回/促销活动,店长只需确认发送', why: '营收下滑往往等店长发现时已经晚了,自动化能在苗头出现时就触发应对,减少人为疏漏', acceptance_criteria: '自动营销开关开启;近7天至少生成1次自动活动', assignee_role: 'store_manager', phase: '第1周', sort: 1 },
  { problem_key: 'revenue', code: 'launch_recall_campaign', title: '沉睡客户分批召回', description: '按流失风险分批召回(高风险先行),AI生成文案+匹配优惠券,企微触达', why: '沉睡客户是最容易被忽视但召回成本最低的营收来源,直接影响客流基本盘', acceptance_criteria: '高风险沉睡客户召回覆盖率≥80%;触达后7天回店率可追踪', assignee_role: 'store_manager', phase: '第1-3周', sort: 2 },
  { problem_key: 'revenue', code: 'execute_pllm_actions', title: '执行PLLM经营诊断建议', description: '每日经营异常(客流/客单/差评/售罄)由PLLM生成整改建议,当天安排执行', why: '光有诊断不落地等于白诊断,营收问题必须当天响应才能止损', acceptance_criteria: '每日诊断建议当天处理率≥90%', assignee_role: 'store_manager', phase: '持续', sort: 3 },
  { problem_key: 'revenue', code: 'weekly_revenue_review', title: '每周复盘营收与召回效果', description: '对比营收曲线与召回批次、核销率,沉淀有效方案供下轮复用', why: '需要确认前面的营销动作是不是真的把营收拉回来了,不然就是白忙', acceptance_criteria: '连续4周复盘记录;营收环比改善', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 出品标准化
  { problem_key: 'kitchen_standard', code: 'config_station_mapping', title: '配置岗位×菜品打点计划', description: '在厨房执行模块配置岗位菜品映射与每日打点时间', why: '出品标准不稳首先要明确"谁负责哪道菜的哪个环节",没有映射就没法追责', acceptance_criteria: '岗位菜品映射覆盖率100%', assignee_role: 'production_manager', phase: '第1周', sort: 1 },
  { problem_key: 'kitchen_standard', code: 'enable_punch_card', title: 'SOP打点卡上线并培训', description: '关键岗位学会使用打点卡,明确漏打点提醒规则', why: '光有映射没人真的按标准操作也没用,打点卡是把标准落到每个动作上的抓手', acceptance_criteria: '关键岗位打点卡使用率100%;培训完成率100%', assignee_role: 'production_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'kitchen_standard', code: 'daily_punch', title: '每日按计划完成SOP打点', description: '出品经理督导各岗位按时打点,漏打点当日整改', why: '出品不稳定的核心就是执行不稳定,每日打点是唯一能验证"标准有没有被真的执行"的方式', acceptance_criteria: 'SOP打点完成率≥80%', assignee_role: 'production_manager', phase: '持续', sort: 3 },
  { problem_key: 'kitchen_standard', code: 'review_timeout', title: '每周复盘出餐超时与漏打点', description: '结合出餐超时报告与打点看板,定位问题岗位', why: '打点做了不代表问题解决了,需要看超时和漏打点数据才知道哪个岗位/时段还有缺口', acceptance_criteria: '连续4周复盘记录;超时率/漏打点率环比下降', assignee_role: 'production_manager', phase: '每周', sort: 4 },
  // 菜单优化
  { problem_key: 'menu_optimization', code: 'review_complaint_dishes', title: '审核高投诉菜品清单', description: '核对桌访不满意菜品与差评,确认问题菜品名单', why: '菜单质量问题必须先精准定位到具体是哪几道菜出了问题,不能凭印象处理', acceptance_criteria: '高投诉菜品清单100%核实完成', assignee_role: 'production_manager', phase: '第1周', sort: 1 },
  { problem_key: 'menu_optimization', code: 'decide_elimination', title: '确认淘汰/重做/优化名单', description: '按四象限与淘汰建议,拍板每道问题菜的处理方式', why: '光知道哪些菜有问题不够,必须明确每道菜的处理方式(留/改/下架)才能推进执行', acceptance_criteria: '问题菜品100%确定处理方式并落实到执行清单', assignee_role: 'store_manager', phase: '第1-2周', sort: 2 },
  { problem_key: 'menu_optimization', code: 'rework_recipes', title: '重做菜品更新配方与SOP', description: '对重做菜品更新配方、SOP与打点步骤', why: '只拍板"要重做"没用,必须真的把配方和SOP改掉,问题菜才可能真正变好', acceptance_criteria: '重做菜品配方/SOP更新完成率100%', assignee_role: 'production_manager', phase: '第2-4周', sort: 3 },
  { problem_key: 'menu_optimization', code: 'next_cycle_review', title: '下周期复盘四象限变化', description: '对比处理前后的四象限与投诉变化', why: '需要验证这轮处理是不是真的让菜单结构变好了,投诉是不是真的减少了', acceptance_criteria: '下周期高投诉菜品数量较本轮下降', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 门店毛利
  { problem_key: 'gross_margin', code: 'complete_cost_library', title: '补全菜品成本库', description: '为缺失成本的在售菜品补录单位成本', why: '毛利率问题必须先有准确的成本数据才能算清楚,成本缺失会导致后面所有分析都不准', acceptance_criteria: '在售菜品成本覆盖率≥95%', assignee_role: 'production_manager', phase: '第1-2周', sort: 1 },
  { problem_key: 'gross_margin', code: 'handle_low_margin', title: '处理低毛利TOP菜品', description: '对低毛利菜逐道决策:提价/换料/缩份/下架', why: '找到问题菜之后必须真的对每一道做出决策,不然毛利率不会自己变好', acceptance_criteria: '低毛利TOP菜品100%完成决策(提价/换料/缩份/下架)并执行', assignee_role: 'store_manager', phase: '第2-3周', sort: 2 },
  { problem_key: 'gross_margin', code: 'procurement_review', title: '按采购建议核对进货', description: '对高消耗原料核对进货价格与用量', why: '毛利率被拉低经常是采购价格或用量出了问题,需要在源头核实', acceptance_criteria: '高消耗原料采购核对完成率100%', assignee_role: 'production_manager', phase: '持续', sort: 3 },
  { problem_key: 'gross_margin', code: 'monthly_margin_review', title: '每月复盘综合毛利率', description: '对比毛利率曲线与目标,复盘措施有效性', why: '需要确认前面这些动作是不是真的把毛利率拉回目标线,不然措施就是无效的', acceptance_criteria: '综合毛利率较基线提升;月度复盘记录留存', assignee_role: 'store_manager', phase: '持续', sort: 4 },
  // 培训复制
  { problem_key: 'training_replication', code: 'mount_materials', title: '为知识点挂载教材', description: '为必修知识点补齐视频/文档教材', why: '培训体系要能复制,前提是每个必修知识点都有教材可学,不能只靠师傅口传心授', acceptance_criteria: '必修知识点教材覆盖率100%', assignee_role: 'production_manager', phase: '第1-2周', sort: 1 },
  { problem_key: 'training_replication', code: 'batch_assign', title: '批量指派岗位必修培训', description: '按岗位晋升要求为在职员工批量指派培训', why: '有教材不代表员工会主动学,必须主动指派才能确保覆盖到位', acceptance_criteria: '在职员工必修培训指派覆盖率100%', assignee_role: 'store_manager', phase: '第1周', sort: 2 },
  { problem_key: 'training_replication', code: 'ai_exam', title: '员工完成AI陪练与考试', description: '出品经理督导员工在移动端完成AI陪练对话与随堂考试', why: '学了不代表真的掌握,考试是验证培训效果的硬指标', acceptance_criteria: '指派培训2周内考试通过率≥80%', assignee_role: 'production_manager', phase: '第2-4周', sort: 3 },
  { problem_key: 'training_replication', code: 'cert_review', title: '认证审核与到期复审', description: '管理端审核实操认证,到期自动复审', why: '认证是人才梯队可持续的保障,到期不复审会导致技能水平悄悄退化', acceptance_criteria: '到期认证复审完成率100%,无逾期未处理', assignee_role: 'production_manager', phase: '持续', sort: 4 },
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
  await pool().query(`ALTER TABLE growth_task_templates ADD COLUMN IF NOT EXISTS why TEXT`);
  await pool().query(`ALTER TABLE growth_task_templates ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT`);
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
  await pool().query(`ALTER TABLE growth_solution_tasks ADD COLUMN IF NOT EXISTS why TEXT`);
  await pool().query(`ALTER TABLE growth_solution_tasks ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT`);
  // 种子模板:以代码为准覆盖更新;不在种子里的旧模板停用
  for (const t of TASK_TEMPLATE_SEED) {
    await pool().query(
      `INSERT INTO growth_task_templates (problem_key, code, title, description, assignee_role, phase, sort, why, acceptance_criteria)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (problem_key, code) DO UPDATE
         SET title=EXCLUDED.title, description=EXCLUDED.description,
             assignee_role=EXCLUDED.assignee_role, phase=EXCLUDED.phase,
             sort=EXCLUDED.sort, enabled=TRUE, why=EXCLUDED.why, acceptance_criteria=EXCLUDED.acceptance_criteria`,
      [t.problem_key, t.code, t.title, t.description, t.assignee_role, t.phase, t.sort, t.why || null, t.acceptance_criteria || null]
    );
  }
  const seedKeys = TASK_TEMPLATE_SEED.map((t) => `${t.problem_key}/${t.code}`);
  await pool().query(
    `UPDATE growth_task_templates SET enabled = FALSE
     WHERE problem_key = ANY($1) AND problem_key || '/' || code <> ALL($2)`,
    [Object.keys(PROBLEMS), seedKeys]
  );
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
    `SELECT pre_discount_revenue, staff FROM ${SHARED_TABLES.DAILY_REPORTS}
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
     FROM ${SHARED_TABLES.DAILY_REPORTS} WHERE store = $1 AND date >= $2 AND date <= $3`,
    [store, startDate, endDate]
  );
  const storeCode = store.includes('马己仙') ? '51866138' : (store.includes('洪潮') ? '64822111' : '');
  let sleepingHigh = 0, sleepingMedium = 0;
  if (storeCode) {
    const c = await pool().query(
      `SELECT risk_level, COUNT(*) AS n FROM growth_churn_predictions
       WHERE store_code = $1 AND risk_level IN ('high','critical','medium','高','极高','中')
         AND prediction_date = (SELECT MAX(prediction_date) FROM growth_churn_predictions WHERE store_code = $1)
       GROUP BY risk_level`,
      [storeCode]
    );
    for (const row of c.rows) {
      if (/high|critical|高/.test(row.risk_level)) sleepingHigh += Number(row.n);
      else sleepingMedium += Number(row.n);
    }
  }
  return {
    value: round2(r.rows[0]?.rev),
    detail: {
      days: Number(r.rows[0]?.days || 0),
      sleeping_customers: sleepingHigh + sleepingMedium,
      sleeping_high: sleepingHigh,
      sleeping_medium: sleepingMedium,
    },
  };
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
  // 数据源:pos_sales_detail(pos_order_items 视图,POS实时同步);sales_raw 已停更,勿用
  const r = await pool().query(
    `SELECT dish_name, category, biz_type,
            SUM(qty) AS qty, SUM(revenue) AS revenue
     FROM ${SHARED_TABLES.POS_SALES_DETAIL}
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
  // 之前是拿全渠道所有菜品混在一起算一个中位数——米饭/饮料这类客单价天然低的品类，
  // 销量再高、利润额也大概率低于主菜的中位数，被系统性地判成"引流"甚至"淘汰"，但这不是
  // 它们经营得不好，是跟主菜比价格基数完全不同、根本不该放在同一把尺子上比。
  // 改成按category分组，每个菜品只跟"自己品类里的其他菜品"比中位数，米饭组自己有米饭组的
  // 中位数，主菜组自己有主菜组的中位数，谁在自己品类里表现好/差才是有意义的判断。
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
  // qty_median/profit_median 这两个汇总值现在只是"各品类中位数的均值"，仅供参考展示，
  // 真正的分类判断在上面已经是按各自品类的中位数做的。
  return {
    qty_median: catCount ? round2(qtyMedSum / catCount) : 0,
    profit_median: catCount ? round2(profitMedSum / catCount) : 0,
    matched: matched.length, ...buckets,
  };
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
    `SELECT username, name, position FROM ${SHARED_TABLES.EMPLOYEES}
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

// 把computeMetric()算出来的真实数据摊平成给LLM读的文字摘要，用于existing模式的
// 二次分析调用——不同problem_key的detail结构不一样，这里按各自最有信息量的字段挑着写。
function summarizeMetricForAnalysis(problemKey, current) {
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
    `SELECT username, name, position FROM ${SHARED_TABLES.EMPLOYEES}
     WHERE store ILIKE '%' || $1 || '%'
       AND coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')
       AND (${clauses})
     ORDER BY position, name LIMIT 20`,
    [brand, ...positions]
  );
  // 按角色岗位优先级排序(如 店长 优先于 主管/前厅经理)
  const prio = (p) => {
    const idx = positions.findIndex((kw) => String(p || '').includes(kw));
    return idx === -1 ? 999 : idx;
  };
  return r.rows.sort((a, b) => prio(a.position) - prio(b.position));
}

// ─── 自定义问题分析历史存档——只留"问过什么问题"，不留"当时的结果" ──────
// 用户明确要求：点历史记录要重新生成，不要回放旧结果，所以这里不再存完整result_json，
// 只存title(列表展示用)，避免有人以后不小心又把它当"缓存"用。
async function saveQueryHistory(tenantId, store, question, resultPayload, username) {
  try {
    await pool().query(
      `INSERT INTO growth_custom_query_history (tenant_id, store, question, result_json, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [tenantId || 'default', store, question, JSON.stringify({ title: resultPayload?.title || question, mode: resultPayload?.mode }), username || null]
    );
  } catch (e) {
    log.error({ msg: 'save_query_history_failed', err: e?.message || String(e) });
  }
}

// ─── 真实差评/投诉数据(大众点评/美团截图，经视觉LLM提取后落在agent_messages) ──
// bad_reviews表本身是空的(同步链路没跑通)，真正有数据的是agent_messages里
// content_type='negative_review'的记录，agent_data里带reason/product/rating等结构化字段。
// 提取环节本身会把"截图里其实不是差评"的情况也存进来(reason里写"不存在符合要求的差评"这类话)，
// 这里过滤掉，只留真实差评。
async function fetchRecentComplaints(store, days = 30) {
  const brand = brandKeyOf(store);
  const r = await pool().query(
    `SELECT created_at::date AS date, agent_data->>'reason' AS reason,
            agent_data->>'product' AS product, agent_data->>'rating' AS rating,
            agent_data->>'platform' AS platform
       FROM ${SHARED_TABLES.AGENT_MESSAGES}
      WHERE content_type = 'negative_review'
        AND agent_data->>'store' ILIKE '%' || $1 || '%'
        AND created_at > now() - ($2 || ' days')::interval
        AND coalesce(agent_data->>'reason','') NOT ILIKE '%不存在符合要求%'
        AND coalesce(agent_data->>'reason','') NOT ILIKE '%无差评%'
        AND coalesce(agent_data->>'reason','') NOT IN ('无', '', '该评价为好评，不属于差评，无法提取差评原因。')
      ORDER BY created_at DESC LIMIT 30`,
    [brand, String(days)]
  );
  return r.rows;
}

// ─── 真实员工流动快照(employees.status，没有离职日期字段，只能给全量在职/离职快照) ──
async function fetchTurnoverSnapshot(store) {
  const brand = brandKeyOf(store);
  const r = await pool().query(
    `SELECT count(*) FILTER (WHERE coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')) AS active,
            count(*) FILTER (WHERE coalesce(status,'') IN ('inactive','resigned','离职')) AS left_count,
            count(*) AS total
       FROM ${SHARED_TABLES.EMPLOYEES} WHERE store ILIKE '%' || $1 || '%'`,
    [brand]
  );
  const row = r.rows[0] || {};
  return {
    active: Number(row.active || 0),
    left: Number(row.left_count || 0),
    total: Number(row.total || 0),
  };
}

// ─── 方案生成(模板 + 真实数据缺口 → 任务清单) ─────────────
async function buildPlan(problemKey, store, currentDetail) {
  const templates = await pool().query(
    `SELECT code, title, description, assignee_role, phase, sort, why, acceptance_criteria
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
    if (t.code === 'launch_recall_campaign' && currentDetail?.sleeping_customers > 0) {
      description += `(可召回沉睡池 ${currentDetail.sleeping_customers} 位:高风险 ${currentDetail.sleeping_high || 0} + 中风险 ${currentDetail.sleeping_medium || 0})`;
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
      why: t.why || '',
      acceptance_criteria: t.acceptance_criteria || '',
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
        + `必须明确回答:结果与目标的差异,多大程度是执行力问题(逾期/催促无果/未完成),多大程度是方案本身问题。有执行问题就点名说清,没有就明说执行到位。`
        + `⚠️ 归因只能基于下方传入的执行数据,禁止引入任何传入数据以外的推测原因（如节假日影响、天气因素、竞争对手等）。\n`
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
      log.error({ msg: 'review_failed', round_id: round.id, err: e?.message });
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
function registerGrowthSolutionOverviewRoutes(app, authRequired) {
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

}

function registerGrowthSolutionCustomRoutes(app, authRequired) {
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
      const problemList = Object.entries(PROBLEMS).map(([k, v]) => `${k}: ${v.title}(指标:${v.metric}；适用范围:${v.scope || v.title})`).join('\n');
      const templateList = templates.rows.map((t) => `${t.problem_key}/${t.code}: ${t.title} — ${t.description}(角色:${t.assignee_role})`).join('\n');

      // 服务态度/投诉类、员工流失类问题，六大指标都套不上，但系统其实有真实数据——
      // 差评来自大众点评/美团截图经视觉LLM提取，落在agent_messages(bad_reviews表本身是空的、
      // 同步链路没接上，别被表名骗了)；员工流失来自employees.status快照(没有离职日期字段，
      // 只能给"当前在职/离职人数"这种快照，不能给"近30天流失率"这种趋势)。
      // 按问题文字关键词判断要不要附带这两类真实数据，让AI基于真实证据回答而不是空对空。
      const wantsReviewData = /差评|投诉|服务|态度|上菜|环境|卫生|评价/.test(question);
      const wantsTurnoverData = /离职|流失|人员流动|留不住|招聘|人手/.test(question);
      let extraDataBlock = '';
      let reviewsFetched = null;
      let turnoverFetched = null;
      if (wantsReviewData) {
        reviewsFetched = await fetchRecentComplaints(store, 30);
        if (reviewsFetched.length) {
          extraDataBlock += `\n\n【真实数据·近30天差评/投诉记录(${reviewsFetched.length}条，来自大众点评/美团)】\n` +
            reviewsFetched.slice(0, 20).map((r, i) => `${i + 1}. [${r.date}] ${r.reason}`).join('\n') +
            `\n以上是真实差评内容，请通读后自行判断哪些是服务态度类、哪些是菜品类、哪些是环境/效率类，
在reason和tasks里必须引用这些真实反馈里的具体问题模式(不要照抄原文，但要基于真实内容归纳，不要凭空想象)。`;
        } else {
          extraDataBlock += `\n\n【真实数据】近30天没有查到该店的差评/投诉记录(可能是数据同步延迟，也可能是真的没有差评)。`;
        }
      }
      if (wantsTurnoverData) {
        turnoverFetched = await fetchTurnoverSnapshot(store);
        extraDataBlock += `\n\n【真实数据·员工在职/离职快照(全量,非近期新增,系统没有离职日期字段无法算近期流失率)】\n当前在职 ${turnoverFetched.active} 人，离职/停用 ${turnoverFetched.left} 人，总建档 ${turnoverFetched.total} 人。`;
      }

      const prompt = `你是餐厅经营顾问。老板描述了当前遇到的问题,请判断如何处理,只输出JSON,不要其它文字。

当前分析的门店:"${store}"（后续生成的title/reason/tasks都必须只针对这一家店，不要涉及其它门店）

老板的问题:"${question}"
${extraDataBlock}

系统现有六大标准问题(每条后面标注了严格适用范围,只有问题确实落在适用范围内才能匹配,不要因为字面沾边就强行匹配——
比如menu_optimization只管"菜品本身口味/份量/新鲜度"这类桌访反馈,不包括服务态度、上菜速度、员工礼仪、环境卫生等非菜品类问题):
${problemList}

系统任务模板库(problem_key/code: 标题 — 描述):
${templateList}

判断规则:
1. 如果老板的问题严格落在六大标准问题的适用范围内,输出 {"mode":"existing","problem_key":"<key>","reason":"一句话说明"}
2. 否则(包括服务态度/环境卫生/员工礼仪/员工流失等六大标准问题都不覆盖的情况)输出自定义方案:
{"mode":"custom","title":"方案标题(10字内)","metric_key":"<从六大问题key中选一个最能衡量该问题的指标;如果六大问题里没有一个真正相关,留空字符串>",
 "analysis":"【硬性要求，必填，150-300字的经营分析总结，不是简单复述数字】必须包含三部分：①现状判断——如果上面给了真实数据(差评列表/员工快照)，具体解读这些数据说明了什么(比如差评里反复出现的问题模式、离职率相对什么水平算高)，不能只是把数字抄一遍；②可能原因——基于餐饮行业经验，对着这些现状给出1-3个最可能的根因假设；③这些任务为什么能解决——简要说明下面的任务方案分别针对哪个根因。如果上面完全没有真实数据支撑，则基于餐饮行业通用常识做同样深度的分析，并在开头注明"当前无本店真实数据，以下基于行业经验判断"。",
 "reason":"一句话总结(20字内，用于列表展示，比如"离职率34%明显偏高，主要因新人培养跟不上"这种一句话结论，不是"选了xx指标因为..."这种口径说明)",
 "priority_recommendation":"从下面的tasks里选一项最优先执行的，格式：AI建议优先执行:<任务标题>。原因:<一句话说明为什么这项最该优先做，比如成本最低/见效最快/是其它任务的前提>",
 "tasks":[{"code":"<模板code,可选>","title":"任务标题","description":"任务说明","why":"这项任务为什么要做(80字内，必须结合上面analysis里的根因，说明这项具体动作解决了哪个根因、不做会有什么后果，不能是空话)","acceptance_criteria":"验收标准(必填，1-2条可量化的完成判断标准，比如\"岗位必修培训完成率≥90%\"、\"AI陪练考试通过率≥80%\"，让责任人和管理者都清楚做到什么程度才算完成，不能写\"完成培训\"这种无法验收的说法)","assignee_role":"store_manager|production_manager|hr","phase":"第1周"}],
任务责任人规则:厨房相关任务一律 production_manager(出品经理),前厅/营销/复盘任务一律 store_manager(店长)。
 "out_of_scope":"如果问题中有系统能力覆盖不了的部分(含"没有真实数据支撑"这种情况),在此如实说明;如果上面已经给了真实数据(差评列表/员工快照)则此项应为空字符串，不要说"没有数据""}
任务3-5项,循序渐进,必须能落到系统功能上。

⚠️ 任务description硬性要求:禁止提及具体菜品名称、价格数字或SOP操作细节（这些由执行人员在具体执行时确定）；description只描述"做什么动作/目标"，不描述"如何具体操作"。
⚠️ analysis字段是这次输出里最重要的部分，老板就是靠这段话判断你有没有真正读懂问题——绝对不能是"当前XX人，YY人，比例较高"这种数字复述，必须有判断、有推理、有解释。
⚠️ 任务描述要假设门店可能已经部分做了类似的事(比如积分激励规则、培训制度这类常见管理动作，很多店多少都有一些)，措辞要用"优化/新增XX规则/加强XX"而不是"上线/从零开始建立"这种假设完全没做过的说法，除非老板的问题原文明确说了"没有"或"从来没做过"。
⚠️ 涉及"积分"激励的任务：本系统的积分是直接发放现金，不是代金券/兑换券，不存在"兑换"环节，acceptance_criteria禁止出现"兑换率""兑换记录""满意度"这类不存在或无法核实的指标，应使用可从系统数据核实的客观指标，例如"员工实际参与/申报积分的人数占比≥90%"。`;

      const raw = await _llm(prompt);
      let parsed = null;
      try {
        const s = String(raw || '');
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start >= 0 && end > start) parsed = JSON.parse(s.slice(start, end + 1));
      } catch (parseErr) {
        log.error({ msg: 'custom_analyze_json_parse_failed', err: parseErr?.message, raw_length: String(raw || '').length });
      }
      if (!parsed || !parsed.mode) return res.status(502).json({ ok: false, error: 'AI 返回无法解析,请重试' });

      if (parsed.mode === 'existing' && PROBLEMS[parsed.problem_key]) {
        // 之前"existing"模式匹配到六大标准问题后直接跳转详情页，LLM的判断力完全没被用上——
        // 老板问"核心产品销量下降"，系统认了"这是menu_optimization"就直接跳到菜品四象限表格，
        // 一句分析都没有。现在补一步：先把该问题真实的现状数据算出来(比如菜品四象限/SOP打点率)，
        // 再让AI基于这些真实数字做一次有依据的分析，而不是凭空猜"大概会是什么情况"。
        const existingKey = parsed.problem_key;
        let existingAnalysis = '';
        try {
          const endDate = ymd(new Date());
          const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
          const current = await computeMetric(existingKey, store, startDate, endDate);
          const realDataSummary = summarizeMetricForAnalysis(existingKey, current);
          const analysisPrompt = `你是餐厅经营顾问。老板问："${question}"，系统判断这属于"${PROBLEMS[existingKey].title}"这个标准问题。

真实数据现状：
${realDataSummary}

请基于以上真实数据，写一段150-250字的经营分析，必须包含：①这些真实数字说明了什么问题；②可能的根因；③建议老板重点关注哪个方向。只输出分析文字，不要输出JSON、不要输出标题，直接是一段话。`;
          existingAnalysis = String(await _llm(analysisPrompt) || '').trim();
        } catch (e) {
          log.error({ msg: 'existing_mode_analysis_failed', err: e?.message || String(e) });
        }
        const existingPayload = { ok: true, mode: 'existing', problem_key: existingKey, reason: parsed.reason || '', analysis: existingAnalysis };
        saveQueryHistory(req.tenantId, store, question, existingPayload, req.user?.username);
        return res.json(existingPayload);
      }
      // 自定义方案:补真实数据(指标现状+建议目标+责任人候选)
      // metric_key 为空或不在六大指标里,说明这个问题六大指标都套不上(比如服务态度类投诉，
      // 系统压根没采集这类数据)——之前这里会静默 fallback 到 'revenue'，导致方案挂着一个
      // 完全不相关的"近30天营业额"当作"现状数据"，看起来像是结合了真实数据、实际上文不对题。
      // 现在如实返回 metric_key=null，不编造一个不相关的指标现状。
      const rawMetricKey = String(parsed.metric_key || '').trim();
      const metricKey = PROBLEMS[rawMetricKey] ? rawMetricKey : null;
      const slug = 'custom:' + Date.now().toString(36);
      let current = null;
      let target = null;
      if (metricKey) {
        const endDate = ymd(new Date());
        const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
        current = await computeMetric(metricKey, store, startDate, endDate);
        target = nextTarget(metricKey, current.value, current.value, []);
      }
      const plan = [];
      for (const t of (Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 8) : [])) {
        const role = ROLE_POSITIONS[t.assignee_role] ? t.assignee_role : 'store_manager';
        const suggested = await suggestAssignees(store, role);
        plan.push({
          template_code: t.code || null, title: String(t.title || '').slice(0, 200),
          description: String(t.description || ''), phase: t.phase || '',
          why: String(t.why || '').trim(), acceptance_criteria: String(t.acceptance_criteria || '').trim(),
          assignee_role: role, suggested_assignees: suggested, default_assignee: suggested[0] || null,
        });
      }
      if (!plan.length) return res.status(502).json({ ok: false, error: 'AI 未生成有效任务,请换个描述重试' });

      // 真实数据证据(差评列表/员工快照)单独返回给前端展示，不管metric_key有没有匹配上——
      // 这是这次新接的两个真实数据源，跟六大指标的current/target是两套东西，分开传更清楚。
      const realDataEvidence = [];
      // hasRealData 只在真的查到内容时才算数——之前不管reviewsFetched里有没有真实差评，
      // 只要发起过查询就push进realDataEvidence(哪怕是"0条")，导致hasRealData永远是true，
      // general_advice(行业通用建议兜底)永远拿不到、被系统当成"已经有真实数据了"。
      // "0条"这个信息本身还是有用的(告诉用户"查过了，没有")，继续展示，但不能算作hasRealData。
      let hasFoundRealData = false;
      if (reviewsFetched) {
        realDataEvidence.push({
          label: '近30天真实差评/投诉', value: `${reviewsFetched.length} 条`,
          detail: reviewsFetched.slice(0, 10).map(r => `[${r.date}] ${r.reason}`),
        });
        if (reviewsFetched.length > 0) hasFoundRealData = true;
      }
      if (turnoverFetched) {
        realDataEvidence.push({
          label: '员工在职/离职快照(全量,非近30天新增)',
          value: `在职 ${turnoverFetched.active} 人 / 离职 ${turnoverFetched.left} 人 / 共建档 ${turnoverFetched.total} 人`,
        });
        if (turnoverFetched.total > 0) hasFoundRealData = true;
      }
      const hasRealData = hasFoundRealData || !!metricKey;
      const customPayload = {
        ok: true, mode: 'custom', problem_key: slug,
        title: String(parsed.title || '自定义方案').slice(0, 60),
        metric_key: metricKey, metric: metricKey ? PROBLEMS[metricKey].metric : null, unit: metricKey ? PROBLEMS[metricKey].unit : null,
        reason: parsed.reason || '',
        // analysis是这次输出的核心——之前只有一个笼统的general_advice字段，且只在完全没有
        // 真实数据时才要求LLM填，导致"有真实数据但AI只是复述数字"这种情况没人管——现在无论
        // 有没有真实数据，都强制要求这段150-300字、含现状判断+根因假设+任务关联的分析总结。
        analysis: String(parsed.analysis || '').trim(),
        priority_recommendation: String(parsed.priority_recommendation || '').trim(),
        out_of_scope: parsed.out_of_scope || (hasRealData ? '' : '系统六大标准指标及现有数据源均不适用于该问题，以下方案基于经营常识给出，无法结合门店真实数据验证现状。'),
        real_data_evidence: realDataEvidence,
        // capped 只有在真的有匹配指标、且 nextTarget 判定"已达阶梯上限"时才为true；
        // metricKey 为 null(六大指标都不适用)不等于"已封顶"，之前 target==null 一刀切
        // 导致这种情况被误判成"已达封顶🎉"，把AI生成的任务方案整个吞掉不显示，是个真bug。
        current, suggested_target: target, capped: metricKey ? target == null : false, plan,
      };
      saveQueryHistory(req.tenantId, store, question, customPayload, req.user?.username);
      res.json(customPayload);
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自定义问题分析历史列表:不用每次重新输入问题,可以直接从历史记录里点开之前的结果
}

function registerGrowthSolutionTaskViewRoutes(app, authRequired) {
app.get('/api/diagnosis/solutions/custom/history', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!store) return res.status(400).json({ ok: false, error: 'store 必填' });
      const tenantId = req.tenantId || 'default';
      const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));
      const r = await pool().query(
        `SELECT id, question, result_json->>'title' AS title, result_json->>'mode' AS mode, created_at
           FROM growth_custom_query_history
          WHERE tenant_id = $1 AND store = $2
          ORDER BY created_at DESC LIMIT $3`,
        [tenantId, store, limit]
      );
      res.json({ ok: true, history: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自定义方案里"进行中的任务/轮次"列表——之前一键下发之后没有任何入口能再找回来，
  // 用户点了下发看不到有没有成功、更看不到任务进度，这里补上。
  app.get('/api/diagnosis/solutions/custom/active-rounds', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!store) return res.status(400).json({ ok: false, error: 'store 必填' });
      const r = await pool().query(
        `SELECT id, problem_key, problem_title, status, round_no, started_at,
                (SELECT count(*) FROM growth_solution_tasks WHERE round_id = growth_solution_rounds.id) AS tasks_total,
                (SELECT count(*) FROM growth_solution_tasks WHERE round_id = growth_solution_rounds.id AND status = 'done') AS tasks_done
           FROM growth_solution_rounds
          WHERE store = $1 AND problem_key LIKE 'custom:%' AND status <> 'closed'
          ORDER BY started_at DESC LIMIT 20`,
        [store]
      );
      res.json({ ok: true, rounds: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 我的增长方案任务(六大标准问题+自定义问题共用一套growth_solution_tasks表)——
  // 之前分派完任务后责任人自己完全没有入口能看到"我有什么任务要做"，只能靠店长/管理员
  // 在诊断页里手动点"标记完成"，放在"我的档案"页面供员工自己更新执行进度。

  app.get('/api/diagnosis/solutions/my-tasks', authRequired, async (req, res) => {
    try {
      const username = req.user?.username;
      if (!username) return res.status(400).json({ ok: false, error: 'no username' });
      const r = await pool().query(
        `SELECT t.id AS task_id, t.round_id, t.title, t.description, t.phase, t.due_date, t.status,
                t.reminder_count, t.last_reminded_at, t.why, t.acceptance_criteria,
                r.store, r.problem_key, r.problem_title, r.round_no
           FROM growth_solution_tasks t
           JOIN growth_solution_rounds r ON r.id = t.round_id
          WHERE t.assignee_username = $1 AND t.status <> 'done' AND r.status = 'active'
          ORDER BY t.due_date ASC NULLS LAST, t.id ASC LIMIT 50`,
        [username]
      );
      res.json({ ok: true, tasks: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 管理层视图：下属任务与完成情况(不含已完成，只看还没做的+已完成统计)——
  // admin/hq_manager看全部门店，store_manager只看自己管辖门店的(allowed_stores/current_store，
  // authRequired里已经按用户角色算好挂在req.user上，这里直接复用，不用重新查一遍权限)。
  app.get('/api/diagnosis/solutions/team-tasks', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '');
      const managementRoles = ['admin', 'hq_manager', 'store_manager', 'front_manager', 'front_supervisor'];
      if (!managementRoles.includes(role)) return res.status(403).json({ ok: false, error: '仅管理层可查看' });
      const isFullAccess = role === 'admin' || role === 'hq_manager';
      const allowedStores = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const myStore = req.user?.current_store || req.user?.store || '';
      const storeFilter = isFullAccess ? [] : (allowedStores.length ? allowedStores : (myStore ? [myStore] : []));
      if (!isFullAccess && !storeFilter.length) return res.json({ ok: true, people: [] });

      const params = [];
      let whereStore = '';
      if (!isFullAccess) {
        params.push(storeFilter);
        whereStore = `AND r.store = ANY($${params.length})`;
      }
      const r = await pool().query(
        `SELECT t.id AS task_id, t.title, t.due_date, t.status, t.reminder_count, t.assignee_username, t.assignee_name,
                r.store, r.problem_title, r.round_no
           FROM growth_solution_tasks t
           JOIN growth_solution_rounds r ON r.id = t.round_id
          WHERE r.status = 'active' ${whereStore}
          ORDER BY t.assignee_name NULLS LAST, t.due_date ASC NULLS LAST`,
        params
      );
      const todayYmd = ymd(new Date());
      const byPerson = new Map();
      for (const t of r.rows) {
        const key = t.assignee_username || t.assignee_name || '未指定';
        if (!byPerson.has(key)) {
          byPerson.set(key, { assignee_username: t.assignee_username, assignee_name: t.assignee_name || t.assignee_username, total: 0, done: 0, overdue: 0, tasks: [] });
        }
        const p = byPerson.get(key);
        p.total += 1;
        if (t.status === 'done') p.done += 1;
        const isOverdue = t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < todayYmd;
        if (isOverdue) p.overdue += 1;
        if (t.status !== 'done') {
          p.tasks.push({
            task_id: t.task_id, title: t.title, due_date: t.due_date, store: t.store,
            problem_title: t.problem_title, round_no: t.round_no, reminder_count: t.reminder_count, overdue: isOverdue,
          });
        }
      }
      res.json({ ok: true, people: Array.from(byPerson.values()).sort((a, b) => b.overdue - a.overdue) });
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
        // openRound.metric_key 可能是null(没有对应六大指标的自定义问题,比如服务态度/员工流失)——
        // 之前这里 || 'revenue' 硬塞一个不相关的指标当兜底，会导致baseline/target显示成假的0元。
        const mk = openRound.metric_key || null;
        return res.json({
          ok: true, problem_key: key, title: openRound.problem_title, metric: openRound.metric_label,
          unit: openRound.unit, store, open_round: openRound, plan: null, history: [],
          current: { value: openRound.baseline_value != null ? Number(openRound.baseline_value) : null, detail: {} },
          suggested_target: openRound.target_value != null ? Number(openRound.target_value) : null,
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
}

function registerGrowthSolutionMutationRoutes(app, authRequired) {
  app.post('/api/diagnosis/solutions/:key/rounds', authRequired, async (req, res) => {
    try {
      const key = req.params.key;
      const { store, target_value, tasks } = req.body || {};
      const isCustom = key.startsWith('custom:');
      if (!isCustom && !PROBLEMS[key]) return res.status(404).json({ ok: false, error: 'unknown problem' });
      if (isCustom && !req.body?.custom_title) {
        return res.status(400).json({ ok: false, error: '自定义方案需提供 custom_title' });
      }
      if (!store) return res.status(400).json({ ok: false, error: 'store required' });
      if (!Array.isArray(tasks) || !tasks.length) return res.status(400).json({ ok: false, error: '任务清单为空' });
      const missing = tasks.filter((t) => !String(t.assignee_username || '').trim());
      if (missing.length) {
        return res.status(400).json({ ok: false, error: `有 ${missing.length} 项任务未指定责任人`, missing: missing.map((t) => t.title) });
      }
      const existing = await getOpenRound(store, key);
      if (existing) return res.status(409).json({ ok: false, error: `当前已有第${existing.round_no}轮进行中(${existing.status}),全部完成并复盘关闭前不能开新轮次` });

      // custom模式下metric_key可能是null(比如服务态度/员工流失这类六大指标都套不上的问题，
      // 前面分析阶段已经如实返回metric_key=null)——之前这里强制要求PROBLEMS[metric_key]有效，
      // 导致这类问题的任务方案永远无法下发(点了确认没反应，本质是400被吞掉没让用户看清)。
      // 现在允许metric_key为空：不追踪基线/目标这套指标阶梯，只是单纯把任务列表建成正式任务。
      const metricKey = isCustom ? (PROBLEMS[req.body?.metric_key] ? req.body.metric_key : null) : key;
      const probTitle = isCustom ? String(req.body.custom_title).slice(0, 60) : PROBLEMS[key].title;
      const closed = await getClosedRounds(store, key);
      let current = { value: null };
      let originBaseline = null;
      let target = null;
      if (metricKey) {
        const endDate = ymd(new Date());
        const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
        current = await computeMetric(metricKey, store, startDate, endDate);
        originBaseline = closed.length ? Number(closed[0].origin_baseline ?? closed[0].baseline_value) : current.value;
        const suggested = nextTarget(metricKey, current.value, originBaseline, closed);
        target = target_value != null ? Number(target_value) : suggested;
        if (target == null) return res.status(400).json({ ok: false, error: '该指标已达封顶,无需开新轮次' });
      }
      const roundNo = closed.length + 1;

      const ins = await pool().query(
        `INSERT INTO growth_solution_rounds
           (store, problem_key, problem_title, round_no, metric_label, metric_key, unit,
            baseline_value, origin_baseline, target_value, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING id`,
        [store, key, probTitle, roundNo, metricKey ? PROBLEMS[metricKey].metric : probTitle, metricKey, metricKey ? PROBLEMS[metricKey].unit : null,
         current.value, originBaseline, target, req.user?.username || '']
      );
      const roundId = ins.rows[0].id;
      let sort = 0;
      for (const t of tasks) {
        sort += 1;
        await pool().query(
          `INSERT INTO growth_solution_tasks
             (round_id, template_code, title, description, assignee_username, assignee_name, due_date, phase, sort, why, acceptance_criteria)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [roundId, t.template_code || null, t.title, t.description || '', t.assignee_username,
           t.assignee_name || '', t.due_date || null, t.phase || '', sort, t.why || null, t.acceptance_criteria || null]
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
      const notifyMetricPart = metricKey ? `基线 ${current.value}${PROBLEMS[metricKey].unit} → 目标 ${target}${PROBLEMS[metricKey].unit}` : '无对应量化指标,按任务清单跟踪';
      await notify(`【增长方案·下发】${store}「${probTitle}」第${roundNo}轮启动:${notifyMetricPart},共 ${tasks.length} 项任务已指定责任人。`);
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

  // 手动提醒任务责任人：派发人自己点，跟系统每日自动催促(runSolutionSweep)是两条独立限流线，
  // 这里限制"每个任务1小时内最多提醒1次"防误触，跟自动催促共用同一套reminder_count/
  // last_reminded_at字段(数字本身不区分是系统催的还是人催的，对责任人来说都是"被提醒了")。
  app.post('/api/diagnosis/solutions/tasks/:taskId/remind', authRequired, async (req, res) => {
    try {
      const { taskId } = req.params;
      const check = await pool().query(
        `SELECT t.id, t.title, t.assignee_name, t.assignee_username, t.status, t.last_reminded_at, r.store, r.problem_title
           FROM growth_solution_tasks t JOIN growth_solution_rounds r ON r.id = t.round_id
          WHERE t.id = $1`,
        [taskId]
      );
      if (!check.rows.length) return res.status(404).json({ ok: false, error: '任务不存在' });
      const task = check.rows[0];
      if (task.status === 'done') return res.status(400).json({ ok: false, error: '该任务已完成，无需提醒' });
      if (task.last_reminded_at && (Date.now() - new Date(task.last_reminded_at).getTime()) < 3600 * 1000) {
        const waitMin = Math.ceil((3600 * 1000 - (Date.now() - new Date(task.last_reminded_at).getTime())) / 60000);
        return res.status(429).json({ ok: false, error: `1小时内只能提醒1次，还需等待约${waitMin}分钟` });
      }
      const r = await pool().query(
        `UPDATE growth_solution_tasks SET reminder_count = reminder_count + 1, last_reminded_at = NOW()
         WHERE id = $1 RETURNING reminder_count`,
        [taskId]
      );
      await notify(`【增长方案·提醒】${task.store}「${task.problem_title}」任务「${task.title}」责任人 ${task.assignee_name || task.assignee_username} 被提醒，第 ${r.rows[0].reminder_count} 次。`);
      res.json({ ok: true, reminder_count: r.rows[0].reminder_count });
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

export function registerGrowthSolutionRoutes(app, authRequired) {
  registerGrowthSolutionOverviewRoutes(app, authRequired);
  registerGrowthSolutionCustomRoutes(app, authRequired);
  registerGrowthSolutionTaskViewRoutes(app, authRequired);
  registerGrowthSolutionMutationRoutes(app, authRequired);
}


function summarizeCard(key, current) {
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
