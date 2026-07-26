/**
 * 门店经营诊断模块
 * 
 * 从结果（营业额下降/差评增加/离职增加）出发，
 * 做贡献度分析→根因关联→输出个人级建议
 */
import jwt from 'jsonwebtoken';
import { fetchDineMetrics, storeNameToId } from './utils/dine-metrics.js';
import { runOperationDiagnosisAgent, generateOperationDiagnosisTasks } from './agents/operation-diagnosis-agent.js';
import { childLogger } from './utils/logger.js';
import {
  aggregateCategories,
  buildCustomerSection,
  buildDiagnosisSummary,
  buildRevenueContributions,
  buildRevenueMetrics,
  buildStaffingSection,
  buildTrainingSection,
  groupAnomalyRows,
  supplementAnomalies,
} from './domains/store-diagnosis/diagnosis-helpers.js';
import { loadStoreDiagnosisData } from './domains/store-diagnosis/load-diagnosis-data.js';

const log = childLogger({ domain: 'store-diagnosis' });

/**
 * agents-service-v2 的 ontology-client.js 用 PLATFORM_ADMIN_JWT_SECRET 签发服务token调这两个
 * 接口（payload.platformAdmin='ontology_agent'），跟前端登录用户走的 authRequired(JWT_SECRET)
 * 不是同一把密钥——这里做一个宽松的二选一：先按服务token验，不通过再走正常的 authRequired，
 * 不改 authRequired 本身（那是全局共用的重逻辑，不该为了一个服务身份牵动它）。
 */
function verifyServiceToken(req) {
  const hdr = String(req.headers.authorization || '');
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!token) return null;
  const secret = String(process.env.PLATFORM_ADMIN_JWT_SECRET || process.env.JWT_SECRET || '').trim();
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret);
    return payload?.platformAdmin ? payload : null;
  } catch (e) {
    return null;
  }
}

function makeAuthRequiredOrServiceToken(authRequired) {
  return async function authRequiredOrServiceToken(req, res, next) {
    const svc = verifyServiceToken(req);
    if (svc) {
      req.tenantId = String(svc.tenantId || 'default').trim() || 'default';
      req.serviceAgent = svc.username || svc.platformAdmin;
      return next();
    }
    return authRequired(req, res, next);
  };
}

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const normalizeStore = s => String(s || '').trim();

async function fetchCustomerNewReturning(pool, storeName, startDate, endDate) {
  const storeId = storeNameToId(storeName);
  if (!storeId) return { new_customers: 0, returning_customers: 0, total_customers: 0, new_pct: 0, returning_pct: 0 };
  const nvrR = await pool.query(`
    WITH customer_window AS (
      SELECT phone, COUNT(*)::int AS order_cnt
      FROM pos_orders
      WHERE phone IS NOT NULL AND phone <> '' AND store_id = $1
        AND biz_date >= $2 AND biz_date <= $3
      GROUP BY phone
    ), customer_life AS (
      SELECT cw.phone, MIN(po.biz_date) AS lifetime_first_order_date
      FROM customer_window cw
      JOIN pos_orders po ON po.phone = cw.phone AND po.phone IS NOT NULL AND po.phone <> ''
        AND po.store_id = $1
      GROUP BY cw.phone
    )
    SELECT
      COUNT(*) FILTER (WHERE lifetime_first_order_date >= $2::date)::int AS new_customers,
      COUNT(*) FILTER (WHERE lifetime_first_order_date < $2::date)::int AS returning_customers,
      COUNT(*)::int AS total_customers
    FROM customer_life
  `, [storeId, startDate, endDate]);
  const nvr = nvrR.rows[0] || {};
  const totalCustomers = Number(nvr.total_customers || 0);
  const newCount = Number(nvr.new_customers || 0);
  return {
    new_customers: newCount,
    returning_customers: Number(nvr.returning_customers || 0),
    total_customers: totalCustomers,
    new_pct: totalCustomers > 0 ? Math.round((newCount / totalCustomers) * 1000) / 10 : 0,
    returning_pct: totalCustomers > 0 ? Math.round((Number(nvr.returning_customers || 0) / totalCustomers) * 1000) / 10 : 0,
  };
}

