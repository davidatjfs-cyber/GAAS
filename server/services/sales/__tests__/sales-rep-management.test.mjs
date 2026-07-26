import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listSalesReps,
  createOrUpdateSalesRep,
  computeDailyActivityForRep,
  runDailyActivityRollup,
  upsertKpiTarget,
  computeAndSaveKpiScore,
  getRepScorecard,
  getTeamLeaderboard,
  runAutoKpiRollupAndNotify,
} from '../sales-rep-management.js';

function mockPool(handler) {
  return {
    query: async (sql, params) => handler(String(sql || ''), params || []),
  };
}

const SAMPLE_REP = {
  id: 1,
  rep_key: 'zhangsan',
  display_name: '张三',
  role: 'sales',
  status: 'active',
};

const SAMPLE_TARGET = {
  rep_id: 1,
  period_type: 'week',
  period_key: '2026-W30',
  target_new_leads: 10,
  target_demos: 5,
  target_deals: 2,
  target_revenue_fen: 100000,
};

const SAMPLE_DAILY_ROWS = [
  {
    activity_date: '2026-07-20',
    avg_response_minutes: 25,
    overdue_tasks: 0,
    price_guard_triggers: 0,
  },
  {
    activity_date: '2026-07-21',
    avg_response_minutes: 35,
    overdue_tasks: 1,
    price_guard_triggers: 1,
  },
];

function kpiScorePool(overrides = {}) {
  const {
    target = SAMPLE_TARGET,
    repKey = 'zhangsan',
    dailyRows = SAMPLE_DAILY_ROWS,
    newLeads = 8,
    demos = 4,
    deals = 1,
    trainingRows = [{ scenario_key: 'ask_price', avg_score: 80 }],
    savedScore = {
      rep_id: 1,
      period_type: overrides.periodType || 'week',
      period_key: overrides.periodKey || '2026-W30',
      behavior_score: 72.5,
      outcome_score: 60,
      manager_score: null,
      final_score: 59,
      manager_comment: null,
    },
  } = overrides;

  return mockPool((sql) => {
    if (sql.includes('FROM sales_kpi_targets')) return { rows: [target] };
    if (sql.includes('FROM sales_reps WHERE id')) return { rows: [{ rep_key: repKey }] };
    if (sql.includes('FROM sales_daily_activity')) return { rows: dailyRows };
    if (sql.includes("stage='won'")) return { rows: [{ cnt: String(deals) }] };
    if (sql.includes('demo_count > 0')) return { rows: [{ cnt: String(demos) }] };
    if (sql.includes('FROM sales_leads WHERE owner_username')) return { rows: [{ cnt: String(newLeads) }] };
    if (sql.includes('FROM sales_training_sessions')) return { rows: trainingRows };
    if (sql.includes('INSERT INTO sales_kpi_scores')) return { rows: [savedScore] };
    return { rows: [] };
  });
}

test('listSalesReps returns rows ordered by display_name', async () => {
  const calls = [];
  const pool = mockPool((sql, params) => {
    calls.push({ sql, params });
    assert.match(sql, /FROM sales_reps/);
    return { rows: [SAMPLE_REP, { ...SAMPLE_REP, id: 2, display_name: '李四', rep_key: 'lisi' }] };
  });
  const rows = await listSalesReps(pool, { status: 'active' });
  assert.equal(rows.length, 2);
  assert.equal(calls[0].params[0], 'active');
});

test('listSalesReps with empty status passes blank filter', async () => {
  const pool = mockPool((sql, params) => {
    assert.equal(params[0], '');
    return { rows: [SAMPLE_REP] };
  });
  const rows = await listSalesReps(pool);
  assert.equal(rows.length, 1);
});

