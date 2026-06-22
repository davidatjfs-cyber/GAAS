/**
 * 门店经营诊断模块
 * 
 * 从结果（营业额下降/差评增加/离职增加）出发，
 * 做贡献度分析→根因关联→输出个人级建议
 */
function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const normalizeStore = s => String(s || '').trim();

/**
 * 获取门店诊断结果
 * 数据源：anomaly_triggers + daily_reports + pos_orders + employees + training
 */
export async function getStoreDiagnosis(pool, store, dateRange) {
  const storeName = normalizeStore(store);
  const endDate = dateRange?.end || new Date().toISOString().slice(0, 10);
  const startDate = dateRange?.start || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // 1. 拉取该门店最近异常
  const anomalies = await pool.query(
    `SELECT anomaly_key, severity, status, trigger_date, trigger_value, threshold_value,
            assigned_role, updated_at
     FROM anomaly_triggers
     WHERE store = $1 AND trigger_date >= $2 AND trigger_date <= $3
     ORDER BY trigger_date DESC, severity DESC`,
    [storeName, startDate, endDate]
  );

  // 2. 拉取该门店日报数据（含staff/segments/categories）
  const reports = await pool.query(
    `SELECT date, store, actual_revenue, budget_rate, dine_traffic, dine_orders,
            delivery_actual, efficiency, pre_discount_revenue, recharge_count,
            segments, categories, delivery_detail, staff, schedule_next_day,
            bad_reviews_dianping
     FROM daily_reports
     WHERE store = $1 AND date >= $2 AND date <= $3
     ORDER BY date DESC`,
    [storeName, startDate, endDate]
  );

  // 3. 周对比（上周同天 vs 本周同天）
  const weekAgoStart = new Date(new Date(startDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const prevReports = await pool.query(
    `SELECT date, actual_revenue, dine_traffic, dine_orders, efficiency
     FROM daily_reports
     WHERE store = $1 AND date >= $2 AND date <= $3
     ORDER BY date DESC`,
    [storeName, weekAgoStart, new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10)]
  );

  // 4. 新客 vs 老客分析（通过 pos_orders）
  const customerAnalysis = await pool.query(
    `WITH orders AS (
       SELECT o.biz_date, o.order_no, o.phone, o.customer_id,
              CASE WHEN gc.first_seen_at::date = o.biz_date THEN 'new' ELSE 'returning' END AS customer_type
       FROM pos_orders o
       LEFT JOIN growth_customers gc ON o.customer_id = gc.id
       WHERE o.store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
         AND o.biz_date >= $2 AND o.biz_date <= $3
     )
     SELECT biz_date,
            COUNT(*) FILTER (WHERE customer_type = 'new') AS new_customers,
            COUNT(*) FILTER (WHERE customer_type = 'returning') AS returning_customers,
            COUNT(*) AS total_orders
     FROM orders
     GROUP BY biz_date ORDER BY biz_date`,
    [storeName, startDate, endDate]
  );

  // 5. 获取员工列表
  const employees = await pool.query(
    `SELECT username, name, store, position, status, join_date,
            extra_json
     FROM employees
     WHERE store ILIKE '%' || $1 || '%' OR $1 = ''
     ORDER BY position, name`,
    [storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName)]
  );

  // 6. 培训完成状态
  const trainingStatus = await pool.query(
    `SELECT ta.employee_username, ta.topic_id, ta.source AS assignment_status,
            tt.title AS topic_title, tt.position AS topic_position,
            tc.status AS cert_status
     FROM training_assignments ta
     LEFT JOIN training_topics tt ON ta.topic_id = tt.id
     LEFT JOIN training_certifications tc ON ta.employee_username = tc.employee_username AND ta.topic_id = tc.topic_id
     WHERE ta.employee_username = ANY(
       SELECT e.username FROM employees e WHERE e.store ILIKE '%' || $1 || '%'
     )`,
    [storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName)]
  );

  // === 开始组装诊断结果 ===

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

  // ── A. 营业额分析 ──
  if (reports.rows.length > 0) {
    const totalRevenue = reports.rows.reduce((s, r) => s + Number(r.actual_revenue || 0), 0);
    const avgDailyRevenue = totalRevenue / reports.rows.length;
    const totalTraffic = reports.rows.reduce((s, r) => s + Number(r.dine_traffic || 0), 0);
    const avgDailyTraffic = totalTraffic / reports.rows.length;
    const totalOrders = reports.rows.reduce((s, r) => s + Number(r.dine_orders || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgEfficiency = reports.rows.reduce((s, r) => s + Number(r.efficiency || 0), 0) / reports.rows.length;

    let prevTotalRevenue = 0, prevTotalTraffic = 0, prevTotalOrders = 0, prevAvgEfficiency = 0;
    if (prevReports.rows.length > 0) {
      prevTotalRevenue = prevReports.rows.reduce((s, r) => s + Number(r.actual_revenue || 0), 0);
      prevTotalTraffic = prevReports.rows.reduce((s, r) => s + Number(r.dine_traffic || 0), 0);
      prevTotalOrders = prevReports.rows.reduce((s, r) => s + Number(r.dine_orders || 0), 0);
      prevAvgEfficiency = prevReports.rows.reduce((s, r) => s + Number(r.efficiency || 0), 0) / prevReports.rows.length;
    }

    const revenueChange = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue * 100).toFixed(1) : 0;
    const trafficChange = prevTotalTraffic > 0 ? ((totalTraffic - prevTotalTraffic) / prevTotalTraffic * 100).toFixed(1) : 0;
    const ordersChange = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : 0;
    const efficiencyChange = prevAvgEfficiency > 0 ? ((avgEfficiency - prevAvgEfficiency) / prevAvgEfficiency * 100).toFixed(1) : 0;

    result.revenue = {
      total: Math.round(totalRevenue),
      avg_daily: Math.round(avgDailyRevenue),
      avg_order_value: Math.round(avgOrderValue),
      avg_efficiency: Math.round(avgEfficiency),
      prev_total: Math.round(prevTotalRevenue),
      change_pct: Number(revenueChange),
      traffic_change_pct: Number(trafficChange),
      orders_change_pct: Number(ordersChange),
      efficiency_change_pct: Number(efficiencyChange),
      is_decline: Number(revenueChange) < 0,
    };

    // ── B. 贡献度分析 ──
    const contributions = [];
    if (Number(trafficChange) < 0) {
      contributions.push({
        factor: '客流下降',
        impact: `${Math.abs(trafficChange)}%`,
        detail: `到店客流从${prevTotalTraffic}降至${totalTraffic}，减少${prevTotalTraffic - totalTraffic}人次`,
      });
    }
    if (Number(ordersChange) < 0) {
      contributions.push({
        factor: '订单量下降',
        impact: `${Math.abs(ordersChange)}%`,
        detail: `日均订单从${Math.round(prevTotalOrders / (prevReports.rows.length || 1))}降至${Math.round(totalOrders / reports.rows.length)}`,
      });
    }
    if (Number(efficiencyChange) < 0) {
      contributions.push({
        factor: '人效下降',
        impact: `${Math.abs(efficiencyChange)}%`,
        detail: `人效从${Math.round(prevAvgEfficiency)}元/人降至${Math.round(avgEfficiency)}元/人`,
      });
    }
    if (Number(revenueChange) < 0 && Number(trafficChange) >= 0) {
      contributions.push({
        factor: '客单价下降',
        impact: `${Math.abs(revenueChange)}%`,
        detail: `营收下降但客流未降，可能是折扣加大或菜品结构变化`,
      });
    }

    result.revenue.contributions = contributions;
  }

  // ── C. 新客 vs 老客分析 ──
  if (customerAnalysis.rows.length > 0) {
    let totalNew = 0, totalReturning = 0, totalOrders = 0;
    for (const r of customerAnalysis.rows) {
      totalNew += Number(r.new_customers || 0);
      totalReturning += Number(r.returning_customers || 0);
      totalOrders += Number(r.total_orders || 0);
    }
    const newRatio = totalOrders > 0 ? (totalNew / totalOrders * 100).toFixed(1) : 0;

    result.customer = {
      new_customers: totalNew,
      returning_customers: totalReturning,
      total_orders: totalOrders,
      new_ratio: Number(newRatio),
      daily: customerAnalysis.rows.map(r => ({
        date: r.biz_date,
        new: Number(r.new_customers || 0),
        returning: Number(r.returning_customers || 0),
        total: Number(r.total_orders || 0),
      })),
    };

    if (Number(newRatio) < 20) {
      result.revenue.contributions = result.revenue.contributions || [];
      result.revenue.contributions.push({
        factor: '新客占比低',
        impact: `${newRatio}%`,
        detail: `本周新客比例仅${newRatio}%，可能私域引流不足或门店获客能力下降`,
      });
    }
  }

  // ── D. 异常分析 ──
  const anomalyGroups = {};
  for (const a of anomalies.rows) {
    const key = a.anomaly_key;
    if (!anomalyGroups[key]) {
      anomalyGroups[key] = { key, severity: a.severity, count: 0, latest_date: a.trigger_date, detail: '' };
    }
    anomalyGroups[key].count++;
    if (a.trigger_date > anomalyGroups[key].latest_date) {
      anomalyGroups[key].latest_date = a.trigger_date;
    }
    if (a.trigger_value) {
      try {
        const v = typeof a.trigger_value === 'string' ? JSON.parse(a.trigger_value) : a.trigger_value;
        if (v.detail) anomalyGroups[key].detail = v.detail;
        if (v.consecutiveDown) anomalyGroups[key].detail = `连续${v.consecutiveDown}周下降(${v.changePct}%)`;
      } catch (_) {}
    }
  }

  result.anomalies = Object.values(anomalyGroups).map(g => ({
    type: mapAnomalyType(g.key),
    key: g.key,
    severity: g.severity,
    count: g.count,
    latest_date: g.latest_date,
    detail: g.detail || getAnomalyDescription(g.key),
  }));

  // ── E. 排班/在岗分析 ──
  if (reports.rows.length > 0) {
    const latestReport = reports.rows[0];
    const staff = latestReport.staff || {};
    const onDuty = [];
    const staffByArea = {};
    for (const [area, people] of Object.entries(staff)) {
      if (Array.isArray(people)) {
        staffByArea[area] = people.map(p => ({ name: p.name, user: p.user, days: p.days }));
        for (const p of people) {
          if (p.name && p.user) onDuty.push({ name: p.name, user: p.user, area, days: p.days });
        }
      }
    }

    // 排班不足检测
    const totalStaff = onDuty.length;
    const frontStaff = (staffByArea.front || []).length;
    const kitchenStaff = (staffByArea.kitchen || staffByArea.rest || []).length;

    result.staffing = {
      latest_date: latestReport.date,
      total_on_duty: totalStaff,
      front_count: frontStaff,
      kitchen_count: kitchenStaff,
      by_area: staffByArea,
      is_understaffed: totalStaff < 5,
      issues: [],
    };

    // 晚班排班不足检测
    const segments = latestReport.segments || [];
    if (segments.length > 0) {
      const dinnerSegments = segments.filter(s => {
        const label = String(s.label || s.slot || s.name || '').toLowerCase();
        return label.includes('晚') || label.includes('dinner') || label.includes('night');
      });
      if (dinnerSegments.length > 0 && frontStaff < 3) {
        result.staffing.issues.push('晚班前厅人手不足，可能影响服务响应速度');
      }
    }

    // 人效 vs 排班 关联
    if (result.revenue.is_decline && result.revenue.efficiency_change_pct < 0) {
      result.staffing.issues.push(`人效下降${Math.abs(result.revenue.efficiency_change_pct)}%，需关注排班合理性`);
    }
  }

  // ── F. 培训状态分析 ──
  const trainingByEmployee = {};
  for (const t of trainingStatus.rows) {
    const user = t.employee_username;
    if (!trainingByEmployee[user]) {
      trainingByEmployee[user] = { username: user, assignments: [], missing_certs: [] };
    }
    trainingByEmployee[user].assignments.push({
      topic_id: t.topic_id,
      title: t.topic_title,
      assignment_status: t.assignment_status,
      cert_status: t.cert_status,
    });
    if (t.cert_status !== 'valid') {
      trainingByEmployee[user].missing_certs.push(t.topic_title);
    }
  }

  // 找到未完成培训的员工名
  const employeesWithoutTraining = [];
  for (const e of employees.rows) {
    const training = trainingByEmployee[e.username];
    if (!training || training.assignments.length === 0) {
      const joinDate = new Date(e.join_date || '2026-01-01');
      const daysSinceJoin = Math.floor((Date.now() - joinDate.getTime()) / 86400000);
      employeesWithoutTraining.push({
        username: e.username,
        name: e.name,
        position: e.position,
        days_since_join: daysSinceJoin,
        is_new: daysSinceJoin < 90,
      });
    }
  }

  result.training = {
    total_assignments: trainingStatus.rows.length,
    by_employee: Object.values(trainingByEmployee),
    employees_without_training: employeesWithoutTraining,
  };

  // ── G. 品类分析（categories） ──
  if (reports.rows.length > 0) {
    const categoryData = {};
    for (const r of reports.rows) {
      const cats = r.categories || [];
      if (Array.isArray(cats)) {
        for (const c of cats) {
          if (!c || !c.name) continue;
          if (!categoryData[c.name]) categoryData[c.name] = { name: c.name, total: 0, days: 0 };
          categoryData[c.name].total += Number(c.sales || c.revenue || c.amount || 0);
          categoryData[c.name].days++;
        }
      }
    }
    if (Object.keys(categoryData).length > 0) {
      const categories = Object.values(categoryData)
        .sort((a, b) => b.total - a.total)
        .map(c => ({ ...c, avg_daily: Math.round(c.total / (c.days || 1)) }));
      result.revenue.categories = categories;
    }
  }

  // ── H. 生成个人级建议（核心） ──
  result.recommendations = await generateRecommendations({
    store: storeName,
    revenue: result.revenue,
    customer: result.customer,
    anomalies: result.anomalies,
    staffing: result.staffing,
    training: result.training,
    employees: employees.rows,
    reports: reports.rows,
  });

  // ── I. 摘要 ──
  const topAnomaly = result.anomalies.find(a => a.severity === 'high') || result.anomalies[0];
  const revenueDetail = result.revenue.is_decline
    ? `本周营业额${result.revenue.change_pct}%（vs 上周）`
    : `本周营业额稳定`;
  const popularityDetail = result.customer.new_ratio < 20
    ? `新客占比仅${result.customer.new_ratio}%`
    : '';

  result.summary = {
    headline: revenueDetail,
    top_issue: topAnomaly ? topAnomaly.type : '无明显异常',
    revenue_decline: result.revenue.is_decline ? `${result.revenue.change_pct}%` : null,
    new_customer_ratio: result.customer.new_ratio ? `${result.customer.new_ratio}%` : null,
    anomaly_count: result.anomalies.length,
    staffing_issue: result.staffing.issues?.[0] || null,
    recommendation_count: result.recommendations.length,
  };

  return result;
}