function inferActionSource(actionType, createdBy) {
  const t = String(actionType || '').toLowerCase();
  const c = String(createdBy || '').toLowerCase();
  if (t === 'pllm_task' || c.includes('pllm')) return 'PLLM';
  if (t === 'ai_suggestion' || t.includes('ai') || c.includes('ai')) return 'AI';
  return '规则建议';
}

async function loadActionSuggestions(pool, storeName, startDate, endDate) {
  const conditions = [];
  const params = [];
  let idx = 1;
  conditions.push(`created_at::date >= $${idx++}`);
  params.push(startDate);
  conditions.push(`created_at::date <= $${idx++}`);
  params.push(endDate);
  if (storeName) {
    conditions.push(`(
      store_id ILIKE $${idx}
      OR title ILIKE $${idx}
      OR detail ILIKE $${idx}
      OR payload::text ILIKE $${idx}
    )`);
    params.push(`%${storeName}%`);
    idx += 1;
  }
  conditions.push(`action_type IN ('pllm_task', 'ai_suggestion', 'manual_campaign', 'campaign_activate', 'send_voucher', 'create_content', 'promo_task')`);
  conditions.push(`status IN ('proposed', 'pending', 'active', 'executed')`);

  const r = await pool.query(
    `SELECT action_key, action_type, status, store_id, title, detail, payload, created_by, created_at, executed_at
     FROM growth_actions
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 8`,
    params
  );

  return (r.rows || []).map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const source = inferActionSource(row.action_type, row.created_by);
    const priority = /high|urgent|critical/.test(String(row.status || '').toLowerCase()) ? 'high' : 'medium';
    return {
      action_key: row.action_key,
      source,
      action_type: row.action_type,
      status: row.status,
      title: cleanText(row.title || payload.title || 'AI建议行动', 120),
      detail: cleanText(row.detail || payload.description || payload.note || '', 360),
      created_at: row.created_at,
      executed_at: row.executed_at,
      priority,
      target_metric: cleanText(payload.target_metric || '', 80),
      target_value: payload.target_value != null ? payload.target_value : null,
      budget_amount: payload.budget_amount != null ? payload.budget_amount : null,
      duration_days: payload.duration_days != null ? payload.duration_days : null,
      actions: Array.isArray(payload.actions) ? payload.actions : [],
    };
  });
}

/**
 * 获取门店诊断结果
 * 数据源：anomaly_triggers + daily_reports + pos_orders + employees + training
 */