test('createOrUpdateSalesRep upserts and returns row', async () => {
  const pool = mockPool((sql, params) => {
    assert.match(sql, /INSERT INTO sales_reps/);
    assert.equal(params[0], 'zhangsan');
    assert.equal(params[1], '张三');
    assert.equal(params[2], 'sales');
    assert.equal(params[3], 'active');
    return { rows: [{ ...SAMPLE_REP, wecom_name: '张三企微' }] };
  });
  const row = await createOrUpdateSalesRep(pool, {
    repKey: 'zhangsan',
    displayName: '张三',
    role: 'sales',
    status: 'active',
    wecomName: '张三企微',
  });
  assert.equal(row.display_name, '张三');
  assert.equal(row.wecom_name, '张三企微');
});

test('computeDailyActivityForRep aggregates daily metrics', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('AVG(EXTRACT')) return { rows: [{ avg_minutes: '12.3456' }] };
    if (sql.includes('COUNT(DISTINCT m.lead_id)')) return { rows: [{ cnt: '3' }] };
    if (sql.includes('handoff_template_price_guard')) return { rows: [{ cnt: '2' }] };
    if (sql.includes("status <> 'done'")) return { rows: [{ cnt: '1' }] };
    if (sql.includes("status = 'done'")) return { rows: [{ cnt: '4' }] };
    if (sql.includes("direction = 'outbound'") && sql.includes('COUNT(*)')) return { rows: [{ cnt: '5' }] };
    return { rows: [{ cnt: '0' }] };
  });
  const result = await computeDailyActivityForRep(pool, 'zhangsan', '2026-07-20');
  assert.deepEqual(result, {
    replies_sent: 5,
    avg_response_minutes: 12.35,
    leads_touched: 3,
    tasks_completed: 4,
    overdue_tasks: 1,
    price_guard_triggers: 2,
  });
});

test('computeDailyActivityForRep returns null avg when no response data', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('AVG(EXTRACT')) return { rows: [{ avg_minutes: null }] };
    if (sql.includes('COUNT(DISTINCT')) return { rows: [{ cnt: '0' }] };
    return { rows: [{ cnt: '0' }] };
  });
  const result = await computeDailyActivityForRep(pool, 'zhangsan', '2026-07-20');
  assert.equal(result.avg_response_minutes, null);
});

test('runDailyActivityRollup upserts activity for active reps', async () => {
  const upserts = [];
  const pool = mockPool((sql, params) => {
    if (sql.includes('FROM sales_reps')) {
      return { rows: [SAMPLE_REP, { ...SAMPLE_REP, id: 2, rep_key: 'lisi', display_name: '李四' }] };
    }
    if (sql.includes('AVG(EXTRACT')) return { rows: [{ avg_minutes: '20' }] };
    if (sql.includes('COUNT(DISTINCT')) return { rows: [{ cnt: '2' }] };
    if (sql.includes('handoff_template_price_guard')) return { rows: [{ cnt: '0' }] };
    if (sql.includes("status <> 'done'")) return { rows: [{ cnt: '0' }] };
    if (sql.includes("status = 'done'")) return { rows: [{ cnt: '1' }] };
    if (sql.includes("direction = 'outbound'") && sql.includes('COUNT(*)')) return { rows: [{ cnt: '3' }] };
    if (sql.includes('INSERT INTO sales_daily_activity')) {
      upserts.push({ repId: params[0], day: params[1], replies: params[2] });
      return { rows: [{ rep_id: params[0], activity_date: params[1], replies_sent: params[2] }] };
    }
    return { rows: [] };
  });
  const results = await runDailyActivityRollup(pool, { dateStr: '2026-07-20' });
  assert.equal(results.length, 2);
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].day, '2026-07-20');
  assert.equal(upserts[0].replies, 3);
});

test('upsertKpiTarget inserts target row', async () => {
  const pool = mockPool((sql, params) => {
    assert.match(sql, /INSERT INTO sales_kpi_targets/);
    assert.deepEqual(params.slice(0, 4), [1, 'week', '2026-W30', 10]);
    return { rows: [SAMPLE_TARGET] };
  });
  const row = await upsertKpiTarget(pool, {
    repId: 1,
    periodType: 'week',
    periodKey: '2026-W30',
    targetNewLeads: 10,
    targetDemos: 5,
    targetDeals: 2,
    targetRevenueFen: 100000,
    createdBy: 'admin',
  });
  assert.equal(row.target_new_leads, 10);
});

