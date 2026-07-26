import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWithin3DaysAndSameMonth,
  getRoleLabelZh,
  formatShanghaiYmdChinese,
} from '../helpers.js';
import {
  listPerformanceRecords,
  invalidatePerformanceRecord,
} from '../service.js';

function makePool(handler) {
  return {
    query: async (sql, params) => {
      if (handler) return handler(sql, params);
      return { rows: [], rowCount: 0 };
    },
  };
}

function baseCtx(overrides = {}) {
  return {
    pool: overrides.pool || makePool(),
    calculateEmployeeScore: overrides.calculateEmployeeScore || (async () => ({
      total_score: 90,
      execution_rating: 'A',
      attitude_rating: 'A',
      ability_rating: 'A',
    })),
    getIncompleteTaskCount: overrides.getIncompleteTaskCount || (async () => 0),
    sendLarkCard: overrides.sendLarkCard || (async () => ({ ok: true })),
    sendLarkMessage: overrides.sendLarkMessage || (async () => ({ ok: true })),
    ...overrides.ctxExtra,
  };
}

test('helpers: isWithin3DaysAndSameMonth / getRoleLabelZh / formatShanghaiYmdChinese', () => {
  assert.equal(isWithin3DaysAndSameMonth(new Date()), true);
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  assert.equal(isWithin3DaysAndSameMonth(fourDaysAgo), false);

  assert.equal(getRoleLabelZh('store_manager'), '店长');
  assert.equal(getRoleLabelZh('store_production_manager'), '出品经理');
  assert.equal(getRoleLabelZh('front_manager'), '前厅经理');
  assert.equal(getRoleLabelZh(''), '—');

  const zh = formatShanghaiYmdChinese('2026-07-15T08:00:00+08:00');
  assert.match(zh, /2026年7月15日/);
});

test('listPerformanceRecords: period_required', async () => {
  const result = await listPerformanceRecords(baseCtx(), {
    username: 'alice',
    period: '',
    tenantId: 'default',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'period_required');
});

test('listPerformanceRecords: empty weekly/master_tasks → real data fields', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const result = await listPerformanceRecords(baseCtx({ pool }), {
    username: 'alice',
    period: '2026-07',
    tenantId: 'default',
  });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.deepEqual(result.data.weekly_scores, []);
  assert.deepEqual(result.data.filings, []);
  assert.deepEqual(result.data.invalidations, []);
  assert.deepEqual(result.data.daily_bi_triggers, []);
  assert.deepEqual(result.data.employee_monthly_scores, []);
});

test('invalidatePerformanceRecord: missing_fields', async () => {
  const result = await invalidatePerformanceRecord(baseCtx(), {
    source_type: 'agent_scores_weekly',
    source_id: '',
    username: 'alice',
    period: '2026-07',
    actorUsername: 'admin1',
    tenantId: 'default',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'missing_fields');
});

test('invalidatePerformanceRecord: agent_scores_weekly success path', async () => {
  const ops = [];
  const recent = new Date().toISOString();
  const pool = makePool(async (sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/^BEGIN$/i.test(s.trim())) {
      ops.push('BEGIN');
      return { rows: [] };
    }
    if (/^COMMIT$/i.test(s.trim())) {
      ops.push('COMMIT');
      return { rows: [] };
    }
    if (/SELECT id, created_at FROM agent_scores/i.test(s)) {
      ops.push('SELECT_AGENT');
      return { rows: [{ id: params[0], created_at: recent }] };
    }
    if (/SELECT 1 FROM performance_invalidation_records/i.test(s)) {
      ops.push('DUP_CHK');
      return { rows: [] };
    }
    if (/SELECT total_score, execution_rating FROM employee_scores/i.test(s)
      || /FROM employee_scores/i.test(s)) {
      ops.push('EMP_BEFORE');
      return {
        rows: [{
          total_score: 80,
          execution_rating: 'B',
          attitude_rating: 'B',
          ability_rating: 'B',
        }],
      };
    }
    if (/UPDATE agent_scores SET is_invalidated/i.test(s)) {
      ops.push('UPDATE_AGENT');
      assert.equal(params[0], '42');
      assert.equal(params[1], 'default');
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO performance_invalidation_records/i.test(s)) {
      ops.push('INSERT_INV');
      assert.equal(params[0], 'agent_scores_weekly');
      assert.equal(params[1], '42');
      assert.equal(params[2], 'alice');
      return { rows: [], rowCount: 1 };
    }
    if (/FROM feishu_users/i.test(s) && /display_name|COALESCE\(NULLIF\(TRIM\(name\)/i.test(s)) {
      ops.push('FEISHU_USER');
      return {
        rows: [{
          store: '马己仙路店',
          role: 'store_manager',
          display_name: 'Alice',
          name: 'Alice',
          open_id: null,
        }],
      };
    }
    if (/SELECT summary, deductions FROM agent_scores/i.test(s)) {
      return { rows: [{ summary: '周度扣分', deductions: [] }] };
    }
    if (/INSERT INTO hrms_user_notifications/i.test(s)) {
      ops.push('NOTIF');
      return { rows: [] };
    }
    if (/SELECT open_id FROM feishu_users/i.test(s)) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  const result = await invalidatePerformanceRecord(
    baseCtx({
      pool,
      calculateEmployeeScore: async () => ({
        total_score: 90,
        execution_rating: 'A',
        attitude_rating: 'A',
        ability_rating: 'A',
      }),
      sendLarkCard: async () => ({ ok: true }),
      sendLarkMessage: async () => ({ ok: true }),
    }),
    {
      source_type: 'agent_scores_weekly',
      source_id: '42',
      username: 'alice',
      store: '马己仙路店',
      period: '2026-07',
      actorUsername: 'admin1',
      tenantId: 'default',
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.invalidated, {
    source_type: 'agent_scores_weekly',
    source_id: '42',
    username: 'alice',
    period: '2026-07',
  });
  assert.equal(result.data.before.total_score, 80);
  assert.equal(result.data.after.total_score, 90);
  assert.equal(result.data.changed, true);
  assert.equal(result.data.recalc_failed, false);
  assert.ok(ops.includes('UPDATE_AGENT'));
  assert.ok(ops.includes('INSERT_INV'));
  assert.ok(ops.includes('COMMIT'));
});

test('invalidatePerformanceRecord: out_of_invalidation_window (>3 days)', async () => {
  const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  let rolledBack = false;
  const pool = makePool(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/^BEGIN$/i.test(s.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(s.trim())) {
      rolledBack = true;
      return { rows: [] };
    }
    if (/SELECT id, created_at FROM agent_scores/i.test(s)) {
      return { rows: [{ id: '99', created_at: old }] };
    }
    return { rows: [] };
  });

  const result = await invalidatePerformanceRecord(baseCtx({ pool }), {
    source_type: 'agent_scores_weekly',
    source_id: '99',
    username: 'alice',
    period: '2026-07',
    actorUsername: 'admin1',
    tenantId: 'default',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'out_of_invalidation_window');
  assert.match(result.message, /3天/);
  assert.equal(rolledBack, true);
});