function mapAnomalyType(key) {
  const map = {
    revenue_achievement: '营收未达标',
    revenue_achievement_monthly: '月度营收未达标',
    labor_efficiency: '人效不足',
    recharge_zero: '无充值记录',
    table_visit_product: '桌访产品问题',
    table_visit_ratio: '桌访率异常',
    gross_margin: '毛利率不达标',
    bad_review_product: '产品差评',
    bad_review_service: '服务差评',
    hongchao_jiuguang_private_room: '包厢利用率低',
    food_safety: '食品安全',
    weekday_trend: '营收趋势下降',
    meal_balance: '午晚市失衡',
    dish_decline: '菜品销量下降',
  };
  return map[key] || key;
}

function getAnomalyDescription(key) {
  const map = {
    revenue_achievement: '本周营收未达到目标值的80%',
    labor_efficiency: '门店人效（元/人）低于品牌阈值',
    recharge_zero: '连续多日无会员充值记录',
    table_visit_product: '桌访中发现产品问题',
    table_visit_ratio: '桌访覆盖率/合格率偏低',
    gross_margin: '月度毛利率未达标',
    bad_review_product: '客如云系统出现产品类差评',
    bad_review_service: '客如云系统出现服务类差评',
    hongchao_jiuguang_private_room: '洪潮久光包厢利用率偏低',
    food_safety: '食品安全相关关键词命中',
    weekday_trend: '同周几营收连续3周以上下降',
    meal_balance: '午市营收占比持续低于阈值',
    dish_decline: '菜品销量连续2周下降超过20%',
  };
  return map[key] || key;
}