test('computeAndSaveKpiScore week period computes and saves score', async () => {
  const pool = kpiScorePool({
    periodType: 'week',
    periodKey: '2026-W30',
    savedScore: {
      rep_id: 1,
      period_type: 'week',
      period_key: '2026-W30',
      behavior_score: 71.25,
      outcome_score: 60,
      manager_score: 85,
      final_score: 68.5,
      manager_comment: '表现稳定',
    },
  });
  const row = await computeAndSaveKpiScore(pool, {
    repId: 1,
    periodType: 'week',
    periodKey: '2026-W30',
    managerScore: 85,
    managerComment: '表现稳定',
  });
  assert.equal(row.period_type, 'week');
  assert.equal(row.period_key, '2026-W30');
  assert.equal(row.manager_score, 85);
  assert.equal(row.manager_comment, '表现稳定');
  assert.ok(row.behavior_score > 0);
  assert.ok(row.outcome_score >= 0);
  assert.ok(row.final_score > 0);
});

test('computeAndSaveKpiScore month period computes and saves score', async () => {
  const monthTarget = {
    ...SAMPLE_TARGET,
    period_type: 'month',
    period_key: '2026-07',
    target_new_leads: 20,
    target_demos: 10,
    target_deals: 4,
  };
  const pool = kpiScorePool({
    target: monthTarget,
    periodType: 'month',
    periodKey: '2026-07',
    newLeads: 20,
    demos: 10,
    deals: 4,
    savedScore: {
      rep_id: 1,
      period_type: 'month',
      period_key: '2026-07',
      behavior_score: 75,
      outcome_score: 100,
      manager_score: null,
      final_score: 80,
      manager_comment: null,
    },
  });
  const row = await computeAndSaveKpiScore(pool, {
    repId: 1,
    periodType: 'month',
    periodKey: '2026-07',
  });
  assert.equal(row.period_type, 'month');
  assert.equal(row.period_key, '2026-07');
  assert.equal(row.outcome_score, 100);
});

test('computeAndSaveKpiScore handles missing rep_key with zero outcomes', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_kpi_targets')) return { rows: [SAMPLE_TARGET] };
    if (sql.includes('FROM sales_reps WHERE id')) return { rows: [] };
    if (sql.includes('FROM sales_daily_activity')) return { rows: [] };
    if (sql.includes('INSERT INTO sales_kpi_scores')) {
      return {
        rows: [{
          rep_id: 1,
          period_type: 'week',
          period_key: '2026-W30',
          behavior_score: 0,
          outcome_score: 0,
          manager_score: null,
          final_score: 0,
          manager_comment: null,
        }],
      };
    }
    return { rows: [] };
  });
  const row = await computeAndSaveKpiScore(pool, {
    repId: 1,
    periodType: 'week',
    periodKey: '2026-W30',
  });
  assert.equal(row.outcome_score, 0);
  assert.equal(row.behavior_score, 0);
});

test('getRepScorecard week period returns assembled payload', async () => {
  const pool = mockPool((sql, _params) => {
    if (sql.includes('FROM sales_reps WHERE id')) return { rows: [SAMPLE_REP] };
    if (sql.includes('FROM sales_kpi_targets')) return { rows: [SAMPLE_TARGET] };
    if (sql.includes('FROM sales_kpi_scores')) {
      return {
        rows: [{
          rep_id: 1,
          period_type: 'week',
          period_key: '2026-W30',
          final_score: 68,
        }],
      };
    }
    if (sql.includes('FROM sales_daily_activity')) return { rows: SAMPLE_DAILY_ROWS };
    return { rows: [] };
  });
  const card = await getRepScorecard(pool, 1, 'week', '2026-W30');
  assert.equal(card.ok, true);
  assert.equal(card.rep.rep_key, 'zhangsan');
  assert.equal(card.target.period_key, '2026-W30');
  assert.equal(card.score.final_score, 68);
  assert.equal(card.daily_activity.length, 2);
  assert.deepEqual(card.period_range, { start: '2026-07-20', end: '2026-07-26' });
});