export async function getStoreDiagnosis(pool, store, dateRange) {
  const storeName = normalizeStore(store);
  const endDate = dateRange?.end || new Date().toISOString().slice(0, 10);
  const startDate = dateRange?.start || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const data = await loadStoreDiagnosisData(pool, storeName, startDate, endDate);

  const result = {
    store: storeName,
    period: { start: startDate, end: endDate },
    summary: {},
    revenue: {},
    customer: {},
    anomalies: [],
    staffing: {},
    training: {},
    recommendations: [],
  };

  const [dineMetrics, customerMetrics] = await Promise.all([
    fetchDineMetrics(pool, storeName, startDate, endDate),
    fetchCustomerNewReturning(pool, storeName, startDate, endDate),
  ]);
  const [prevDineMetrics, prevCustomerMetrics] = await Promise.all([
    fetchDineMetrics(pool, storeName, data.weekAgoStart, data.weekAgoEnd),
    fetchCustomerNewReturning(pool, storeName, data.weekAgoStart, data.weekAgoEnd),
  ]);

  const revenueBuilt = buildRevenueMetrics({
    reportRows: data.reports,
    prevReportRows: data.prevReports,
    dineMetrics,
    prevDineMetrics,
  });

  if (revenueBuilt) {
    const contrib = buildRevenueContributions({
      metrics: revenueBuilt.metrics,
      reportRows: data.reports,
      prevReportRows: data.prevReports,
      tableVisitCurrent: data.tableVisitCurrent,
      tableVisitPrev: data.tableVisitPrev,
      topDissatisfiedDish: data.topDissatisfiedDish,
      memberRevenueCurrent: data.memberRevenueCurrent,
      memberRevenuePrev: data.memberRevenuePrev,
    });
    result.revenue = {
      ...revenueBuilt.revenue,
      contributions: contrib.contributions,
    };
    if (contrib.deliveryShareChangePct != null) {
      result.revenue.delivery_share_change_pct = contrib.deliveryShareChangePct;
    }
    if (contrib.ratingChangePct != null) {
      result.revenue.rating_change_pct = contrib.ratingChangePct;
    }
    if (contrib.avgRating != null) {
      result.revenue.avg_rating = contrib.avgRating;
    }
    if (contrib.tableVisit) {
      result.revenue.table_visit = contrib.tableVisit;
    }
    if (contrib.memberRevenueRatio != null) {
      result.revenue.member_revenue_ratio = contrib.memberRevenueRatio;
      result.revenue.prev_member_revenue_ratio = contrib.prevMemberRevenueRatio;
    }
  }

  const customerBuilt = buildCustomerSection({
    dineTraffic: dineMetrics.dine_traffic,
    customerMetrics,
    prevCustomerMetrics,
    customerAnalysisRows: data.customerAnalysis,
    existingContributions: result.revenue.contributions || [],
  });
  result.customer = customerBuilt.customer;
  if (customerBuilt.contributions.length) {
    result.revenue.contributions = customerBuilt.contributions;
  }

  result.anomalies = supplementAnomalies({
    anomalies: groupAnomalyRows(data.anomalies),
    revenue: result.revenue,
    reportRows: data.reports,
    endDate,
  });

  result.staffing = buildStaffingSection({ reportRows: data.reports, revenue: result.revenue });

  result.training = buildTrainingSection({
    trainingRows: data.trainingStatus,
    employeeRows: data.employees,
    endDate,
  });

  if (data.reports.length > 0) {
    const categories = aggregateCategories(data.reports, Number(result.revenue.total || 0));
    if (categories.length) result.revenue.categories = categories;
  }

  result.recommendations = await generateRecommendations({
    store: storeName,
    revenue: result.revenue,
    customer: result.customer,
    anomalies: result.anomalies,
    staffing: result.staffing,
    training: result.training,
    employees: data.employees,
    reports: data.reports,
  });

  result.action_suggestions = await loadActionSuggestions(pool, storeName, startDate, endDate).catch(() => []);
  result.action_suggestions_count = result.action_suggestions.length;

  result.summary = buildDiagnosisSummary(result);

  return result;
}

