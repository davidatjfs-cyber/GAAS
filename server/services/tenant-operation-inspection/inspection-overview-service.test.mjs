import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInspectionOverview,
  buildInspectionStoreResults,
  calculateHealthScore,
} from './inspection-overview-service.js';

function item(overrides = {}) {
  return {
    item_key: 'tenant_has_stores',
    item_name: '门店基础配置',
    category: '基础配置',
    status: '正常',
    severity: 'P3',
    impact_modules: ['经营诊断'],
    owner_role: '租户管理员',
    responsible_party: 'tenant_admin',
    suggestion: '保持配置',
    ...overrides,
  };
}

test('calculateHealthScore preserves severity deductions and category scores', () => {
  const score = calculateHealthScore([
    item(),
    item({ item_key: 'pos_data_connected', category: '数据接入', status: '缺失', severity: 'P0' }),
    item({ item_key: 'task_overdue', category: '任务闭环', status: '异常', severity: 'P2' }),
  ]);

  assert.equal(score.health_score, 69);
  assert.equal(score.risk_level, '预警');
  assert.equal(score.data_completeness, 88);
  assert.equal(score.task_completion_rate, 94);
  assert.equal(score.deductions.length, 2);
});

test('buildInspectionOverview reports initialization blockers and excludes structural watch deductions from managed risk', () => {
  const items = [
    item({ status: '缺失', severity: 'P0' }),
    item({
      item_key: 'customer_phone_match_rate',
      item_name: '手机号匹配率',
      category: '数据接入',
      status: '异常',
      severity: 'P1',
      impact_modules: ['老板晨报'],
    }),
  ];
  const overview = buildInspectionOverview(calculateHealthScore(items), items, []);

  assert.equal(overview.inspection_status, 'not_initialized');
  assert.equal(overview.health_score, null);
  assert.equal(overview.raw_health_score, 63);
  assert.equal(overview.customer_success_risk, 'medium');
  assert.equal(overview.health_score_adjusted, null);
  assert.ok(overview.initialization_required.some((message) => message.includes('创建门店')));
  assert.ok(overview.feature_availability.some((feature) => feature.feature === '经营诊断' && feature.status === '不可用'));
  assert.equal(overview.category_stats[0].missing_count, 1);
});

test('buildInspectionOverview exposes trial-stage priorities and store results', () => {
  const items = [
    item({ store_id: 's1', store_name: '一店' }),
    item({
      item_key: 'pos_data_connected',
      item_name: 'POS 接入',
      category: '数据接入',
      store_id: 's1',
      store_name: '一店',
      status: '正常',
    }),
    item({
      item_key: 'customer_data_updated',
      item_name: '客户数据',
      category: '数据接入',
      store_id: 's1',
      store_name: '一店',
      status: '正常',
    }),
    item({
      item_key: 'overdue_tasks_exist',
      item_name: '逾期事项',
      category: '任务闭环',
      store_id: 's1',
      store_name: '一店',
      status: '异常',
      severity: 'P1',
      impact_modules: ['任务闭环', '老板晨报'],
      responsible_party: 'store_manager',
    }),
  ];
  const overview = buildInspectionOverview(calculateHealthScore(items), items, [{ store_id: 's1', store_name: '一店' }]);
  const stores = buildInspectionStoreResults([{ store_id: 's1', store_name: '一店' }], items);

  assert.equal(overview.inspection_status, 'completed');
  assert.equal(overview.operation_stage, 'trial');
  assert.equal(overview.today_priorities[0].responsible_party_label, '店长');
  assert.equal(stores[0].health_score, 88);
  assert.equal(stores[0].task_status, '需处理');
  assert.equal(stores[0].main_risk, '逾期事项');
});