test('getRepScorecard month period returns assembled payload', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_reps WHERE id')) return { rows: [SAMPLE_REP] };
    if (sql.includes('FROM sales_kpi_targets')) {
      return { rows: [{ ...SAMPLE_TARGET, period_type: 'month', period_key: '2026-07' }] };
    }
    if (sql.includes('FROM sales_kpi_scores')) {
      return {
        rows: [{
          rep_id: 1,
          period_type: 'month',
          period_key: '2026-07',
          final_score: 80,
        }],
      };
    }
    if (sql.includes('FROM sales_daily_activity')) return { rows: SAMPLE_DAILY_ROWS };
    return { rows: [] };
  });
  const card = await getRepScorecard(pool, 1, 'month', '2026-07');
  assert.equal(card.ok, true);
  assert.equal(card.target.period_key, '2026-07');
  assert.deepEqual(card.period_range, { start: '2026-07-01', end: '2026-07-31' });
});

test('getTeamLeaderboard returns sorted score rows', async () => {
  const pool = mockPool((sql, params) => {
    assert.match(sql, /JOIN sales_kpi_scores/);
    assert.deepEqual(params, ['week', '2026-W30']);
    return {
      rows: [
        { rep_id: 1, rep_key: 'zhangsan', display_name: '张三', final_score: 90 },
        { rep_id: 2, rep_key: 'lisi', display_name: '李四', final_score: 75 },
      ],
    };
  });
  const rows = await getTeamLeaderboard(pool, { periodType: 'week', periodKey: '2026-W30' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].final_score, 90);
});

test('runAutoKpiRollupAndNotify computes scores and sends alert', async () => {
  let alertCalls = 0;
  let alertBody = '';
  const sendOpsAlert = async (body, meta) => {
    alertCalls += 1;
    alertBody = body;
    assert.equal(meta.audience, 'sales');
    assert.match(meta.title, /周度KPI结算/);
  };

  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_reps')) {
      return { rows: [SAMPLE_REP, { ...SAMPLE_REP, id: 2, rep_key: 'lisi', display_name: '李四' }] };
    }
    if (sql.includes('FROM sales_kpi_targets')) return { rows: [SAMPLE_TARGET] };
    if (sql.includes('FROM sales_reps WHERE id')) return { rows: [{ rep_key: 'zhangsan' }] };
    if (sql.includes('FROM sales_daily_activity')) return { rows: SAMPLE_DAILY_ROWS };
    if (sql.includes("stage='won'")) return { rows: [{ cnt: '1' }] };
    if (sql.includes('demo_count > 0')) return { rows: [{ cnt: '4' }] };
    if (sql.includes('FROM sales_leads WHERE owner_username')) return { rows: [{ cnt: '8' }] };
    if (sql.includes('FROM sales_training_sessions')) return { rows: [{ avg_score: 80 }] };
    if (sql.includes('INSERT INTO sales_kpi_scores')) {
      const repId = sql.includes('$1') ? 1 : 1;
      return {
        rows: [{
          rep_id: repId,
          behavior_score: 70,
          outcome_score: 60,
          final_score: repId === 1 ? 65 : 55,
          display_name: repId === 1 ? '张三' : '李四',
        }],
      };
    }
    return { rows: [] };
  });

  const out = await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'week');
  assert.equal(out.period_type, 'week');
  assert.match(out.period_key, /^\d{4}-W\d{2}$/);
  assert.equal(out.results.length, 2);
  assert.equal(alertCalls, 1);
  assert.match(alertBody, /销售AI·周度KPI自动结算/);
  assert.match(alertBody, /张三/);
});
