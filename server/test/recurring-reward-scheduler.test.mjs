import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecurringRewardScheduler } from '../domains/approvals/scheduler-recurring-reward.js';

function makeBaseDeps(overrides = {}) {
  const pool = {
    query: async () => ({ rows: [] }),
  };
  return {
    pool,
    getSharedState: async () => ({
      employees: [
        {
          username: 'alice',
          name: 'Alice',
          managerUsername: 'mgr1',
          store: 'store-a',
        },
      ],
    }),
    saveSharedState: async () => {},
    getActiveTenantIds: async () => ['default'],
    tenantContext: { run: async (_tid, fn) => fn() },
    pickAdminUsername: async () => 'admin1',
    pickHqManagerUsername: async () => '',
    pickCashierUsername: async () => '',
    pickHrManagerUsername: async () => '',
    stateFindUserRecord: (state, username) => {
      const list = Array.isArray(state?.employees) ? state.employees : [];
      return (
        list.find(
          (e) =>
            String(e?.username || '')
              .trim()
              .toLowerCase() === String(username || '').trim().toLowerCase()
        ) || null
      );
    },
    buildConfiguredApprovalAssignees: async () => ['mgr1'],
    resolveDutyApproverForStore: async () => '',
    addStateNotification: (s, notif) => ({
      ...s,
      notifications: [...(s.notifications || []), notif],
    }),
    makeNotif: (targetUser, title, message, extra) => ({
      targetUser,
      title,
      message,
      ...(extra || {}),
    }),
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => {},
    getNow: () => new Date(),
    ...overrides,
  };
}

test('shanghaiCalendarForJobs: Shanghai July 10 07:05', () => {
  const { shanghaiCalendarForJobs } = createRecurringRewardScheduler(makeBaseDeps());
  const cal = shanghaiCalendarForJobs(new Date('2026-07-10T07:05:00+08:00'));
  assert.equal(cal.d, 10);
  assert.equal(cal.hour, 7);
  assert.ok(cal.minute >= 4 && cal.minute <= 6);
  assert.equal(cal.ymd, '2026-07-10');
  assert.equal(cal.y, 2026);
  assert.equal(cal.m, 7);
});

test('runMonthlyRecurringRewardTemplatesJob: July 11 early return, no template query', async () => {
  let queryCalls = 0;
  const pool = {
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  };
  let getActiveCalled = 0;
  const { runMonthlyRecurringRewardTemplatesJob } = createRecurringRewardScheduler(
    makeBaseDeps({
      pool,
      getActiveTenantIds: async () => {
        getActiveCalled += 1;
        return ['default'];
      },
      getNow: () => new Date('2026-07-11T07:05:00+08:00'),
    })
  );

  await runMonthlyRecurringRewardTemplatesJob();

  assert.equal(getActiveCalled, 0);
  assert.equal(queryCalls, 0);
});

test('runMonthlyRecurringRewardTemplatesJob: July 10 07:05 inserts approval', async () => {
  const sqlLog = [];
  const pool = {
    query: async (sql, params) => {
      const s = String(sql || '');
      sqlLog.push({ sql: s, params });
      if (s.includes('from recurring_reward_templates') && s.includes('frequency')) {
        return {
          rows: [
            {
              id: 'tpl-1',
              tenant_id: 'default',
              active: true,
              frequency: 'monthly',
              created_by: 'alice',
              last_generated_ym: null,
              payload: { rpType: '奖励', targetUsername: 'bob', note: '月度' },
            },
          ],
        };
      }
      if (s.includes('select id from approval_requests')) {
        return { rows: [] };
      }
      if (s.includes('insert into approval_requests')) {
        return {
          rows: [
            {
              id: 'apr-1',
              type: 'reward_punishment',
              status: 'pending',
              applicant_username: 'alice',
              current_assignee_username: 'mgr1',
            },
          ],
        };
      }
      if (s.includes('update recurring_reward_templates')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const { runMonthlyRecurringRewardTemplatesJob } = createRecurringRewardScheduler(
    makeBaseDeps({
      pool,
      getNow: () => new Date('2026-07-10T07:05:00+08:00'),
      buildConfiguredApprovalAssignees: async () => ['mgr1'],
    })
  );

  await runMonthlyRecurringRewardTemplatesJob();

  const insertCalls = sqlLog.filter((c) => c.sql.includes('insert into approval_requests'));
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].params[0], 'reward_punishment');
  assert.equal(insertCalls[0].params[2], 'alice');
  assert.equal(insertCalls[0].params[3], 'mgr1');
});

test('slot dedupe: second run same window does not re-query templates', async () => {
  let templateSelects = 0;
  const pool = {
    query: async (sql) => {
      const s = String(sql || '');
      if (s.includes('from recurring_reward_templates') && s.includes('frequency')) {
        templateSelects += 1;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const { runMonthlyRecurringRewardTemplatesJob } = createRecurringRewardScheduler(
    makeBaseDeps({
      pool,
      getNow: () => new Date('2026-07-10T07:05:00+08:00'),
    })
  );

  await runMonthlyRecurringRewardTemplatesJob();
  assert.equal(templateSelects, 1);

  await runMonthlyRecurringRewardTemplatesJob();
  assert.equal(templateSelects, 1);
});
