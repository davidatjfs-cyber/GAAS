import assert from 'node:assert/strict';
import { faqForItemKey, listHealthFaqs, ITEM_KEY_TO_FAQ } from './services/tenant-health-faq.js';
import { getHealthCenterBoard, scanHealthCenter } from './services/tenant-health-center-service.js';

function makePool(fixtures = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('information_schema.tables')) {
        const table = params[0];
        const missing = fixtures.missingTables || [];
        return { rows: missing.includes(table) ? [] : [{ table_name: table }] };
      }
      if (text.includes('FROM tenants')) {
        return { rows: fixtures.tenants || [
          { tenant_id: 't_red', name: '红店', status: 'active', mode: 'managed', created_at: '2026-01-01' },
          { tenant_id: 't_green', name: '绿店', status: 'active', mode: 'managed', created_at: '2026-01-02' },
        ] };
      }
      if (text.includes('FROM tenant_operation_inspection_runs')) {
        const tenantId = params[0];
        if (tenantId === 't_red') {
          return { rows: [{
            id: 11, tenant_id: 't_red', store_id: null, inspection_date: '2026-07-13',
            health_score: 40, risk_level: '高', data_completeness: 50, data_freshness: 40,
            task_completion_rate: 30, ai_runnable_rate: 40, attribution_completeness: 20,
            summary: '健康分 40', inspection_status: 'completed', operation_stage: 'trial',
            customer_success_risk: 'high', created_at: '2026-07-13T01:00:00Z',
          }] };
        }
        if (tenantId === 't_green') {
          return { rows: [{
            id: 22, tenant_id: 't_green', store_id: null, inspection_date: '2026-07-13',
            health_score: 95, risk_level: '低', data_completeness: 95, data_freshness: 95,
            task_completion_rate: 90, ai_runnable_rate: 90, attribution_completeness: 90,
            summary: '健康分 95', inspection_status: 'completed', operation_stage: 'active',
            customer_success_risk: 'low', created_at: '2026-07-13T01:00:00Z',
          }] };
        }
        return { rows: [] };
      }
      if (text.includes('FROM tenant_operation_inspection_items')) {
        const runId = params[0];
        if (runId === 11) {
          return { rows: [
            {
              id: 1, run_id: 11, tenant_id: 't_red', store_id: null, category: '数据接入',
              item_key: 'yesterday_orders_synced', item_name: '昨日订单是否同步', status: '延迟',
              severity: 'P0', owner_role: '实施人员', responsible_party: 'platform_team',
              impact_modules: ['经营诊断'], impact_description: '同步延迟', suggestion: '检查 POS 同步',
              evidence: { latest_sync_time: '2026-07-10' }, can_generate_task: true, created_at: '2026-07-13',
            },
            {
              id: 2, run_id: 11, tenant_id: 't_red', store_id: null, category: '数据接入',
              item_key: 'customer_phone_match_rate', item_name: '手机号匹配率', status: '异常',
              severity: 'P1', owner_role: '实施人员', responsible_party: 'platform_team',
              impact_modules: ['自动营销'], impact_description: '匹配率低', suggestion: '催采集手机号',
              evidence: { phone_match_rate: 20 }, can_generate_task: true, created_at: '2026-07-13',
            },
          ] };
        }
        return { rows: [] };
      }
      if (text.includes('FROM user_login_log')) {
        return { rows: [{ cnt: fixtures.loginCount ?? 0, last_login_at: null }] };
      }
      if (text.includes('FROM growth_delivery_logs')) {
        return { rows: [{ total: fixtures.deliveryTotal ?? 0, sent: fixtures.deliverySent ?? 0 }] };
      }
      if (text.includes('FROM agent_v2_morning_briefing_sends')) {
        return { rows: [{ cnt: fixtures.briefingCnt ?? 0, last_at: null }] };
      }
      if (text.includes('FROM tenant_operation_inspection_reports')) {
        return { rows: [{ cnt: fixtures.reportCnt ?? 0, last_at: null }] };
      }
      return { rows: [] };
    },
  };
}

{
  assert.equal(faqForItemKey('yesterday_orders_synced')?.id, 'data-not-updated');
  assert.equal(faqForItemKey('unknown_key'), null);
  assert.ok(listHealthFaqs().length >= 8);
  assert.ok(ITEM_KEY_TO_FAQ.sms_wecom_sent);
  console.log('ok faq map');
}

{
  const pool = makePool({ loginCount: 0, deliverySent: 0, briefingCnt: 0 });
  const board = await getHealthCenterBoard(pool, { light: 'all' });
  assert.equal(board.ok, true);
  assert.equal(board.summary.total, 2);
  assert.ok(board.summary.red >= 1);
  const red = board.tenants.find((t) => t.tenant_id === 't_red');
  assert.equal(red.light, 'red');
  assert.ok(red.p0_count >= 1);
  assert.equal(red.top_red[0].faq?.id, 'data-not-updated');
  const onlyRed = await getHealthCenterBoard(pool, { light: 'red' });
  assert.ok(onlyRed.tenants.every((t) => t.light === 'red'));
  console.log('ok health board');
}

{
  // scan 会调用 runInspection；这里用缺表池验证失败可被捕获而不抛崩
  const pool = makePool({ missingTables: ['stores', 'pos_order_items', 'growth_customer_profiles', 'customer_ops_source_records', 'employees', 'hrms_state', 'growth_ontology_stores'] });
  // 覆盖 tenants 查询后 runInspection 路径：允许失败计入 failed
  const result = await scanHealthCenter(pool, { tenantIds: ['t_red'] });
  assert.equal(result.ok, true);
  assert.equal(result.scanned, 1);
  console.log('ok health scan wrapper');
}

console.log('tenant-health-center tests passed');