async function generateRecommendations(ctx) {
  const recs = [];
  const { store, revenue, customer, anomalies, staffing, training, employees, reports } = ctx;

  // 1. 营业额下降 + 客流下降 → 新客引流建议
  if (revenue.is_decline && Number(revenue.change_pct) < -5) {
    for (const c of (revenue.contributions || [])) {
      if (c.factor === '客流量下降') {
        recs.push({
          type: 'marketing',
          source: 'rule_engine',
          priority: 'high',
          title: '加强新客引流',
          detail: `客流量下降${c.impact}，建议增加私域引流活动（扫码领券、社群裂变）`,
          target: '店长',
          related_anomaly: 'revenue_achievement',
        });
      }
    }
  }

  // 2. 人效下降 → 排班优化建议
  if (Number(revenue.efficiency_change_pct) < -10) {
    const underDuty = (staffing.total_on_duty || 0);
    recs.push({
      type: 'staffing',
      source: 'rule_engine',
      priority: 'medium',
      title: '优化排班结构',
      detail: `人效下降${Math.abs(revenue.efficiency_change_pct)}%，当前在岗${underDuty}人。建议核对排班与客流高峰时段是否匹配`,
      target: '店长',
      related_anomaly: 'labor_efficiency',
    });
  }

  // 3. 晚班人手不足 → 补充排班
  if (staffing.issues && staffing.issues.length > 0) {
    for (const issue of staffing.issues) {
      if (issue.includes('晚班')) {
        recs.push({
          type: 'staffing',
          source: 'rule_engine',
          priority: 'high',
          title: '增加晚班前厅人手',
          detail: issue,
          target: '店长',
        });
      }
    }
  }

  // 4. 差评 → 定位到个人 → 培训建议（核心）
  const badAnomalies = anomalies.filter(a =>
    a.key === 'bad_review_service' || a.key === 'bad_review_product'
  );

  if (badAnomalies.length > 0 && reports.length > 0) {
    // 获取差评发生当天的在岗员工
    for (const anomaly of badAnomalies) {
      const anomalyDate = anomaly.latest_date;
      const anomalyDateStr = anomalyDate instanceof Date ? anomalyDate.toISOString().slice(0, 10) : String(anomalyDate).slice(0, 10);
      const reportForDate = reports.find(r => {
        const rDateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
        return rDateStr === anomalyDateStr;
      });
      if (!reportForDate || !reportForDate.staff) continue;

      const staff = reportForDate.staff;
      const onDutyNames = [];
      for (const [area, people] of Object.entries(staff)) {
        if (Array.isArray(people)) {
          for (const p of people) {
            if (p.name && p.name !== '休息') {
              onDutyNames.push({ name: p.name, user: p.user, area });
            }
          }
        }
      }

      // 按异常类型筛选相关岗位的在岗员工
      // 产品差评→厨房人员，服务差评→前厅人员
      const relevantAreas = anomaly.key === 'bad_review_product'
        ? new Set(['kitchen', 'kitchen_area', 'restStaff', 'kitchenSupport', '后厨', '出品', '烧味', '点心', '打荷', '上什'])
        : new Set(['front', 'frontSupport', 'frontRestStaff', '前厅', 'service']);
      const relevantStaff = onDutyNames.filter(s => relevantAreas.has(s.area));

      // 匹配培训主题
      let topicTitle = '';
      let topicTarget = '';
      if (anomaly.key === 'bad_review_service') {
        topicTitle = '客诉处置实操认证';
        topicTarget = '前厅';
      } else if (anomaly.key === 'bad_review_product') {
        topicTarget = '厨房';
        if (store.includes('马己仙')) {
          topicTitle = '烧鸭';
        } else if (store.includes('洪潮')) {
          topicTitle = '油温控制';
        }
      }

      // 生成个人级建议
      if (relevantStaff.length > 0) {
        // 找出未完成相关培训的在岗员工
        const untrainedStaff = relevantStaff.filter(s => {
          if (!s.user) return false;
          const empTraining = training.by_employee?.find(t => t.username === s.user);
          if (!empTraining) return true;
          return empTraining.missing_certs.includes(topicTitle);
        });

        if (untrainedStaff.length > 0) {
          const names = untrainedStaff.slice(0, 5).map(s => s.name).join('、');
          const more = untrainedStaff.length > 5 ? `等${untrainedStaff.length}名${topicTarget}人员` : '';
          recs.push({
            type: 'training',
            source: 'rule_engine',
            priority: 'high',
            title: `建议给${names}${more}补《${topicTitle}》培训`,
            detail: `${anomalyDate}出现${anomaly.type}（${anomaly.detail || ''}），上述${topicTarget}人员当天在岗且未完成《${topicTitle}》认证`,
            target: topicTarget,
            target_users: untrainedStaff.map(s => s.user),
            topic_title: topicTitle,
            related_anomaly: anomaly.key,
          });
        } else {
          const names = relevantStaff.slice(0, 3).map(s => s.name).join('、');
          recs.push({
            type: 'training',
            source: 'rule_engine',
            priority: 'medium',
            title: `建议复核${names}等${topicTarget}人员的SOP执行`,
            detail: `${anomalyDate}出现${anomaly.type}，${topicTarget}人员当天在岗且已有培训认证，建议复核实际执行情况`,
            target: topicTarget,
            target_users: relevantStaff.map(s => s.user),
            related_anomaly: anomaly.key,
          });
        }
      }
    }
  }

  // 5. 新客占比低/下降 → 会员营销技巧培训
  const newRatioDeclined = Number(customer.new_ratio_change_pct) <= -10;
  const newRatioLow = customer.new_ratio > 0 && customer.new_ratio < 20;
  if (newRatioDeclined || newRatioLow) {
    // 找店长
    const manager = employees.find(e =>
      e.position?.includes('店长') || e.position?.includes('manager')
    );
    const managerName = manager?.name || '店长';
    const reasonDetail = newRatioDeclined
      ? `新客占比从${customer.prev_new_ratio}%降至${customer.new_ratio}%（环比下降${Math.abs(customer.new_ratio_change_pct)}%）`
      : `新客占比仅${customer.new_ratio}%，低于行业基准20%`;
    recs.push({
      type: 'training',
      source: 'rule_engine',
      priority: 'high',
      title: `建议给${managerName}补《会员营销技巧》培训`,
      detail: `${reasonDetail}。建议通过《会员营销技巧》培训提升门店获客与会员转化能力`,
      target: managerName,
      target_users: manager ? [manager.username] : [],
      topic_title: '会员营销技巧',
    });
  }

  // 5b. 到店转化率下降 → 前厅收银引导培训
  const convContribution = (revenue.contributions || []).find(c => c.factor === '到店转化率下降');
  if (convContribution && reports.length > 0) {
    const latestStaff = reports[0].staff || {};
    const frontNames = [];
    for (const area of ['front', 'frontRestStaff']) {
      for (const p of (latestStaff[area] || [])) {
        if (p.name && p.user) frontNames.push({ name: p.name, user: p.user });
      }
    }
    if (frontNames.length > 0) {
      const names = frontNames.slice(0, 5).map(s => s.name).join('、');
      recs.push({
        type: 'training',
        source: 'rule_engine',
        priority: 'medium',
        title: `建议给${names}补《收银引导与点单话术》培训`,
        detail: `${convContribution.detail}，当前在岗前厅人员建议加强收银转化话术训练`,
        target: '前厅',
        target_users: frontNames.map(s => s.user),
        topic_title: '收银引导与点单话术',
        related_anomaly: null,
      });
    }
  }

  // 6. 无充值记录 → 储值推广建议
  const rechargeAnomaly = anomalies.find(a => a.key === 'recharge_zero');
  if (rechargeAnomaly) {
    recs.push({
      type: 'marketing',
      source: 'rule_engine',
      priority: 'high',
      title: '启动储值卡推广活动',
      detail: `连续多日无会员充值记录，建议推出储值优惠（充500送50）并培训前厅话术`,
      target: '店长',
      related_anomaly: 'recharge_zero',
    });
  }

  // 7. 趋势下降 → 结构性建议
  const trendAnomaly = anomalies.find(a => a.key === 'weekday_trend');
  if (trendAnomaly && trendAnomaly.detail) {
    recs.push({
      type: 'strategy',
      source: 'rule_engine',
      priority: 'high',
      title: '周同比持续下降需结构性调整',
      detail: trendAnomaly.detail,
      target: '店长',
      related_anomaly: 'weekday_trend',
    });
  }

  // 8. 新员工未培训
  const newEmployees = (training.employees_without_training || []).filter(e => e.is_new);
  if (newEmployees.length > 0) {
    const names = newEmployees.map(e => e.name).join('、');
    recs.push({
      type: 'training',
      source: 'rule_engine',
      priority: 'medium',
      title: `新员工${names}尚未完成入职培训`,
      detail: `${names}入职未满90天且无培训记录，建议立即安排入职SOP培训`,
      target: names,
      target_users: newEmployees.map(e => e.username),
      topic_title: '新员工入职SOP',
    });
  }

  return recs;
}

