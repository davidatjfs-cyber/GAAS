const EVIDENCE_LABELS = {
  total: '总记录数', rate: '完整率', with_phone: '带手机号记录数', with_customer_id: '已识别客户记录数',
  with_coupon_id: '带优惠券标识记录数', with_campaign_id: '带活动标识记录数', phone_match_rate: '客户识别率',
  rows_with_phone: '带客户标识行数', phone_rows: '菜品明细总行数', dish_rate: '菜品分类完整率',
  dish_rows: '菜品种类数', categorized_dish_rows: '已分类菜品种类数', employee_count: '员工数',
  bound_count: '已绑定门店岗位员工数', manager_count: '店长/管理员人数', target_count: '经营目标数量',
  kpi_targets_exists: '是否已建目标表', task_total: '任务总数', task_overdue_count: '逾期任务数',
  yesterday_order_count: '昨日订单数', latest_sync_time: '最近同步时间', seven_day_avg_order_count: '近7日日均订单数',
  customer_count: '客户数', customer_updated_7d: '近7天更新客户数', growth_customer_profiles_exists: '客户画像表是否存在',
  customer_ops_exists: '客户运营原始记录是否存在', delivery_total: '触达记录总数', delivery_sent: '已发送触达数',
  coupon_writeoff_count: '优惠券核销数', attribution_order_count: '已归因订单数', attribution_total: '归因记录总数',
  store_count: '门店数', segmented_count: '已分层客户数', linked_orders: '已关联订单数',
  employee_table_exists: '员工表是否存在', customer_segments_generatable: '客户分层是否可生成',
};

function topIssues(items, limit = 3) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (items || [])
    .filter((item) => item.status !== '正常')
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.item_name,
      severity: item.severity,
      impact_modules: item.impact_modules,
      owner_role: item.owner_role,
      suggestion: item.suggestion,
      can_generate_task: item.can_generate_task,
    }));
}

function formatEvidenceSummary(evidence = {}) {
  return Object.entries(evidence)
    .filter(([key]) => !['table_exists', 'table_missing'].includes(key))
    .slice(0, 6)
    .map(([key, value]) => {
      const label = EVIDENCE_LABELS[key] || key;
      let displayValue = value;
      if (typeof value === 'boolean') displayValue = value ? '是' : '否';
      else if (typeof value === 'object' && value !== null) displayValue = JSON.stringify(value);
      else if (key === 'rate' || /_rate$/.test(key)) displayValue = `${value}%`;
      return `${label}：${displayValue}`;
    })
    .join('，');
}

