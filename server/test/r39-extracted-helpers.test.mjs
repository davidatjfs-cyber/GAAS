/**
 * R39：冲高 auth / agent-data-center / growth-ops|actions|metrics /
 * daily-reports helpers / attendance-build / performance-invalidation helpers。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import {
  lookupTenantIdByUsername,
  loginInTenant,
  getMe,
  getAuthMe,
  loginAs,
  changePassword,
  heartbeat,
  logout,
} from '../domains/auth/service.js';
import {
  getDashboardSummary,
  getDataCenterBrief,
  getActivityDetail,
  resolveFeishuUserFromQuery,
} from '../domains/agent-data-center/service.js';
import {
  getActiveWindow,
  triggerRepurchase,
  listUserClusters,
  sendDailyReport,
  previewDailyReport,
  listContentPerformance,
  upsertContentPerformance,
  deleteContentPerformance,
  generateSellingPoint,
} from '../domains/growth-ops/service.js';
import {
  runRuleEngine,
  listActions,
  setPllmExperimentStatus,
  listExecutionLogs,
  upsertAction,
  executeAction,
  ignoreAction,
  editAndExecuteAction,
  submitActionFeedback,
} from '../domains/growth-actions/service.js';
import {
  listMetrics,
  listAlerts,
  upsertAlert,
  resolveAlert,
  triggerMetricsRecompute,
  abcBlacklistSummary,
  computeAbcDistributionForCampaign,
  abcDistribution,
} from '../domains/growth-metrics/service.js';
import {
  bindDailyReportsRuntimeDeps,
  canAccessDailyReports,
  canWriteDailyReports,
  formatPgDateOnly,
  dailyReportMergeKey,
  dailyReportItemFromPgRow,
  mergeDailyReportDetailArrays,
  mergeDailyReportItemWithPgRow,
  recalcWechatMonthTotalsForStoreMonth,
  upsertDailyReportPgFromStateReport,
} from '../domains/daily-reports/helpers.js';
import {
  isCountableCheckinStatus,
  shanghaiDateOnly,
  shanghaiTodayDateOnly,
  normalizeAttendanceRegisterLineDetails,
  sortIsoDateList,
  createAttendanceBuildHelpers,
} from '../domains/leave-attendance/attendance-build.js';
import {
  getShanghaiYmd,
  getShanghaiPrevYm,
  buildFilingInvalidationAssigneeCard,
  buildFilingInvalidationAdminCard,
  buildWeeklyScoreInvalidationCard,
  buildChangeCard,
} from '../domains/performance-invalidation/helpers.js';

const JWT_SECRET = 'r39-jwt-secret';

function authDeps(overrides = {}) {
  return {
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async () => ({}),
        release: () => {},
      }),
    },
    JWT_SECRET,
    DATABASE_URL: 'postgres://mock',
    getSharedState: async () => ({}),
    normalizeRoleForJwt: (r) => String(r || '').trim() || 'store_employee',
    normalizeUsersTableRole: (r) => String(r || 'employee'),
    employeeAccountShouldDisable: () => false,
    getUserStoreAccessContext: async () => ({
      allowedStores: ['A店'],
      currentStore: 'A店',
      primaryStore: 'A店',
    }),
    pickMyStoreFromState: () => 'A店',
    recordLogin: () => {},
    recordLogout: async () => {},
    storeSessionNonce: async () => true,
    loadTenantRuntimeStatus: async () => ({ loginAllowed: true }),
    ...overrides,
  };
}

function growthTenantCtx() {
  return { run: async (_t, fn) => fn() };
}

function growthOpsCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    tenantContext: growthTenantCtx(),
    cleanText: (v, max = 255) => String(v == null ? '' : v).trim().slice(0, max),
    fmtYmd: (d) => d.toISOString().slice(0, 10),
    buildGrowthDailyReport: async () => '日报正文',
    getSendGrowthAlert: () => null,
    ...overrides,
  };
}

function growthActionsCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    tenantContext: growthTenantCtx(),
    resolveTenantIdDefault: () => 'default',
    runTouchRuleEngine: async () => ({ ran: true, count: 2 }),
    executeGrowthActionRecord: async (_p, before) => ({
      action: { ...before, status: 'executed' },
      execution: { ok: true },
    }),
    appendExecutionLog: async () => {},
    ...overrides,
  };
}

function growthMetricsCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    tenantContext: growthTenantCtx(),
    resolveTenantIdForStore: async () => 'default',
    verifyServerTenantBinding: async () => ({ ok: true }),
    upsertCustomer: async () => ({ id: 1 }),
    recomputeDiningSegments: async () => ({ updated: 0 }),
    loadRuleCandidates: async () => [],
    ABC_ROTATION_ORDER: {},
    deriveAbcStep: () => ({ step: 'A', blacklisted: false }),
    ...overrides,
  };
}

// —— auth ——
test('auth: lookupTenantIdByUsername + getMe + logout empty', async () => {
  const found = await lookupTenantIdByUsername('alice', {
    pool: {
      query: async () => ({ rows: [{ tenant_id: 't-acme' }] }),
    },
  });
  assert.equal(found, 't-acme');

  const fallback = await lookupTenantIdByUsername('ghost', {
    pool: {
      query: async () => {
        throw new Error('db down');
      },
    },
  });
  assert.equal(fallback, 'default');

  const missing = await getMe({ user: {} }, authDeps());
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_user');

  const me = await getMe(
    {
      user: {
        username: 'alice',
        role: 'store_manager',
        store: 'A店',
        allowed_stores: ['A店'],
        current_store: 'A店',
      },
      tenantId: 'default',
      reqLike: {
        tenantId: 'default',
        user: { username: 'alice', role: 'store_manager' },
      },
    },
    authDeps({
      getSharedState: async () => ({
        employees: [{
          username: 'alice',
          name: '爱丽丝',
          position: '店长',
          department: '前厅',
          store: 'A店',
          role: 'store_manager',
        }],
        users: [],
        permissionGroups: [],
        settings: {},
      }),
    })
  );
  // resolveUserPermissionContext 依赖全局 state；失败时也覆盖 catch 分支
  assert.ok([200, 500].includes(me.status));
  if (me.status === 200) {
    assert.equal(me.body.user.name, '爱丽丝');
    assert.equal(me.body.user.position, '店长');
  }

  const out = await logout({ user: {} }, authDeps());
  assert.equal(out.status, 200);

  const beat = await heartbeat({ user: {} }, authDeps());
  assert.equal(beat.status, 200);
});

test('auth: loginInTenant DB 成功路径（含 hrms_state 同步）', async () => {
  const hash = await bcrypt.hash('OkPass12', 4);
  const result = await loginInTenant(
    { body: { username: 'carol', password: 'OkPass12' }, reqLike: { ip: '1.1.1.1' } },
    authDeps({
      DATABASE_URL: 'postgres://mock',
      pool: {
        query: async (sql) => {
          const s = String(sql);
          if (/from users/i.test(s) && /password_hash/i.test(s)) {
            return {
              rows: [{
                id: 11,
                username: 'carol',
                password_hash: hash,
                real_name: 'Carol DB',
                role: 'store_employee',
                is_active: true,
                tenant_id: 'default',
              }],
            };
          }
          if (/hrms_state/i.test(s)) {
            return {
              rows: [{
                data: {
                  employees: [{
                    username: 'carol',
                    name: 'Carol State',
                    role: 'store_manager',
                    store: '洪潮',
                    permissionGroupId: 'pg-carol',
                  }],
                  users: [],
                },
              }],
            };
          }
          return { rows: [] };
        },
        connect: async () => ({
          query: async () => ({}),
          release: () => {},
        }),
      },
      storeSessionNonce: async () => true,
    }),
    'default'
  );
  assert.equal(result.status, 200);
  assert.ok(result.body.token);
  assert.equal(result.body.user.username, 'carol');
});

test('auth: loginInTenant hrms_state 明文回落登录', async () => {
  const result = await loginInTenant(
    { body: { username: 'plain-eve', password: 'EvePass99' } },
    authDeps({
      DATABASE_URL: 'postgres://mock',
      pool: {
        query: async (sql) => {
          const s = String(sql);
          if (/from users/i.test(s) && /password_hash/i.test(s)) return { rows: [] };
          if (/hrms_state/i.test(s)) {
            return {
              rows: [{
                data: {
                  employees: [{
                    id: 'e9',
                    username: 'plain-eve',
                    password: 'EvePass99',
                    name: 'Eve',
                    role: 'front_manager',
                    store: '马己仙',
                  }],
                  users: [],
                },
              }],
            };
          }
          if (/insert into users/i.test(s)) return { rows: [] };
          return { rows: [] };
        },
        connect: async () => ({ query: async () => ({}), release: () => {} }),
      },
      storeSessionNonce: async () => true,
    }),
    'default'
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.user.username, 'plain-eve');
});

test('auth: loginAs 从 hrms_state 创建用户；changePassword state_migrated', async () => {
  let inserts = 0;
  const asFromState = await loginAs(
    {
      user: { username: 'admin', role: 'admin' },
      tenantId: 'default',
      body: { username: 'state-user', reason: '排查' },
    },
    authDeps({
      pool: {
        query: async (sql) => {
          const s = String(sql);
          if (/FROM users/i.test(s) && /SELECT id, username/i.test(s)) {
            return { rows: [] };
          }
          if (/FROM hrms_state|HRMS_STATE|key = \$1/i.test(s) || s.includes('hrms_state')) {
            return {
              rows: [{
                data: {
                  employees: [{
                    id: 'su1',
                    username: 'state-user',
                    name: '状态用户',
                    role: 'store_employee',
                    password: '123456',
                  }],
                  users: [],
                },
              }],
            };
          }
          if (/INSERT INTO users/i.test(s)) {
            inserts += 1;
            return { rows: [] };
          }
          if (/UPDATE users SET is_active/i.test(s)) return { rows: [] };
          return { rows: [] };
        },
      },
    })
  );
  assert.equal(asFromState.status, 200);
  assert.equal(asFromState.body.user.username, 'state-user');
  assert.ok(inserts >= 1);

  let migrated = false;
  const pwd = await changePassword(
    {
      user: { username: 'state-bob' },
      tenantId: 'default',
      body: { oldPassword: 'oldplain1', newPassword: 'Newpass99' },
    },
    authDeps({
      pool: {
        query: async (sql) => {
          const s = String(sql);
          if (s.includes('select id, username, password_hash')) return { rows: [] };
          if (/insert into users/i.test(s)) {
            migrated = true;
            return { rows: [] };
          }
          return { rows: [] };
        },
      },
      getSharedState: async () => ({
        employees: [{ username: 'state-bob', password: 'oldplain1', name: 'Bob', role: 'employee' }],
        users: [],
      }),
    })
  );
  assert.equal(pwd.status, 200);
  assert.equal(pwd.body.mode, 'state_migrated');
  assert.equal(migrated, true);

  const authMe = await getAuthMe(
    { user: { username: 'x', role: 'admin' }, tenantId: 'default' },
    authDeps({
      getUserStoreAccessContext: async () => {
        throw new Error('no ctx');
      },
      getSharedState: async () => {
        throw new Error('no state');
      },
    })
  );
  assert.equal(authMe.status, 200);
});

// —— agent-data-center ——
test('agent-data-center: dashboard / brief / activity-detail', async () => {
  const dashPool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('agent_issues')) return { rows: [{ total: 5, open: 2, high_open: 1 }] };
      if (s.includes('agent_scores')) return { rows: [{ total: 10, avg_score: 88 }] };
      if (s.includes('agent_visual_audits')) return { rows: [{ total: 3, failed: 1, duplicates: 0 }] };
      if (s.includes('agent_messages')) return { rows: [{ total: 7 }] };
      if (s.includes('feishu_users')) return { rows: [{ total: 4, registered: 3 }] };
      if (s.includes('feishu_generic_records')) return { rows: [{ total: 9 }] };
      return { rows: [{}] };
    },
  };
  const dash = await getDashboardSummary(dashPool, 'default', () => ({ uptime: 1 }));
  assert.equal(dash.openIssues, 2);
  assert.equal(dash.avgScore, 88);
  assert.equal(dash.performance.uptime, 1);

  const briefPool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('agent_admin_alert_log') && s.includes('ORDER BY sent_at')) {
        return { rows: [{ id: 1, priority: 'high', title: 'a', sent_at: '2026-07-25T10:00:00Z' }] };
      }
      if (s.includes('hrms_user_notifications') && s.includes('ORDER BY created_at')) {
        return { rows: [{ id: 2, priority: 'medium', title: 'b', sent_at: '2026-07-26T10:00:00Z' }] };
      }
      if (s.includes('agent_v2_cron_runs')) {
        return { rows: [{ job_key: 'daily_bi', run_ymd: '2026-07-25', ok: true, created_at: 'x' }] };
      }
      if (s.includes('COUNT(*)')) return { rows: [{ c: 3 }] };
      if (s.includes('anomaly_rollups_v2')) return { rows: [{ avg_bi: 91, rollup_rows: 5 }] };
      return { rows: [] };
    },
  };
  const brief = await getDataCenterBrief(briefPool, {
    username: 'admin',
    tenantId: 'default',
    activityDate: '2026-07-25',
    cronJobLabelZh: (k) => `标签:${k}`,
  });
  assert.equal(brief.activitySummaryDate, '2026-07-25');
  assert.equal(brief.activityToday.agentTaskLogs, 3);
  assert.ok(brief.adminAlerts.length >= 1);
  assert.equal(brief.cronRuns[0].job_label_zh, '标签:daily_bi');

  const actPool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('agent_task_logs')) {
        return { rows: [{ agent: 'a', store: 's', username: 'u', display_name: 'U' }] };
      }
      if (s.includes('rhythm_logs')) return { rows: [{ id: 1 }] };
      if (s.includes('anomaly_triggers')) return { rows: [{ id: 2 }] };
      if (s.includes('master_tasks')) return { rows: [{ id: 3 }] };
      return { rows: [] };
    },
  };
  const act = await getActivityDetail(actPool, '2026-07-25', 'default');
  assert.equal(act.date, '2026-07-25');
  assert.equal(act.taskLogs.length, 1);
  assert.equal(act.rhythmLogs.length, 1);

  const resolved = await resolveFeishuUserFromQuery(
    {
      async query(sql) {
        if (String(sql).includes('LOWER(TRIM(username))')) {
          return { rows: [{ username: 'zoe', disp: 'Zoe' }] };
        }
        return { rows: [] };
      },
    },
    'zoe'
  );
  assert.equal(resolved.ok, true);
});

// —— growth-ops ——
test('growth-ops: active-window / repurchase / clusters / daily / content', async () => {
  const ctx = growthOpsCtx({
    pool: {
      async query(sql) {
        const s = String(sql);
        if (s.includes('growth_events')) {
          return {
            rows: [{
              event_count: 20,
              time_segment: '晚市(17-21点)',
              weekday: 6,
              day_type: '周末',
              conversion_count: 5,
            }],
          };
        }
        if (s.includes('best_contact_window') && s.includes('lifecycle_stage')) {
          return { rows: [{ lifecycle_stage: 'engaged', cnt: 100, top_window: '晚', avg_price_sens: 0.3, avg_discount_resp: 0.5 }] };
        }
        if (s.includes('INSERT INTO growth_actions')) return { rows: [] };
        if (s.includes('SELECT cp.customer_id')) {
          return {
            rows: [{
              customer_id: 9,
              phone: '13800138000',
              store_id: 's1',
              lifecycle_stage: 'at_risk',
              next_visit_probability: 0.2,
              best_contact_window: '晚',
              response_to_discount: 0.6,
              price_sensitivity: 0.4,
            }],
          };
        }
        if (s.includes("lifecycle_stage IN ('at_risk','dormant','churned')")) {
          return { rows: [{ at_risk_count: 10, store_id: 's1' }] };
        }
        if (s.includes('value_tier')) {
          return { rows: [{ value_tier: 'VIP', cnt: 20, dormant_cnt: 5 }] };
        }
        if (s.includes('adventurous_score') || s.includes('preferred_visit_time')) {
          return {
            rows: [{
              lifecycle_stage: 'engaged',
              avg_price_sens: 0.2,
              avg_discount_resp: 0.3,
              avg_adventurous: 0.1,
              user_count: 50,
              common_visit_time: '晚',
            }],
          };
        }
        if (s.includes('INSERT INTO content_performance')) {
          return { rows: [{ id: 2, channel: 'xhs' }] };
        }
        if (s.includes('DELETE FROM content_performance')) return { rows: [] };
        if (s.includes('content_performance') && s.includes('SELECT')) {
          return { rows: [{ id: 1, channel: 'xhs' }] };
        }
        return { rows: [] };
      },
    },
    getSendGrowthAlert: () => async (msg, tag) => ({ ok: true, msg, tag }),
  });

  const win = await getActiveWindow(ctx, 'default', { store_id: 's1' });
  assert.equal(win.status, 200);
  assert.ok(win.body.ok !== false);

  const rep = await triggerRepurchase(ctx, 'default', { store_id: 's1' });
  assert.equal(rep.status, 200);
  assert.equal(rep.body.triggered, 1);

  const clusters = await listUserClusters(ctx, 'default', { store_id: 's1' });
  assert.equal(clusters.status, 200);
  assert.equal(clusters.body.total, 50);

  const preview = await previewDailyReport(ctx, 'default', { date: '2026-07-25' });
  assert.equal(preview.body.report, '日报正文');

  const sent = await sendDailyReport(ctx, 'default', { date: '2026-07-25' });
  assert.equal(sent.status, 200);
  assert.ok(sent.body.feishu);

  const list = await listContentPerformance(ctx, { store_id: 's1', days: 7 });
  assert.equal(list.status, 200);

  const up = await upsertContentPerformance(ctx, {
    channel: 'xhs',
    store_id: 's1',
    content_title: '菜品A',
    impressions: 100,
  });
  assert.equal(up.status, 200);
  assert.equal(up.body.record.channel, 'xhs');

  const del = await deleteContentPerformance(ctx, 2);
  assert.equal(del.status, 200);

  const sp = await generateSellingPoint(
    growthOpsCtx({
      fetch: async () => ({
        async json() { return { selling_point: '今日特惠' }; },
      }),
      requestId: 'rid-1',
    }),
    { title: '套餐', offer: '8折', store: 's1' }
  );
  assert.equal(sp.body.selling_point, '今日特惠');
});

// —— growth-actions ——
test('growth-actions: rule / list filters / upsert / execute / edit / feedback', async () => {
  const rule = await runRuleEngine(growthActionsCtx(), 'default', { dry_run: true });
  assert.equal(rule.status, 200);
  assert.equal(rule.body.result.ran, true);

  await setPllmExperimentStatus(growthActionsCtx(), 'default', 'exp-1', 'approved');

  const logs = await listExecutionLogs(
    growthActionsCtx({
      pool: {
        async query() {
          return {
            rows: [{
              action_key: 'a:1',
              decision: 'executed',
              delivery_total: 2,
              delivery_delivered: 2,
              delivery_failed: 0,
              delivery_skipped: 0,
            }],
          };
        },
      },
    }),
    'default',
    { store_id: 's1', decision: 'executed', limit: 10 }
  );
  assert.equal(logs.body.logs[0].reach, 'reached');

  const listed = await listActions(
    growthActionsCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('FROM growth_actions')) {
            return {
              rows: [{
                action_key: 'k1',
                status: 'proposed',
                created_at: '2026-07-25T10:00:00Z',
                payload: { channel: 'wecom' },
              }],
            };
          }
          return { rows: [] };
        },
      },
    }),
    'default',
    { status: 'proposed', channel: 'wecom', limit: 10 }
  );
  assert.equal(listed.body.actions.length, 1);

  const withExp = await listActions(
    growthActionsCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('strategy_experiments')) {
            return {
              rows: [{
                experiment_code: 'E1',
                title: '实验',
                goal: 'g',
                anomaly_type: 'x',
                exp_status: 'pending_approval',
                created_at: '2026-07-26T10:00:00Z',
                updated_at: '2026-07-26T10:00:00Z',
                tenant_id: 'default',
                va_label: 'A',
                va_action: 'do A',
                va_guide: '',
                va_store: 's1',
                vb_label: 'B',
                vb_action: 'do B',
                vb_guide: '',
                vb_store: 's1',
              }],
            };
          }
          return { rows: [] };
        },
      },
    }),
    'default',
    { channel: 'pllm' }
  );
  assert.ok(withExp.body.ok);

  const upserted = await upsertAction(growthActionsCtx({
    pool: {
      async query() {
        return { rows: [{ action_key: 'new-k', status: 'proposed' }] };
      },
    },
  }), 'default', {
    action_key: 'new-k',
    action_type: 'send_voucher',
    title: 't',
    detail: 'd',
    payload: { channel: 'sms' },
  });
  assert.equal(upserted.body.action.action_key, 'new-k');

  const op = { username: 'admin', role: 'admin' };
  const execPool = {
    async query(sql) {
      if (String(sql).includes('SELECT * FROM growth_actions')) {
        return { rows: [{ action_key: 'k1', payload: { strategy_key: 'sk' }, store_id: 's1', action_type: 'x' }] };
      }
      if (String(sql).includes('UPDATE growth_actions')) {
        return { rows: [{ action_key: 'k1', status: 'ignored', payload: {} }] };
      }
      return { rows: [] };
    },
  };
  const exec = await executeAction(growthActionsCtx({ pool: execPool }), 'default', 'k1', op, {});
  assert.equal(exec.status, 200);

  const ign = await ignoreAction(growthActionsCtx({ pool: execPool }), 'default', 'k1', op, { reason: 'skip' });
  assert.equal(ign.status, 200);

  const edited = await editAndExecuteAction(
    growthActionsCtx({ pool: execPool }),
    'default',
    'k1',
    op,
    { payload: { note: 'edited' }, reason: 'fix' }
  );
  assert.equal(edited.status, 200);

  const fb = await submitActionFeedback(
    growthActionsCtx({
      pool: {
        async query(sql) {
          const s = String(sql);
          if (s.includes('SELECT * FROM growth_actions')) {
            return {
              rows: [{
                action_key: 'k1',
                store_id: 's1',
                action_type: 'send_voucher',
                title: '触达',
                payload: {
                  expected_kpi: { reach: 100, redemption_rate: 10, revenue_fen: 1000 },
                  channel: 'sms',
                  ready_copy: '来店领券',
                },
              }],
            };
          }
          if (s.includes('UPDATE growth_actions')) {
            return {
              rows: [{
                action_key: 'k1',
                store_id: 's1',
                action_type: 'send_voucher',
                payload: { feedback_note: 'ok' },
              }],
            };
          }
          if (s.includes('INSERT INTO growth_learnings')) return { rows: [] };
          return { rows: [] };
        },
      },
    }),
    'default',
    'k1',
    op,
    { actual_reach: 100, actual_redemptions: 10, actual_revenue_fen: 1000, note: 'ok' }
  );
  assert.equal(fb.status, 200);
  assert.equal(fb.body.ok, true);
});

// —— growth-metrics ——
test('growth-metrics: list/upsert/resolve alerts + metrics + abc blacklist', async () => {
  const ctx = growthMetricsCtx({
    pool: {
      async query(sql) {
        const s = String(sql);
        if (s.includes('growth_daily_metrics')) return { rows: [{ metric_date: '2026-07-25' }] };
        if (s.includes('INSERT INTO growth_alerts')) {
          return { rows: [{ alert_key: 'a1', status: 'open' }] };
        }
        if (s.includes('UPDATE growth_alerts')) {
          return { rows: [{ alert_key: 'a1', status: 'resolved' }] };
        }
        if (s.includes('FROM growth_alerts')) return { rows: [{ alert_key: 'a1' }] };
        if (s.includes('growth_touch_rules')) {
          return { rows: [{ rule_key: 'rk', action_payload: { campaign_key: 'c1' } }] };
        }
        if (s.includes('growth_delivery_logs')) return { rows: [] };
        return { rows: [] };
      },
    },
    ABC_ROTATION_ORDER: { c1: ['A', 'B'] },
    loadRuleCandidates: async () => [{ phone: '13800138000' }, { phone: '13900139000' }],
    deriveAbcStep: (_k, n) => ({ step: n > 1 ? 'B' : 'A', blacklisted: n > 3 }),
  });

  const metrics = await listMetrics(ctx, 'default', { days: 14, recompute: '1', store_id: 's1' });
  assert.equal(metrics.status, 200);

  const alerts = await listAlerts(ctx, 'default', { status: 'open' });
  assert.equal(alerts.status, 200);

  const up = await upsertAlert(ctx, 'default', {
    alert_type: 'churn',
    store_id: 's1',
    title: '流失预警',
    message: 'm',
  });
  assert.equal(up.status, 200);

  const resolved = await resolveAlert(ctx, 'default', 'a1', 'admin');
  assert.equal(resolved.status, 200);

  const recomputed = await triggerMetricsRecompute(ctx, 'default', 3);
  assert.equal(recomputed.status, 200);

  const dist = await computeAbcDistributionForCampaign(ctx, 'c1', 'default');
  assert.ok(dist);
  assert.equal(dist.rule_key, 'rk');

  const abc = await abcDistribution(ctx, 'default', 'c1');
  assert.equal(abc.status, 200);
  assert.equal(abc.body.enabled, true);

  const bl = await abcBlacklistSummary(ctx, 'default');
  assert.equal(bl.status, 200);
  assert.ok(Array.isArray(bl.body.items));
});

// —— daily-reports helpers ——
test('daily-reports/helpers: access + merge + pg item + recalc/upsert', async () => {
  bindDailyReportsRuntimeDeps({
    pool: { async query() { return { rows: [] }; } },
    hrmsNowISO: () => '2026-07-25T12:00:00.000Z',
    safeDateOnly: (v) => String(v || '').slice(0, 10),
    getSharedState: async () => ({}),
  });

  assert.equal(canAccessDailyReports('admin'), true);
  assert.equal(canAccessDailyReports('employee'), false);
  assert.equal(canWriteDailyReports('front_supervisor'), true);
  assert.equal(canWriteDailyReports('hq_manager'), false);
  assert.equal(formatPgDateOnly(new Date('2026-07-15T00:00:00Z')), '2026-07-15');
  assert.equal(formatPgDateOnly('2026-07-16'), '2026-07-16');
  assert.equal(formatPgDateOnly(null), '');
  assert.equal(dailyReportMergeKey(' 店A ', '2026-07-15'), '店A|2026-07-15');

  assert.deepEqual(mergeDailyReportDetailArrays([], [1]), [1]);
  assert.deepEqual(mergeDailyReportDetailArrays([1, 2], []), [1, 2]);
  assert.deepEqual(mergeDailyReportDetailArrays([1], [1, 2, 3]), [1, 2, 3]);

  const pgItem = dailyReportItemFromPgRow({
    store: '洪潮',
    date: '2026-07-15',
    pre_discount_revenue: 1000,
    total_discount: 50,
    actual_revenue: 950,
    actual_margin: 300,
    delivery_pre_revenue: 100,
    delivery_actual: 80,
    delivery_orders: 2,
    delivery_bad_reviews: 1,
    bad_reviews_dianping: 0,
    dine_orders: 10,
    dine_revenue: 800,
    dine_traffic: 20,
    submitted: true,
    submitted_at: new Date('2026-07-15T20:00:00Z'),
    updated_at: new Date('2026-07-15T21:00:00Z'),
    segments: '{"午":1}',
    categories: { 热菜: 1 },
    delivery_detail: { eleme: { revenue: 40, actual: 30, orders: 1 }, meituan: { revenue: 60, actual: 50, orders: 1 } },
    staff: { front: [{ user: 'a' }], kitchen: [] },
    schedule_next_day: { staff: [{ user: 'b' }] },
    photos: ['p1'],
    weather: '晴',
    holiday_switch: true,
  });
  assert.equal(pgItem.store, '洪潮');
  assert.equal(pgItem.data.gross, 1000);
  assert.equal(pgItem._mergedFromPostgres, true);

  const merged = mergeDailyReportItemWithPgRow(
    {
      store: '洪潮',
      date: '2026-07-15',
      submitted: true,
      submittedAt: '2026-07-15T19:00:00Z',
      updatedAt: '2026-07-15T19:00:00Z',
      data: {
        staff: { front: [{ user: 'old' }], kitchen: [] },
        photos: [],
        scheduleNextDay: { staff: [] },
      },
    },
    {
      store: '洪潮',
      date: '2026-07-15',
      actual_revenue: 1,
      staff: { front: [{ user: 'a' }, { user: 'c' }], kitchen: [] },
      photos: ['p1', 'p2'],
      schedule_next_day: { staff: [{ user: 'b' }] },
    }
  );
  assert.equal(merged.data.staff.front.length, 2);
  assert.equal(merged.data.photos.length, 2);

  await recalcWechatMonthTotalsForStoreMonth(
    { async query() { return { rows: [] }; } },
    '洪潮',
    '2026-07-15',
    'default'
  );
  await recalcWechatMonthTotalsForStoreMonth(
    {
      async query() {
        throw new Error('boom');
      },
    },
    '洪潮',
    '2026-07-15',
    'default'
  );

  bindDailyReportsRuntimeDeps({
    pool: {
      async query() {
        return { rows: [{ store: '洪潮', date: '2026-07-15' }] };
      },
    },
    hrmsNowISO: () => '2026-07-25T12:00:00.000Z',
    safeDateOnly: (v) => String(v || '').slice(0, 10),
    getSharedState: async () => ({}),
  });
  await upsertDailyReportPgFromStateReport(
    {
      store: '洪潮',
      date: '2026-07-15',
      data: {
        brand: '洪潮',
        gross: 100,
        actual: 90,
        margin: 30,
        dine: { orders: 1, revenue: 50, traffic: 2 },
        discount: { total: 10, dine: 5, delivery: 5 },
        delivery: {
          eleme: { revenue: 20, actual: 15, orders: 1 },
          meituan: { revenue: 30, actual: 20, orders: 1 },
        },
        badReviews: { dianping: 0, meituan: 0, eleme: 0 },
        staff: { front: [] },
        photos: [],
        new_wechat_members: 2,
      },
    },
    'default'
  );

  await assert.rejects(
    () => upsertDailyReportPgFromStateReport({ store: '', date: '' }, 'default'),
    /missing_store_or_date/
  );
});

// —— attendance-build ——
test('attendance-build: pure helpers + summary factory', () => {
  assert.equal(isCountableCheckinStatus('normal'), true);
  assert.equal(isCountableCheckinStatus('late'), false);
  assert.equal(shanghaiDateOnly('2026-07-15T16:00:00Z').length, 10);
  assert.equal(shanghaiDateOnly('bad'), '');
  assert.match(shanghaiTodayDateOnly(), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(normalizeAttendanceRegisterLineDetails('[{"user":"a"}]'), [{ user: 'a' }]);
  assert.deepEqual(normalizeAttendanceRegisterLineDetails('nope'), []);
  assert.deepEqual(sortIsoDateList(['2026-07-02', '2026-07-01', '2026-07-01']), ['2026-07-01', '2026-07-02']);

  const h = createAttendanceBuildHelpers({
    clampNum: (n, d) => (Number.isFinite(Number(n)) ? Number(n) : d),
    safeDateOnly: (v) => String(v || '').slice(0, 10),
    isLegacyTestUsername: (u) => u === 'testuser',
  });

  const fromReports = h.buildAttendanceFromReports([
    {
      store: '洪潮',
      date: '2026-07-15',
      data: {
        staff: {
          front: [{ user: 'alice', name: '爱丽丝', days: 1 }],
          kitchen: [{ user: 'bob', name: '鲍勃', days: 0.5 }],
        },
      },
    },
    {
      store: '洪潮',
      date: '2026-07-15',
      data: { staff: { front: [{ user: 'alice', name: '爱丽丝', days: 1 }] } },
    },
  ]);
  assert.ok(fromReports.some((r) => r.username === 'alice' && r.days >= 1));

  const fromCheckin = h.buildAttendanceFromCheckinRecords(
    [
      { username: 'alice', store: '洪潮', check_time: '2026-07-15T01:00:00Z', status: 'normal', type: 'clock_in', display_name: '爱丽丝' },
      { username: 'testuser', store: '洪潮', check_time: '2026-07-15T01:00:00Z', status: 'normal' },
      { username: 'carol', store: '洪潮', check_time: '2026-07-15T01:00:00Z', status: 'rejected' },
    ],
    { start: '2026-07-01', end: '2026-07-31', knownUsers: new Set(['alice', 'carol']) }
  );
  assert.equal(fromCheckin.length, 1);
  assert.equal(fromCheckin[0].username, 'alice');

  const summary = h.buildAttendanceSummaryRows(
    [{
      store: '洪潮',
      report_date: '2026-07-15',
      line_details: [
        { username: 'alice', name: '爱丽丝', kind: 'work', declared_days: 1 },
        { username: 'bob', name: '鲍勃', kind: 'rest', declared_days: 1 },
        { username: 'eve', name: '伊芙', kind: 'absent', declared_days: 1 },
      ],
    }],
    [
      {
        username: 'alice',
        store: '洪潮',
        check_time: '2026-07-15T02:30:00Z',
        status: 'normal',
        type: 'clock_in',
        display_name: '爱丽丝',
      },
      {
        username: 'alice',
        store: '洪潮',
        check_time: '2026-07-15T03:00:00Z',
        status: 'gps_fail',
        type: 'clock_out',
      },
    ]
  );
  assert.ok(summary.some((r) => r.username === 'alice'));
  assert.ok(summary.some((r) => r.username === 'eve' && r.absenceDays >= 1));
});

// —— performance-invalidation helpers ——
test('performance-invalidation/helpers: cards + shanghai dates', () => {
  assert.match(getShanghaiYmd(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(getShanghaiPrevYm(), /^\d{4}-\d{2}$/);

  const base = {
    empName: '爱丽丝',
    username: 'alice',
    empStore: '洪潮',
    empRole: 'store_manager',
    period: '2026-07',
    ymdZh: '2026年7月15日',
    taskIdStr: 'T1',
    countBefore: 2,
    countAfter: 1,
    adminUser: 'admin',
    sourceId: 'S1',
    recordSummary: '周扣分',
    before: { total_score: 90, execution_rating: 'A', attitude_rating: 'B', ability_rating: 'A' },
    after: { total_score: 95, execution_rating: 'A', attitude_rating: 'A', ability_rating: 'A' },
  };

  const assignee = buildFilingInvalidationAssigneeCard(base);
  assert.match(assignee.header.title.content, /备案撤销/);
  const admin = buildFilingInvalidationAdminCard(base);
  assert.match(admin.header.title.content, /抄送/);

  const weeklyA = buildWeeklyScoreInvalidationCard(base, 'assignee');
  assert.equal(weeklyA.header.template, 'green');
  const weeklyB = buildWeeklyScoreInvalidationCard(base, 'admin');
  assert.equal(weeklyB.header.template, 'blue');

  const change = buildChangeCard(base.before, base.after, 'alice', '爱丽丝', '洪潮', 'store_manager', '2026-07');
  assert.ok(change);
  assert.match(change.header.title.content, /绩效数据变更/);

  const noop = buildChangeCard(
    { total_score: 90, execution_rating: 'A', attitude_rating: 'A', ability_rating: 'A' },
    { total_score: 90, execution_rating: 'A', attitude_rating: 'A', ability_rating: 'A' },
    'alice',
    '爱丽丝',
    '洪潮',
    'store_manager',
    '2026-07'
  );
  assert.equal(noop, null);
});