/**
 * 获取所有门店的诊断概览
 */
export async function getAllStoresDiagnosis(pool, dateRange) {
  const endDate = dateRange?.end || new Date().toISOString().slice(0, 10);
  const startDate = dateRange?.start || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const stores = await pool.query(
    `SELECT DISTINCT store FROM daily_reports WHERE date >= $1 AND date <= $2 AND store IS NOT NULL AND store <> '' ORDER BY store`,
    [startDate, endDate]
  );

  const results = [];
  for (const s of stores.rows) {
    try {
      const diag = await getStoreDiagnosis(pool, s.store, dateRange);
      results.push({
        store: s.store,
        summary: diag.summary,
        revenue: {
          total: diag.revenue.total,
          total_pre_discount_revenue: diag.revenue.total_pre_discount_revenue,
          avg_order_value: diag.revenue.avg_order_value,
          avg_table_spend: diag.revenue.avg_table_spend,
          avg_spend_per_person: diag.revenue.avg_spend_per_person,
          avg_daily_traffic: diag.revenue.avg_daily_traffic,
          total_traffic: diag.revenue.total_traffic,
          report_days: diag.revenue.report_days,
          avg_efficiency: diag.revenue.avg_efficiency,
          total_delivery_revenue: diag.revenue.total_delivery_revenue,
          delivery_share_pct: diag.revenue.delivery_share_pct,
          change_pct: diag.revenue.change_pct,
          is_decline: diag.revenue.is_decline,
          contributions: diag.revenue.contributions,
        },
        anomalies: diag.anomalies.map(a => ({ type: a.type, severity: a.severity, count: a.count })),
        recommendations: [
          ...diag.recommendations.map(r => ({ type: r.type, title: r.title, priority: r.priority, source: r.source || 'rule_engine', detail: r.detail })),
          ...(diag.action_suggestions || []).map(a => ({ type: a.action_type || 'pllm_task', title: a.title, priority: a.priority || 'medium', source: a.source || 'AI', detail: a.detail }))
        ].slice(0, 8),
        action_suggestion_count: diag.action_suggestions?.length || 0,
      });
    } catch (e) {
      log.error({ msg: 'store_diagnosis_failed', store: s.store, err: e?.message || String(e) });
    }
  }
  return results;
}

