import test from 'node:test';
import assert from 'node:assert/strict';
import { createOffboardingPromotionScheduler } from '../domains/approvals/scheduler-offboarding-promotion.js';

const TODAY = '2026-07-24';

function makeBaseDeps(overrides = {}) {
  return {
    pool: {
      query: async () => ({ rows: [] }),
    },
    runForActiveTenants: async (fn) => {
      await fn('default');
    },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    ensureApprovalTables: async () => {},
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      return '';
    },
    hrmsNowISO: () => `${TODAY}T08:00:00.000Z`,
    applyHrmsUserAccountGateFromEmployee: async () => {},
    addStateNotification: (s, n) => ({
      ...s,
      notifications: [...(s.notifications || []), n],
    }),
    makeNotif: (targetUser, title, message, extra) => ({
      targetUser,
      title,
      message,
      ...(extra || {}),
    }),
    getPromotionTrackProgress: async () => null,
    getPromotionTrackRecipients: async () => [],
    getTodayDateOnly: () => TODAY,
    ...overrides,
  };
}

test('empty offboarding list: early return, getSharedState not called (promotion skip quirk)', async () => {
  let getSharedCalls = 0;
  let saveCalls = 0;
  const { runOffboardingPromotionTick } = createOffboardingPromotionScheduler(
    makeBaseDeps({
      pool: {
        query: async () => ({ rows: [] }),
      },
      getSharedState: async () => {
        getSharedCalls += 1;
        return {};
      },
      saveSharedState: async () => {
        saveCalls += 1;
      },
    })
  );

  await runOffboardingPromotionTick();

  assert.equal(getSharedCalls, 0);
  assert.equal(saveCalls, 0);
});

test('approved offboarding effective today: mark 离职, account gate, executed_at', async () => {
  const sqlLog = [];
  let savedEmployees = null;
  let gateCalls = 0;
  let gateEmp = null;

  const employees = [
    {
      username: 'alice',
      name: 'Alice',
      status: '在职',
      store: 'store-a',
    },
  ];

  const { runOffboardingPromotionTick } = createOffboardingPromotionScheduler(
    makeBaseDeps({
      pool: {
        query: async (sql, params) => {
          const s = String(sql || '');
          sqlLog.push({ sql: s, params });
          if (
            s.includes('from approval_requests') &&
            s.includes('effective_date') &&
            Array.isArray(params) &&
            params[0] === 'offboarding'
          ) {
            return {
              rows: [
                {
                  id: 'appr-ob-1',
                  applicant_username: 'alice',
                  payload: {
                    username: 'alice',
                    resignDate: TODAY,
                  },
                },
              ],
            };
          }
          if (s.includes('update approval_requests set executed_at')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      },
      getSharedState: async () => ({
        employees: employees.map((e) => ({ ...e })),
        promotionTracks: [],
      }),
      saveSharedState: async (state) => {
        savedEmployees = state.employees;
      },
      applyHrmsUserAccountGateFromEmployee: async (emp) => {
        gateCalls += 1;
        gateEmp = emp;
      },
    })
  );

  await runOffboardingPromotionTick();

  assert.ok(savedEmployees, 'saveSharedState should be called');
  const alice = savedEmployees.find((e) => e.username === 'alice');
  assert.equal(alice.status, '离职');
  assert.equal(alice.resignedAt, TODAY);
  assert.equal(alice.offboardingApproved, true);
  assert.equal(gateCalls, 1);
  assert.equal(String(gateEmp?.username || ''), 'alice');
  assert.ok(
    sqlLog.some(
      (x) =>
        x.sql.includes('update approval_requests set executed_at') &&
        Array.isArray(x.params) &&
        x.params[0] === 'appr-ob-1'
    ),
    'executed_at update expected'
  );
});

test('startOffboardingPromotionScheduler is idempotent', () => {
  const realSetInterval = global.setInterval;
  const timers = [];
  global.setInterval = (fn, ms) => {
    const id = realSetInterval(fn, ms);
    timers.push(id);
    return id;
  };
  try {
    const { startOffboardingPromotionScheduler } = createOffboardingPromotionScheduler(makeBaseDeps());
    startOffboardingPromotionScheduler();
    assert.doesNotThrow(() => startOffboardingPromotionScheduler());
  } finally {
    for (const id of timers) clearInterval(id);
    global.setInterval = realSetInterval;
  }
});
