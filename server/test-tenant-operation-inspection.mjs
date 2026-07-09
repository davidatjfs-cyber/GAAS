import assert from 'node:assert/strict';
import {
  calculateHealthScore,
  runInspection,
  generateInspectionReport,
  generateRecoveryTask,
} from './services/tenant-operation-inspection-service.js';

function makePool(fixtures = {}) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes('information_schema.tables')) {
        const table = params[1];
        return { rows: fixtures.missingTables?.includes(table) ? [] : [{ table_name: table }] };
      }
      if (text.includes('information_schema.columns')) {
        return { rows: [{ column_name: 'tenant_id' }, { column_name: 'store_id' }, { column_name: 'store_name' }, { column_name: 'created_at' }] };
      }
      if (text.includes('INSERT INTO tenant_operation_inspection_runs')) return { rows: [{ id: 101 }] };
      if (text.includes('INSERT INTO tenant_operation_inspection_items')) return { rows: [{ id: 201 }] };
      if (text.includes('UPDATE tenant_operation_inspection_items')) return { rows: [{ id: params[1], generated_task_id: params[0] }] };
      if (text.includes('INSERT INTO master_tasks')) return { rows: [{ task_id: 'TOI-20260709-0001' }] };
      if (text.includes('FROM stores')) return { rows: fixtures.stores ?? [{ store_id: 's1', name: '测试门店' }] };
      if (text.includes('FROM employees')) return { rows: fixtures.employees ?? [{ username: 'm1', role: 'store_manager', store: '测试门店', position: '店长' }] };
      if (text.includes('FROM pos_order_items')) return { rows: fixtures.pos ?? [{ total: '10', yesterday_total: '3', latest_date: '2026-07-08', phone_rows: '8', rows_with_phone: '6', dish_rows: '5', categorized_dish_rows: '4' }] };
      if (text.includes('FROM growth_customer_profiles')) return { rows: fixtures.profiles ?? [{ total: '12', updated_7d: '9', segmented: '8', phone_total: '10', phone_matched: '8' }] };
      if (text.includes('FROM customer_ops_source_records')) return { rows: fixtures.customerOps ?? [{ total: '7', updated_7d: '7' }] };
      if (text.includes('FROM growth_delivery_logs')) return { rows: fixtures.delivery ?? [{ total: '4', sent: '3' }] };
      if (text.includes('FROM growth_redemptions')) return { rows: fixtures.redemptions ?? [{ total: '1' }] };
      if (text.includes('FROM growth_ontology_attributions')) return { rows: fixtures.attribution ?? [{ total: '1', linked_orders: '1' }] };
      if (text.includes('FROM master_tasks')) return { rows: fixtures.tasks ?? [{ total: '6', generated: '6', confirmed: '4', executed: '3', overdue: '1', reviewed: '2' }] };
      if (text.includes('FROM training_assignments')) return { rows: fixtures.training ?? [{ total: '2' }] };
      return { rows: [] };
    }
  };
  return pool;
}

{
  const score = calculateHealthScore([
    { severity: 'P0', category: '数据接入' },
    { severity: 'P1', category: '数据新鲜度' },
    { severity: 'P2', category: '任务闭环' },
    { severity: 'P3', category: '基础配置' },
  ]);
  assert.equal(score.health_score, 55);
  assert.equal(score.risk_level, '严重');
  assert.equal(score.deductions.length, 4);
}

{
  const result = await runInspection(makePool(), { tenantId: 'default', date: '2026-07-09' });
  assert.equal(result.items.length, 20);
  assert.ok(result.overview.health_score >= 0);
  assert.ok(Array.isArray(result.overview.top_issues));
}

{
  const result = await runInspection(makePool({ missingTables: ['growth_delivery_logs', 'growth_redemptions'] }), { tenantId: 'default', date: '2026-07-09' });
  assert.equal(result.items.length, 20);
  assert.ok(result.items.some((item) => item.status === '待配置'));
}

{
  const report = generateInspectionReport({
    tenantId: 'default',
    overview: { health_score: 68, risk_level: '预警', top_issues: [{ title: '昨日 POS 数据未同步', impact_modules: ['经营诊断'] }] },
    store_results: [{ store_name: '测试门店', health_score: 68, main_risk: 'POS 延迟' }],
    items: [{ item_name: '昨日订单数据是否同步', severity: 'P1', status: '延迟', suggestion: '检查 POS 同步' }],
  });
  assert.ok(report.summary.includes('健康分 68 分'));
  assert.ok(report.next_actions.length > 0);
}

{
  const pool = makePool();
  const task = await generateRecoveryTask(pool, {
    item: {
      id: 201,
      tenant_id: 'default',
      store_id: 's1',
      item_name: 'POS 数据是否接入',
      impact_description: 'POS 缺失会影响经营诊断。',
      owner_role: '实施人员',
      suggestion: '检查 POS 接口',
      evidence: { source: 'test' },
    },
  });
  assert.equal(task.task_id, 'TOI-20260709-0001');
  assert.ok(pool.calls.some((call) => call.sql.includes('INSERT INTO master_tasks')));
}

console.log('tenant-operation-inspection tests passed');
