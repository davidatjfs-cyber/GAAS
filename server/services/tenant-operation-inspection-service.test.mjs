import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHealthScore,
  generateInspectionReport,
  buildInspectionReportHtml,
  runInspection,
  getInspectionTrends,
  saveInspectionReport,
  listInspectionReports,
  markInspectionReportSent,
} from './tenant-operation-inspection-service.js';

const STATUS = {
  ok: '正常',
  abnormal: '异常',
  missing: '缺失',
  delayed: '延迟',
  pending: '待配置',
};

function makeItem(overrides = {}) {
  return {
    category: '基础配置',
    item_key: 'tenant_has_stores',
    item_name: '租户是否已创建门店',
    status: STATUS.ok,
    severity: 'P3',
    owner_role: '租户管理员',
    impact_modules: ['经营诊断'],
    impact_description: '测试影响说明',
    suggestion: '测试建议',
    evidence: { store_count: 1 },
    responsible_party: 'tenant_admin',
    store_name: '测试店',
    ...overrides,
  };
}

test('calculateHealthScore deducts by severity and computes category rates', () => {
  const items = [
    makeItem({ status: STATUS.ok }),
    makeItem({
      category: '数据接入',
      item_key: 'pos_data_connected',
      item_name: 'POS 是否接入',
      status: STATUS.missing,
      severity: 'P0',
    }),
    makeItem({
      category: '任务闭环',
      item_key: 'overdue_tasks_exist',
      item_name: '逾期任务',
      status: STATUS.abnormal,
      severity: 'P2',
    }),
  ];
  const score = calculateHealthScore(items);
  assert.equal(score.health_score, 69);
  assert.equal(score.risk_level, '预警');
  assert.ok(score.deductions.length >= 2);
  assert.equal(score.data_completeness, 88);
  assert.ok(score.task_completion_rate < 100);
});

test('calculateHealthScore returns 健康 for clean tenant', () => {
  const score = calculateHealthScore([makeItem()]);
  assert.equal(score.health_score, 100);
  assert.equal(score.risk_level, '健康');
  assert.deepEqual(score.deductions, []);
});

test('generateInspectionReport splits tenant vs platform items and builds summary', () => {
  const items = [
    makeItem({
      status: STATUS.missing,
      severity: 'P1',
      responsible_party: 'tenant_admin',
      item_name: '门店负责人未确认',
      impact_modules: ['任务闭环', '老板晨报'],
    }),
    makeItem({
      category: '数据接入',
      item_key: 'pos_data_connected',
      item_name: 'POS 未接入',
      status: STATUS.missing,
      severity: 'P0',
      responsible_party: 'platform_team',
      impact_modules: ['经营诊断'],
    }),
  ];
  const overview = calculateHealthScore(items);
  overview.top_issues = [{ title: 'POS 未接入', severity: 'P0', suggestion: '接入 POS' }];
  const report = generateInspectionReport({
    tenantId: 't-demo',
    overview,
    store_results: [{ store_name: '测试店', health_score: 55, main_risk: 'POS 缺失' }],
    items,
  });
  assert.equal(report.tenant_id, 't-demo');
  assert.match(report.summary, /测试店/);
  assert.equal(report.tenant_rectification_items.length, 1);
  assert.equal(report.platform_notes.length, 1);
  assert.ok(report.data_gap_impact.length >= 1);
  assert.ok(report.blocking_issues.length >= 1);
  assert.equal(report.tenant_rectification_items[0].suggested_deadline, '建议 3 天内完成');
});

test('generateInspectionReport handles uninitialized overview without numeric score', () => {
  const report = generateInspectionReport({
    tenantId: 'new-tenant',
    overview: { risk_level: '初始化未完成', top_issues: [] },
    items: [],
  });
  assert.match(report.summary, /初始化未完成/);
  assert.match(report.system_health, /尚未完成初始化/);
});

test('buildInspectionReportHtml escapes technical terms and renders tables', () => {
  const html = buildInspectionReportHtml(
    {
      summary: 'customer_id 需补齐',
      tenant_rectification_items: [{
        item_name: '手机号缺失',
        store_name: '马己仙久光',
        impact_modules: ['自动营销'],
        problem_description: 'ontology 归因不足',
        suggested_arrangement: '租赁方安排店长',
        suggested_deadline: '建议 7 天内完成',
        rectification_suggestion: '导出 POS 明细',
      }],
      platform_notes: [{ problem: '接口延迟', impact: '同步慢', suggestion: '排查', tenant_cooperation: '提供账号' }],
      data_gap_impact: ['POS 缺失会影响经营诊断'],
      affected_modules: ['经营诊断'],
    },
    { tenantName: '演示租户', date: '2026-07-26', riskLevel: '预警', healthScore: 72 }
  );
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /演示租户/);
  assert.equal(html.includes('customer_id'), false);
  assert.equal(html.includes('ontology'), false);
  assert.match(html, /归因计算/);
  assert.match(html, /手机号缺失/);
});