/**
 * 注册诊断路由
 */
export function registerDiagnosisRoutes(app, pool, authRequired, callLLM = null) {
  const authRequiredOrServiceToken = makeAuthRequiredOrServiceToken(authRequired);
  app.get('/api/diagnosis/store/:store', authRequired, async (req, res) => {
    try {
      const store = cleanText(req.params.store, 128);
      if (!store) return res.status(400).json({ ok: false, error: 'store_required' });
      const dateRange = {};
      if (req.query.start) dateRange.start = cleanText(req.query.start, 10);
      if (req.query.end) dateRange.end = cleanText(req.query.end, 10);
      const result = await getStoreDiagnosis(pool, store, dateRange);
      return res.json({ ok: true, diagnosis: result });
    } catch (e) {
      log.error({ msg: 'store_diagnosis_route_error', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/diagnosis/overview', authRequired, async (req, res) => {
    try {
      const dateRange = {};
      if (req.query.start) dateRange.start = cleanText(req.query.start, 10);
      if (req.query.end) dateRange.end = cleanText(req.query.end, 10);
      const result = await getAllStoresDiagnosis(pool, dateRange);
      return res.json({ ok: true, stores: result });
    } catch (e) {
      log.error({ msg: 'diagnosis_overview_error', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ai/operation-diagnosis', authRequiredOrServiceToken, async (req, res) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenant_id || req.query?.tenant_id || req.query?.tenantId || 'default').trim() || 'default';
      const storeId = String(req.query?.store_id || req.query?.storeId || '').trim();
      const storeName = String(req.query?.store_name || req.query?.storeName || '').trim();
      const date = req.query?.date || new Date().toISOString().slice(0, 10);
      const result = await runOperationDiagnosisAgent(pool, { tenantId, storeId, storeName, date }, callLLM);
      return res.json({ ok: true, ...result });
    } catch (e) {
      log.error({ msg: 'operation_diagnosis_error', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ai/operation-diagnosis/generate-tasks', authRequiredOrServiceToken, async (req, res) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenant_id || req.body?.tenant_id || req.body?.tenantId || 'default').trim() || 'default';
      const storeId = String(req.body?.store_id || req.body?.storeId || '').trim();
      const ownerUserId = String(req.body?.owner_user_id || req.body?.ownerUserId || req.user?.username || '').trim();
      const opportunityId = String(req.body?.opportunity_id || req.body?.opportunityId || req.params?.opportunityId || '').trim();
      if (!opportunityId) return res.status(400).json({ ok: false, error: 'opportunity_id_required' });
      const result = await generateOperationDiagnosisTasks(pool, { tenantId, storeId, opportunityId, ownerUserId });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ok: true, ...result });
    } catch (e) {
      log.error({ msg: 'operation_diagnosis_tasks_error', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