export function generateInspectionReport({ tenantId, overview, store_results = [], items = [] }) {
  const top = overview?.top_issues || topIssues(items);
  const affected = Array.from(new Set((items || []).flatMap((item) => item.status !== '正常' ? item.impact_modules || [] : [])));
  const worstStores = (store_results || []).filter((store) => store.health_score < 90).slice(0, 5);
  const storeNames = Array.from(new Set((items || []).map((item) => item.store_name).filter(Boolean)));
  const storeScope = storeNames.length === 1 ? storeNames[0] : storeNames.length > 1 ? storeNames.join('、') : '全部门店';
  const scoreText = overview?.health_score == null ? (overview?.risk_level || '初始化未完成') : `健康分 ${overview.health_score} 分`;
  const summary = `本次检测范围：${storeScope}。当前租户系统${scoreText}。主要问题是${top.map((item) => item.title).join('、') || '暂无关键阻塞'}，会影响${affected.slice(0, 4).join('、') || '核心运营模块'}。`;
  const badItems = (items || []).filter((item) => item.status !== '正常');
  const itemToReport = (item) => ({
    item_name: item.item_name,
    store_name: item.store_name || storeScope || '全部门店',
    impact_modules: item.impact_modules || [],
    status: item.status,
    severity: item.severity,
    problem_description: item.impact_description || '',
    suggested_arrangement: item.responsible_party === 'platform_team' || item.responsible_party === 'system_integration' ? '我方系统实施人员协助说明，租赁方配合确认数据来源' : '租赁方安排系统管理员或门店负责人',
    suggested_deadline: ['P0', 'P1'].includes(item.severity) ? '建议 3 天内完成' : '建议 7 天内完成',
    rectification_suggestion: item.suggestion || '',
    evidence_summary: formatEvidenceSummary(item.evidence || {}),
    include_in_report: true,
  });
  const tenantRectificationItems = badItems
    .filter((item) => !['platform_team', 'system_integration'].includes(item.responsible_party))
    .map(itemToReport);
  const platformNotes = badItems
    .filter((item) => ['platform_team', 'system_integration'].includes(item.responsible_party))
    .map((item) => ({
      problem: item.item_name,
      impact: item.impact_description || '',
      suggestion: item.suggestion || '',
      tenant_cooperation: '请租赁方确认数据源、字段导出或业务采集流程是否具备。',
      impact_modules: item.impact_modules || [],
    }));
  return {
    tenant_id: tenantId,
    report_title: '租户运营整改报告',
    store_scope: storeScope,
    summary,
    top_risks: top,
    affected_modules: affected,
    tenant_rectification_items: tenantRectificationItems,
    platform_notes: platformNotes,
    data_gap_impact: badItems
      .filter((item) => ['数据接入', '数据新鲜度', '营销归因'].includes(item.category))
      .map((item) => `${item.item_name}会影响${(item.impact_modules || []).join('、') || '相关报告'}，导致对应判断不完整。`),
    next_recheck_suggestion: '建议租赁方完成以上整改后，在 3 天内重新运行检测。',
    store_status: worstStores.length ? worstStores : store_results,
    ai_conclusion: summary,
    system_health: overview?.health_score == null ? '当前租户尚未完成初始化，先不要用 0 分判断经营风险。' : (overview?.health_score ?? 0) >= 75 ? '当前租户系统基本可运转，但仍需处理影响准确性的项目。' : '当前租户系统存在明显运转风险，需要先处理数据和任务闭环问题。',
    blocking_issues: top.map((item) => `${item.title}：${item.suggestion}`),
    stores_missing_actions: worstStores.map((store) => `${store.store_name}：${store.main_risk}`),
    inaccurate_ai_features: affected.filter((module) => ['经营诊断', '客户资产报告', '自动营销', '营销归因', '老板晨报'].includes(module)),
    next_actions: [...tenantRectificationItems.map((item) => item.rectification_suggestion), ...platformNotes.map((item) => item.suggestion)].filter(Boolean).slice(0, 5),
  };
}