function makeInspectionPool({
  tables = new Set(),
  storeRows = [],
  posRows = [{ total: 500, yesterday_total: 40, phone_rows: 200, rows_with_phone: 180, dish_rows: 30, categorized_dish_rows: 28, latest_date: '2026-07-25' }],
  persist = true,
} = {}) {
  let itemId = 0;
  return {
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('information_schema.tables')) {
        const table = params[0];
        return tables.has(table) ? { rows: [{ table_name: table }] } : { rows: [] };
      }
      if (s.includes('information_schema.columns')) {
        const cols = ['store_id', 'id', 'name', 'store_name', 'tenant_id', 'store', 'role', 'position', 'username'];
        return { rows: cols.map((column_name) => ({ column_name })) };
      }
      if (s.includes('FROM stores') || s.includes('FROM growth_ontology_stores')) {
        return { rows: storeRows };
      }
      if (s.includes('pos_order_items') || s.includes('pos_sales_detail')) {
        return { rows: posRows };
      }
      if (s.includes('growth_customer_profiles')) {
        return { rows: [{ total: 120, updated_7d: 15 }] };
      }
      if (s.includes('customer_ops_source_records')) {
        return { rows: [{ total: 20, updated_7d: 5 }] };
      }
      if (s.includes('pos_orders')) {
        return { rows: [{ total: 300, with_phone: 250, with_customer_id: 200, with_coupon_id: 10 }] };
      }
      if (s.includes('master_tasks')) {
        return { rows: [{ total: 5, generated: 3, confirmed: 2, executed: 1, overdue: 0, reviewed: 1 }] };
      }
      if (s.includes('growth_marketing_actions')) {
        return { rows: [{ total: 10, sent: 8 }] };
      }
      if (s.includes('hrms_state')) {
        return { rows: [{ stores: [{ id: 's1', name: '演示店', businessHours: '10:00-22:00' }] }] };
      }
      if (s.includes('INSERT INTO tenant_operation_inspection_runs')) {
        return persist ? { rows: [{ id: 101 }] } : { rows: [] };
      }
      if (s.includes('INSERT INTO tenant_operation_inspection_items')) {
        itemId += 1;
        return { rows: [{ id: itemId }] };
      }
      if (s.includes('tenant_operation_inspection_runs') && s.includes('DISTINCT ON')) {
        return { rows: [{ date: '2026-07-26', health_score: 88, data_completeness: 90, task_completion_rate: 85, attribution_completeness: 80, p0_count: 0, p1_count: 1 }] };
      }
      if (s.includes('tenant_operation_inspection_reports') && s.includes('SELECT')) {
        return { rows: [{ id: 1, tenant_id: 't1', report_title: '租户运营整改报告', report_status: 'generated', summary: 'ok' }] };
      }
      if (s.includes('INSERT INTO tenant_operation_inspection_reports')) {
        return { rows: [{ id: 2, tenant_id: params[0], report_title: params[2] }] };
      }
      if (s.includes('UPDATE tenant_operation_inspection_reports')) {
        return { rows: [{ id: params[0], report_status: 'sent', sent_at: new Date().toISOString() }] };
      }
      if (s.includes('FROM employees') || s.includes('employees WHERE')) {
        return { rows: [{ username: 'mgr', role: 'store_manager', store: '演示店', store_id: 's1' }] };
      }
      return { rows: [] };
    },
  };
}

test('runInspection end-to-end with mocked pool produces overview and scoped items', async () => {
  const tables = new Set([
    'stores',
    'pos_order_items',
    'growth_customer_profiles',
    'customer_ops_source_records',
    'pos_orders',
    'master_tasks',
    'growth_marketing_actions',
    'employees',
  ]);
  const pool = makeInspectionPool({
    tables,
    storeRows: [{ store_id: 's1', name: '演示店' }],
  });
  const all = await runInspection(pool, { tenantId: 't1', date: '2026-07-26' });
  assert.equal(all.ok, true);
  assert.equal(all.tenant_id, 't1');
  assert.ok(all.items.length > 5);
  assert.ok(all.overview.health_score != null);
  assert.ok(Array.isArray(all.overview.top_issues));

  const scoped = await runInspection(pool, { tenantId: 't1', scope: '数据接入' });
  assert.ok(scoped.items.every((item) => item.category === '数据接入'));
  assert.ok(scoped.items.length < all.items.length);

  const invalidScope = await runInspection(pool, { tenantId: 't1', scope: 'invalid-scope' });
  assert.equal(invalidScope.items.length, all.items.length);
});

test('getInspectionTrends fills seven-day series with nulls for missing dates', async () => {
  const pool = makeInspectionPool({ tables: new Set(['tenant_operation_inspection_runs', 'tenant_operation_inspection_items']) });
  const trends = await getInspectionTrends(pool, { tenantId: 't1', date: '2026-07-26' });
  assert.equal(trends.length, 7);
  assert.ok(trends.some((row) => row.health_score === 88));
  assert.ok(trends.some((row) => row.health_score == null));
});

test('save/list/mark inspection reports via pool', async () => {
  const pool = makeInspectionPool({ tables: new Set(['tenant_operation_inspection_reports']) });
  const saved = await saveInspectionReport(pool, {
    tenantId: 't1',
    runId: 9,
    report: generateInspectionReport({
      tenantId: 't1',
      overview: calculateHealthScore([makeItem()]),
      items: [makeItem()],
    }),
  });
  assert.equal(saved.ok, true);
  assert.ok(saved.report);

  const listed = await listInspectionReports(pool, { tenantId: 't1' });
  assert.equal(listed.length, 1);

  const marked = await markInspectionReportSent(pool, { reportId: 1, tenantId: 't1' });
  assert.equal(marked.ok, true);
  assert.equal(marked.report.report_status, 'sent');
});
