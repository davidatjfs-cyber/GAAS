import assert from 'node:assert/strict';
import { faqForItemKey, listHealthFaqs, ITEM_KEY_TO_FAQ } from './services/tenant-health-faq.js';
import {
  getHealthCenterBoard,
  scanHealthCenter,
  isCsDailyActionable,
  STRUCTURAL_WATCH_KEYS,
} from './services/tenant-health-center-service.js';
import { startHealthCenterDailyScanScheduler } from './services/tenant-health-center-scheduler.js';

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
        if (text.includes('INTERVAL') || text.includes('7 days')) {
          return {
            rows: [{
              total: fixtures.delivery7dTotal ?? fixtures.deliveryTotal ?? 0,
              sent: fixtures.delivery7dSent ?? fixtures.deliverySent ?? 0,
              failed: fixtures.delivery7dFailed ?? 0,
              last_at: null,
            }],
          };
        }
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

{
  assert.equal(isCsDailyActionable({ item_key: 'yesterday_orders_synced', owner_role: '实施人员' }), true);
  assert.equal(isCsDailyActionable({ item_key: 'customer_phone_match_rate', owner_role: '实施人员' }), false);
  assert.equal(isCsDailyActionable({ item_key: 'delivery_campaign_id_complete_rate', owner_role: '系统' }), false);
  assert.ok(STRUCTURAL_WATCH_KEYS.has('order_phone_complete_rate'));
  console.log('ok cs actionable filter');
}

{
  // 仅结构性 + 系统观测 P1：不应染红（旧缓存 risk=high 也要降级）
  const pool = makePool({ loginCount: 5, deliverySent: 2, delivery7dTotal: 2, delivery7dSent: 2, briefingCnt: 1 });
  // 覆盖 t_red 的 items 为结构性手机号
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM tenant_operation_inspection_items') && params[0] === 11) {
      return {
        rows: [{
          id: 1, run_id: 11, tenant_id: 't_red', store_id: null, category: '数据接入',
          item_key: 'customer_phone_match_rate', item_name: '手机号匹配率', status: '异常',
          severity: 'P1', owner_role: '实施人员', responsible_party: 'platform_team',
          impact_modules: ['自动营销'], impact_description: '匹配率低', suggestion: '催采集',
          evidence: { phone_match_rate: 20, structural_watch: true }, can_generate_task: false, created_at: '2026-07-13',
        }, {
          id: 2, run_id: 11, tenant_id: 't_red', store_id: null, category: '营销归因',
          item_key: 'delivery_campaign_id_complete_rate', item_name: '活动完整率', status: '异常',
          severity: 'P1', owner_role: '系统', responsible_party: 'system_integration',
          impact_modules: ['营销归因'], impact_description: '缺 campaign_id', suggestion: '研发修',
          evidence: { rate: 10 }, can_generate_task: false, created_at: '2026-07-13',
        }],
      };
    }
    return origQuery(sql, params);
  };
  const board = await getHealthCenterBoard(pool, { light: 'all', syncIncidents: false });
  const card = board.tenants.find((t) => t.tenant_id === 't_red');
  assert.ok(card);
  assert.notEqual(card.light, 'red', `expected not red, got ${card.light}`);
  assert.ok(['yellow', 'green'].includes(card.light));
  assert.ok(card.indicators.ai_status);
  assert.equal(typeof card.indicators.sms_ok, 'boolean');
  console.log('ok structural/system watch not red');
}

{
  const sched = startHealthCenterDailyScanScheduler({ query: async () => ({ rows: [] }) }, { armed: false });
  assert.ok(typeof sched.tick === 'function');
  const parts = sched.shanghaiParts(new Date('2026-07-13T00:00:00Z'));
  assert.ok(parts.ymd);
  console.log('ok health scan scheduler');
}

console.log('tenant-health-center tests passed');

