import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerAssetReport,
  buildOpsRectificationReport,
  buildTalentGrowthReport,
} from '../report-builders.js';

function mockPool(handler) {
  return {
    query: async (sql, params) => handler(String(sql || ''), params || []),
  };
}

test('buildCustomerAssetReport maps asset + previous period rows', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("data->'stores'")) return { rows: [{ stores: [] }] };
    if (sql.includes('FROM classified') || sql.includes('identifiable_customers')) {
      return {
        rows: [{
          identifiable_customers: 100,
          new_customers: 40,
          repeat_customers: 25,
          active_customers: 60,
          dormant_reactivated: 8,
          vip_customers: 12,
          customer_revenue: 50000,
          new_revenue: 12000,
          repeat_revenue: 18000,
          vip_revenue: 15000,
          reactivated_revenue: 4000,
          other_revenue: 1000,
          new_primary_customers: 40,
          repeat_primary_customers: 25,
          vip_primary_customers: 12,
          reactivated_primary_customers: 8,
          other_primary_customers: 15,
        }],
      };
    }
    return { rows: [] };
  });

  const r = await buildCustomerAssetReport(pool, 'default', {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-15',
  });
  assert.equal(r.ok, true);
  assert.equal(r.report.title, 'AI客户资产增长报告');
  assert.equal(r.report.summary.new_customers, 40);
  assert.equal(r.report.summary.vip_customers, 12);
  assert.ok(Array.isArray(r.report.stages));
  assert.ok(r.report.next_month_pools.length >= 3);
  assert.match(r.report.executive_summary, /客户/);
});

test('buildCustomerAssetReport declining revenue uses retention summary', async () => {
  let call = 0;
  const pool = mockPool((sql) => {
    if (sql.includes("data->'stores'")) return { rows: [{ stores: [] }] };
    if (sql.includes('identifiable_customers')) {
      call += 1;
      if (call === 1) {
        return {
          rows: [{
            identifiable_customers: 50,
            new_customers: 20,
            repeat_customers: 5,
            active_customers: 10,
            dormant_reactivated: 1,
            vip_customers: 2,
            customer_revenue: 1000,
            new_revenue: 500,
            repeat_revenue: 200,
            vip_revenue: 200,
            reactivated_revenue: 50,
            other_revenue: 50,
            new_primary_customers: 20,
            repeat_primary_customers: 5,
            vip_primary_customers: 2,
            reactivated_primary_customers: 1,
            other_primary_customers: 22,
          }],
        };
      }
      return {
        rows: [{
          identifiable_customers: 40,
          new_customers: 10,
          repeat_customers: 8,
          active_customers: 30,
          dormant_reactivated: 2,
          vip_customers: 4,
          customer_revenue: 9000,
          new_revenue: 1000,
          repeat_revenue: 4000,
          vip_revenue: 3000,
          reactivated_revenue: 500,
          other_revenue: 500,
          new_primary_customers: 10,
          repeat_primary_customers: 8,
          vip_primary_customers: 4,
          reactivated_primary_customers: 2,
          other_primary_customers: 16,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await buildCustomerAssetReport(pool, 'default', {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-07',
  });
  assert.match(r.report.executive_summary, /留不住|下滑/);
});

test('buildOpsRectificationReport labels anomaly keys and builds groups', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("data->'stores'")) return { rows: [{ stores: [] }] };
    if (sql.includes('FROM anomaly_triggers') && sql.includes('COUNT(*)')) {
      return { rows: [{ total: 4, high_risk: 2, open_count: 1, generated_tasks: 3 }] };
    }
    if (sql.includes('FROM master_tasks') || sql.includes('MASTER_TASKS') || /FROM\s+\w*master_tasks/i.test(sql)) {
      return { rows: [{ total: 5, completed: 2, overdue: 1 }] };
    }
    if (sql.includes('FROM anomaly_triggers') && sql.includes('ORDER BY')) {
      return {
        rows: [
          { anomaly_key: 'dish_decline', store: '马己仙', severity: 'high', status: 'open', trigger_date: '2026-07-20', task_id: 'T1', resolution_code: '复盘推荐' },
          { anomaly_key: 'bad_review_service', store: '洪潮', severity: 'critical', status: 'closed', trigger_date: '2026-07-19', task_id: 'T2', resolution_code: null },
          { anomaly_key: 'recharge_zero', store: '马己仙', severity: 'medium', status: 'processing', trigger_date: '2026-07-18', task_id: '', resolution_code: null },
          { anomaly_key: 'custom_private_room_x', store: '洪潮', severity: 'low', status: 'assigned', trigger_date: '2026-07-17', task_id: 'T3', resolution_code: null },
        ],
      };
    }
    return { rows: [] };
  });

  const r = await buildOpsRectificationReport(pool, 'default', {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-25',
  });
  assert.equal(r.ok, true);
  assert.equal(r.report.summary.anomalies, 4);
  assert.equal(r.report.summary.high_risk_anomalies, 2);
  assert.ok(r.report.rows.some((row) => row.type === '菜品销量下滑'));
  assert.ok(r.report.rows.some((row) => row.type === '服务差评增加' || row.type === '口碑评价异常'));
  assert.ok(r.report.rows.some((row) => row.type === '包房消费异常'));
  assert.ok(r.report.anomaly_groups.length >= 1);
  assert.ok(r.report.top_problems.length >= 1);
  assert.match(r.report.executive_summary, /经营异常/);
});

test('buildOpsRectificationReport empty anomalies uses calm summary', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("data->'stores'")) return { rows: [{ stores: [] }] };
    return { rows: [{}] };
  });
  const r = await buildOpsRectificationReport(pool, 'default', {});
  assert.match(r.report.executive_summary, /暂未发现/);
});

test('buildTalentGrowthReport computes promotion candidates when thresholds met', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("data->'stores'")) return { rows: [{ stores: [] }] };
    if (sql.includes('training_assignments')) {
      return { rows: [{ tasks: 10, employees: 8 }] };
    }
    if (sql.includes('training_sessions')) {
      return { rows: [{ sessions: 10, completed: 10, passed: 10, learned_employees: 8 }] };
    }
    if (sql.includes('training_certifications')) {
      return { rows: [{ certifications: 3 }] };
    }
    if (sql.includes('agent_scores') || /AGENT_SCORES/i.test(sql) || sql.includes('total_score')) {
      return { rows: [{ avg_score: 90, score_count: 5 }] };
    }
    return { rows: [] };
  });

  const r = await buildTalentGrowthReport(pool, 'default', {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
  });
  assert.equal(r.ok, true);
  assert.equal(r.report.summary.certifications, 3);
  assert.equal(r.report.summary.promotion_candidates, 3);
  assert.equal(r.report.summary.exam_pass_rate, 1);
  assert.ok(r.report.enable_sequence.length >= 3);
  assert.ok(r.report.role_rows.length >= 3);
});

test('buildTalentGrowthReport zero data keeps promotion candidates at 0', async () => {
  const pool = mockPool(() => ({ rows: [{}] }));
  const r = await buildTalentGrowthReport(pool, 'default', {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
  });
  assert.equal(r.report.summary.promotion_candidates, 0);
  assert.equal(r.report.summary.certifications, 0);
});