export function buildInspectionReportHtml(report = {}, meta = {}) {
  const stripTechnicalText = (value) => String(value || '')
    .replace(/ontology/ig, '归因计算')
    .replace(/customer_id/ig, '顾客标识')
    .replace(/campaign_id/ig, '营销活动标识')
    .replace(/coupon_id/ig, '优惠券标识')
    .replace(/master_tasks/ig, '系统任务记录')
    .replace(/generated_task_id/ig, '已生成记录');
  const esc = (value) => stripTechnicalText(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rows = (array, columns) => (array || []).map((row) => `<tr>${columns.map(([key]) => `<td>${esc(Array.isArray(row[key]) ? row[key].join('、') : row[key] || '-')}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>租户运营整改报告</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;margin:32px;line-height:1.6}
  h1{font-size:30px;margin:0 0 8px} h2{font-size:18px;margin:28px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
  .muted{color:#6b7280}.cover{background:#111827;color:white;border-radius:18px;padding:28px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #e5e7eb;text-align:left;padding:8px;vertical-align:top}th{background:#f9fafb}
  </style></head><body>
  <div class="cover"><h1>租户运营整改报告</h1><div>租户：${esc(meta.tenantName || report.tenant_id || '-')}</div><div>检测日期：${esc(meta.date || '')}</div><div>报告生成时间：${esc(new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</div></div>
  <div class="grid"><div class="kpi"><b>系统运行状态</b><br>${esc(meta.riskLevel || '-')}</div><div class="kpi"><b>健康分</b><br>${esc(meta.healthScore ?? '-')}</div><div class="kpi"><b>报告状态</b><br>${esc(report.report_status || 'generated')}</div><div class="kpi"><b>下次复检</b><br>整改后 3 天内</div></div>
  <h2>本次检测结论</h2><p>${esc(report.summary || '')}</p>
  <h2>核心影响</h2><p>${esc((report.affected_modules || []).join('、') || '-')}</p>
  <h2>需要租赁方安排整改的事项</h2><table><thead><tr><th>整改事项</th><th>涉及门店</th><th>影响功能</th><th>问题说明</th><th>建议安排对象</th><th>建议完成时间</th><th>整改建议</th></tr></thead><tbody>${rows(report.tenant_rectification_items || [], [['item_name'],['store_name'],['impact_modules'],['problem_description'],['suggested_arrangement'],['suggested_deadline'],['rectification_suggestion']])}</tbody></table>
  <h2>客户未执行责任说明</h2><p>${esc((report.customer_non_execution && report.customer_non_execution.statement) || '本期未附带未执行责任台账。若系统已出建议但客户未确认/未执行，复盘时应明确：无法评价实际改善效果。')}</p>
  <h2>我方说明 / 协助事项</h2><table><thead><tr><th>问题</th><th>影响</th><th>我方建议</th><th>需要租赁方配合什么</th></tr></thead><tbody>${rows(report.platform_notes || [], [['problem'],['impact'],['suggestion'],['tenant_cooperation']])}</tbody></table>
  <h2>数据缺失造成的影响说明</h2><ul>${(report.data_gap_impact || []).map((item) => `<li>${esc(item)}</li>`).join('') || '<li>-</li>'}</ul>
  <h2>下次复检建议</h2><p>${esc(report.next_recheck_suggestion || '建议租赁方完成以上整改后，在 3 天内重新运行检测。')}</p>
  </body></html>`;
}

export function createInspectionReportService({ queryIfTable }) {
  return {
    saveInspectionReport: async (pool, { tenantId = 'default', runId = null, report = {} } = {}) => {
      const result = await pool.query(
        `INSERT INTO tenant_operation_inspection_reports
          (tenant_id, run_id, report_title, report_status, summary, affected_modules, tenant_rectification_items, platform_notes, next_recheck_suggestion, store_scope)
         VALUES ($1,$2,$3,'generated',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
         RETURNING *`,
        [tenantId, runId, report.report_title || '租户运营整改报告', report.summary || '', JSON.stringify(report.affected_modules || []), JSON.stringify(report.tenant_rectification_items || []), JSON.stringify(report.platform_notes || []), report.next_recheck_suggestion || '建议租赁方完成整改后，在 3 天内重新运行检测。', report.store_scope || '全部门店']
      );
      return { ok: true, report: result.rows?.[0] || null };
    },
    listInspectionReports: async (pool, opts = {}) => {
      const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
      const result = await queryIfTable(pool, 'tenant_operation_inspection_reports', `SELECT id, tenant_id, run_id, report_title, report_status, summary, affected_modules, store_scope,
              tenant_rectification_items, platform_notes, next_recheck_suggestion, pdf_file_url, sent_at, created_at, updated_at
         FROM tenant_operation_inspection_reports
        WHERE tenant_id=$1
        ORDER BY created_at DESC, id DESC
        LIMIT 50`, [tenantId]);
      return result.exists ? result.rows : [];
    },
    markInspectionReportSent: async (pool, { reportId, tenantId = 'default' } = {}) => {
      const result = await pool.query(
        `UPDATE tenant_operation_inspection_reports
            SET report_status='sent', sent_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND tenant_id=$2
        RETURNING id, report_status, sent_at`,
        [reportId, tenantId]
      );
      return { ok: !!result.rows?.length, report: result.rows?.[0] || null, delivery_performed: false, message: '已记录为已发送；当前版本未配置自动发送渠道，请导出报告后自行发送给租赁方。' };
    },
  };
}