async function generateRecommendations(ctx) {
  const recs = [];
  const { store, revenue, customer, anomalies, staffing, training, employees, reports } = ctx;

  // 1. 营业额下降 + 客流下降 → 新客引流建议
  if (revenue.is_decline && Number(revenue.change_pct) < -5) {
    for (const c of (revenue.contributions || [])) {
      if (c.factor === '客流下降') {
        recs.push({
          type: 'marketing',
          priority: 'high',
          title: '加强新客引流',
          detail: `客流下降${c.impact}，建议增加私域引流活动（扫码领券、社群裂变）`,
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
      const reportForDate = reports.find(r => r.date === anomalyDate || r.date === anomalyDate.toISOString?.().slice(0, 10));
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
        ? new Set(['kitchen', 'kitchen_area', 'rest', '后厨', '出品', '烧味', '点心', '打荷', '上什'])
        : new Set(['front', '前厅', 'service']);
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

  // 5. 新客占比低 → 会员营销培训
  if (customer.new_ratio > 0 && customer.new_ratio < 20) {
    // 找店长
    const manager = employees.find(e =>
      e.position?.includes('店长') || e.position?.includes('manager')
    );
    const managerName = manager?.name || '店长';
    recs.push({
      type: 'training',
      priority: 'medium',
      title: `建议给${managerName}补《营销培训》培训`,
      detail: `新客占比仅${customer.new_ratio}%，低于行业基准20%。建议通过《营销培训》提升门店获客能力`,
      target: managerName,
      target_users: manager ? [manager.username] : [],
      topic_title: '营销培训',
    });
  }

  // 6. 无充值记录 → 储值推广建议
  const rechargeAnomaly = anomalies.find(a => a.key === 'recharge_zero');
  if (rechargeAnomaly) {
    recs.push({
      type: 'marketing',
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
  const startDate = dateRange?.start || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

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
          change_pct: diag.revenue.change_pct,
          is_decline: diag.revenue.is_decline,
          contributions: diag.revenue.contributions,
        },
        anomalies: diag.anomalies.map(a => ({ type: a.type, severity: a.severity, count: a.count })),
        recommendations: diag.recommendations.map(r => ({ type: r.type, title: r.title, priority: r.priority })),
      });
    } catch (e) {
      console.error(`[diagnosis] store ${s.store} failed:`, e?.message || e);
    }
  }
  return results;
}

/**
 * 注册诊断路由
 */
export function registerDiagnosisRoutes(app, pool, authRequired) {
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
      console.error('[diagnosis] store error:', e?.message || e);
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
      console.error('[diagnosis] overview error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}