import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckin,
  listTodayCheckins,
  listCheckinRecords,
  confirmCheckin,
  getCheckinSummary,
  getAttendanceOverview,
  setLeaveBalance,
  confirmMonthlyAttendance,
  getMonthlyConfirm,
} from '../service.js';

const LONG_PHOTO = 'x'.repeat(100);

function makePool(handler) {
  return {
    query: async (sql, params) => {
      if (handler) return handler(sql, params);
      return { rows: [] };
    },
  };
}

function baseCreateCtx(overrides = {}) {
  return {
    pool: overrides.pool || makePool(),
    haversineDistance: () => 0,
    resolveCheckinRadiusMeters: () => 200,
    upsertEmployeeAttendanceMirrorFromCheckinRow: async () => {},
    notifyAdminsDualWriteFailure: () => {},
    getShanghaiHour: overrides.getShanghaiHour || (() => 10),
    ...overrides.ctxExtra,
  };
}

function validCreateInput(extra = {}) {
  return {
    username: 'alice',
    type: 'clock_in',
    latitude: 31.2,
    longitude: 121.5,
    body: {},
    faceMatch: true,
    faceScore: 0.9,
    photoUrl: LONG_PHOTO,
    storeName: '',
    tenantId: 'default',
    ...extra,
  };
}

test('createCheckin: invalid_type', async () => {
  const result = await createCheckin(baseCreateCtx(), validCreateInput({ type: 'break' }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_type');
});

test('createCheckin: duplicate_checkin when record exists within 1h', async () => {
  const pool = makePool(async (sql) => {
    if (/select id from checkin_records/i.test(sql) && /1 hour/i.test(sql)) {
      return { rows: [{ id: 'dup-1' }] };
    }
    return { rows: [] };
  });
  const result = await createCheckin(baseCreateCtx({ pool }), validCreateInput());
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'duplicate_checkin');
  assert.match(result.message, /1小时内已上班打卡/);
});

test('createCheckin: late_clock_in when getShanghaiHour >= 17', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const result = await createCheckin(
    baseCreateCtx({ pool, getShanghaiHour: () => 17 }),
    validCreateInput()
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'late_clock_in');
  assert.match(result.message, /17:00/);
});

test('createCheckin: no_clock_in when clocking out without clock_in today', async () => {
  const pool = makePool(async (sql) => {
    if (/type = 'clock_in'/i.test(sql) && /CURRENT_DATE/i.test(sql)) {
      return { rows: [] };
    }
    if (/1 hour/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const result = await createCheckin(
    baseCreateCtx({ pool }),
    validCreateInput({ type: 'clock_out' })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'no_clock_in');
  assert.match(result.message, /无上班打卡/);
});

test('listCheckinRecords: empty data returns { ok, records: [] }', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const result = await listCheckinRecords(
    {
      pool,
      getSharedState: async () => ({ users: [], employees: [] }),
      safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
      loadActiveDutyRowsForUser: async () => [],
      pickMyStoreFromState: () => '',
    },
    {
      username: 'alice',
      role: 'employee',
      filterUser: '',
      filterStore: '',
      filterName: '',
      start: '',
      end: '',
      filterStatus: '',
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.records, []);
});

test('getAttendanceOverview: empty month data returns zero counts structure', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const result = await getAttendanceOverview(
    {
      pool,
      getSharedState: async () => ({
        users: [{ username: 'alice', name: '爱丽丝', store: '测试店' }],
        dailyReports: [],
      }),
      stateFindUserRecord: (_s, u) => ({ username: u, name: '爱丽丝', store: '测试店' }),
      hrmsAttendanceWindowMinutesForStore: () => ({ startMinutes: 9 * 60, endMinutes: 18 * 60 }),
      hrmsDateKeyInShanghai: () => '',
      hrmsClockMinutesInShanghai: () => 0,
      dailyReportRestDaysForEmployee: () => 0,
      computeAttendanceMissingClockPenalties: async () => new Map(),
      calcEmployeeMonthlyLeaveBalance: () => ({
        baseLeave: 4,
        annualLeave: 0,
        usedLeave: 0,
        totalLeave: 4,
        cumulativeLeaveDays: 0,
        monthRemaining: 4,
        computedRemaining: 4,
        remaining: 4,
        overridden: false,
        cumulativeLeaveManualLock: false,
        weeklyDetails: [],
        lastAdjustment: null,
      }),
    },
    { username: 'alice', role: 'employee', month: '2026-07', tenantId: 'default' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.month, '2026-07');
  assert.equal(result.username, 'alice');
  assert.equal(result.absentCount, 0);
  assert.equal(result.lateCount, 0);
  assert.equal(result.earlyLeaveCount, 0);
  assert.equal(result.restDays, 0);
  assert.ok(result.leave);
});

test('setLeaveBalance: missing_params', async () => {
  const result = await setLeaveBalance(
    {
      getSharedState: async () => ({}),
      mergeSharedStateFields: async () => {},
      stateFindUserRecord: () => null,
      dbFindEmployeeRecord: async () => null,
      calcEmployeeMonthlyLeaveBalance: () => null,
      leaveBalanceOverrideKey: (u, m) => `${u}_${m}`,
      shiftMonth: () => '',
      hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
      randomUUID: () => 'uuid-1',
    },
    {
      actor: 'admin',
      role: 'admin',
      targetUsername: '',
      month: '2026-07',
      value: 2,
      mode: 'carryover',
      note: '',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'missing_params');
});

test('listTodayCheckins: missing_user', async () => {
  const result = await listTodayCheckins({ pool: makePool() }, { username: '' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'missing_user');
});

test('listTodayCheckins: returns today records', async () => {
  const pool = makePool(async (sql, params) => {
    if (/checkin_records.*current_date/i.test(sql)) {
      assert.equal(params[0], 'alice');
      return {
        rows: [
          { id: 'c1', username: 'alice', type: 'clock_in', check_time: '2026-07-26T09:00:00Z' },
          { id: 'c2', username: 'alice', type: 'clock_out', check_time: '2026-07-26T18:00:00Z' },
        ],
      };
    }
    return { rows: [] };
  });
  const result = await listTodayCheckins({ pool }, { username: 'alice' });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].type, 'clock_in');
});

test('listTodayCheckins: query failure returns server_error', async () => {
  const result = await listTodayCheckins(
    { pool: makePool(async () => { throw new Error('db unavailable'); }) },
    { username: 'alice' }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.error, 'server_error');
});

test('listCheckinRecords: admin filters records and adds employee display name', async () => {
  let queryParams;
  const result = await listCheckinRecords(
    {
      pool: makePool(async (_sql, params) => {
        queryParams = params;
        return { rows: [{ username: 'alice', status: 'normal' }] };
      }),
      getSharedState: async () => ({
        users: [{ username: 'boss', name: '老板' }],
        employees: [{ username: 'alice', name: '爱丽丝' }],
      }),
      safeDateOnly: (value) => `date:${value}`,
      loadActiveDutyRowsForUser: async () => [],
      pickMyStoreFromState: () => '',
    },
    {
      username: 'boss',
      role: 'admin',
      filterUser: 'alice',
      filterStore: '测试店',
      filterName: '爱丽',
      start: '2026-07-01',
      end: '2026-07-31',
      filterStatus: 'normal',
      tenantId: 'tenant-1',
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.records[0].display_name, '爱丽丝');
  assert.deepEqual(queryParams, [
    'alice', '测试店', ['alice'], 'date:2026-07-01', 'date:2026-07-31', 'normal', 'tenant-1',
  ]);
});

test('listCheckinRecords: store manager scopes multiple duty stores and optional user', async () => {
  let queryParams;
  const result = await listCheckinRecords(
    {
      pool: makePool(async (_sql, params) => {
        queryParams = params;
        return { rows: [] };
      }),
      getSharedState: async () => ({}),
      loadActiveDutyRowsForUser: async () => [{ store: '店A' }, { store: '店B' }],
      pickMyStoreFromState: () => '',
    },
    {
      username: 'manager',
      role: 'store_manager',
      filterUser: 'alice',
      filterStore: '',
      filterName: '',
      start: '',
      end: '',
      filterStatus: '',
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(queryParams, [['店A', '店B'], 'alice', 'default']);
});

test('listCheckinRecords: manager uses state store or self when duty lookup fails', async () => {
  const seen = [];
  const makeCtx = (store) => ({
    pool: makePool(async (_sql, params) => {
      seen.push(params);
      return { rows: [] };
    }),
    getSharedState: async () => ({}),
    loadActiveDutyRowsForUser: async () => { throw new Error('unavailable'); },
    pickMyStoreFromState: () => store,
  });
  const input = {
    username: 'manager', role: 'store_manager', filterUser: '', filterStore: '', filterName: '',
    start: '', end: '', filterStatus: '', tenantId: 'default',
  };
  assert.equal((await listCheckinRecords(makeCtx('店A'), input)).ok, true);
  assert.equal((await listCheckinRecords(makeCtx(''), input)).ok, true);
  assert.deepEqual(seen, [['店A', 'default'], ['manager', 'default']]);
});

test('listCheckinRecords: unmatched name, missing user, and query failure', async () => {
  const baseInput = {
    username: 'alice', role: 'employee', filterUser: '', filterStore: '', start: '', end: '',
    filterStatus: '', tenantId: 'default',
  };
  const unmatched = await listCheckinRecords(
    {
      pool: makePool(),
      getSharedState: async () => ({ users: [] }),
      loadActiveDutyRowsForUser: async () => [],
      pickMyStoreFromState: () => '',
    },
    { ...baseInput, filterName: '不存在' }
  );
  assert.deepEqual(unmatched, { ok: true, records: [] });
  const missing = await listCheckinRecords({}, { ...baseInput, username: '', filterName: '' });
  assert.equal(missing.error, 'missing_user');
  const failed = await listCheckinRecords(
    {
      pool: makePool(),
      getSharedState: async () => { throw new Error('state unavailable'); },
      loadActiveDutyRowsForUser: async () => [],
      pickMyStoreFromState: () => '',
    },
    { ...baseInput, filterName: '' }
  );
  assert.equal(failed.error, 'server_error');
});

test('confirmCheckin: forbidden for employee role', async () => {
  const result = await confirmCheckin(
    {
      pool: makePool(),
      upsertEmployeeAttendanceMirrorFromCheckinRow: async () => {},
      notifyAdminsDualWriteFailure: () => {},
    },
    {
      username: 'alice',
      role: 'employee',
      id: 'rec-1',
      status: 'confirmed',
      note: '',
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
});

test('confirmCheckin: happy path updates record', async () => {
  const updated = {
    id: 'rec-1',
    username: 'alice',
    status: 'confirmed',
    confirmed_by: 'mgr1',
  };
  const pool = makePool(async (sql, params) => {
    if (/update checkin_records/i.test(sql)) {
      assert.equal(params[0], 'confirmed');
      assert.equal(params[1], 'mgr1');
      assert.equal(params[3], 'rec-1');
      return { rows: [updated] };
    }
    return { rows: [] };
  });
  let mirrorCalled = false;
  const result = await confirmCheckin(
    {
      pool,
      upsertEmployeeAttendanceMirrorFromCheckinRow: async () => { mirrorCalled = true; },
      notifyAdminsDualWriteFailure: () => {},
    },
    {
      username: 'mgr1',
      role: 'store_manager',
      id: 'rec-1',
      status: 'confirmed',
      note: '正常',
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.record, updated);
  assert.equal(mirrorCalled, true);
});

test('confirmCheckin: not_found when id missing', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const result = await confirmCheckin(
    {
      pool,
      upsertEmployeeAttendanceMirrorFromCheckinRow: async () => {},
      notifyAdminsDualWriteFailure: () => {},
    },
    {
      username: 'admin',
      role: 'admin',
      id: 'missing-id',
      status: 'confirmed',
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, 'not_found');
});

test('getCheckinSummary: missing_user / missing_month', async () => {
  const ctx = {
    pool: makePool(),
    getSharedState: async () => ({}),
    pickMyStoreFromState: () => '',
    calcEmployeeMonthlyLeaveBalance: () => null,
  };
  const noUser = await getCheckinSummary(ctx, { username: '', month: '2026-07' });
  assert.equal(noUser.ok, false);
  assert.equal(noUser.error, 'missing_user');

  const noMonth = await getCheckinSummary(ctx, { username: 'alice', month: '' });
  assert.equal(noMonth.ok, false);
  assert.equal(noMonth.error, 'missing_month');
});

test('getCheckinSummary: empty month data returns records and leaveBalances', async () => {
  const pool = makePool(async (sql) => {
    if (/from checkin_records/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const result = await getCheckinSummary(
    {
      pool,
      getSharedState: async () => ({ users: [], employees: [] }),
      pickMyStoreFromState: () => '',
      calcEmployeeMonthlyLeaveBalance: () => null,
    },
    { username: 'alice', role: 'employee', month: '2026-07', tenantId: 'default' }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.leaveBalances, {});
});

test('getCheckinSummary: employee records include display_name and leave balance', async () => {
  const pool = makePool(async (sql) => {
    if (/from checkin_records/i.test(sql)) {
      return {
        rows: [{
          username: 'alice',
          day: '2026-07-15',
          type: 'clock_in',
          status: 'normal',
          check_time: '2026-07-15T01:00:00Z',
        }],
      };
    }
    return { rows: [] };
  });
  const result = await getCheckinSummary(
    {
      pool,
      getSharedState: async () => ({
        users: [{ username: 'alice', name: '爱丽丝' }],
        employees: [],
      }),
      pickMyStoreFromState: () => '',
      calcEmployeeMonthlyLeaveBalance: () => ({
        baseLeave: 4,
        annualLeave: 0,
        usedLeave: 1,
        totalLeave: 4,
        cumulativeLeaveDays: 0,
        computedRemaining: 3,
        remaining: 3,
        overridden: false,
        cumulativeLeaveManualLock: false,
        weeklyDetails: [],
        lastAdjustment: null,
      }),
    },
    { username: 'alice', role: 'employee', month: '2026-07', tenantId: 'default' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].display_name, '爱丽丝');
  assert.ok(result.leaveBalances.alice);
  assert.equal(result.leaveBalances.alice.remaining, 3);
});

test('getCheckinSummary: admin and manager apply store scope', async () => {
  const paramsSeen = [];
  const ctx = {
    pool: makePool(async (_sql, params) => {
      paramsSeen.push(params);
      return { rows: [] };
    }),
    getSharedState: async () => ({}),
    pickMyStoreFromState: (_state, username) => (username === 'manager' ? '店A' : ''),
    calcEmployeeMonthlyLeaveBalance: () => null,
  };
  assert.equal(
    (await getCheckinSummary(ctx, {
      username: 'admin', role: 'admin', filterStore: '总部店', month: '2026-07', tenantId: 't1',
    })).ok,
    true
  );
  assert.equal(
    (await getCheckinSummary(ctx, {
      username: 'manager', role: 'store_manager', filterStore: '', month: '2026-07', tenantId: 't1',
    })).ok,
    true
  );
  assert.deepEqual(paramsSeen, [
    ['2026-07', '总部店', 't1'],
    ['2026-07', '店A', 't1'],
  ]);
});

test('getCheckinSummary: manager falls back to username and query failure is contained', async () => {
  const fallback = await getCheckinSummary(
    {
      pool: makePool(async () => ({ rows: [{ username: 'unknown' }] })),
      getSharedState: async () => ({ users: [] }),
      pickMyStoreFromState: () => '',
      calcEmployeeMonthlyLeaveBalance: () => null,
    },
    { username: 'manager', role: 'store_manager', filterStore: '', month: '2026-07', tenantId: 'default' }
  );
  assert.equal(fallback.ok, true);
  assert.deepEqual(fallback.leaveBalances, {});
  const failed = await getCheckinSummary(
    {
      pool: makePool(async () => { throw new Error('db unavailable'); }),
      getSharedState: async () => ({}),
      pickMyStoreFromState: () => '',
      calcEmployeeMonthlyLeaveBalance: () => null,
    },
    { username: 'alice', role: 'employee', filterStore: '', month: '2026-07', tenantId: 'default' }
  );
  assert.equal(failed.error, 'server_error');
});

test('getMonthlyConfirm: returns all confirmations when month omitted', async () => {
  const confirmations = [
    { id: 'MC-1', month: '2026-06', store: '洪潮', status: 'approved' },
    { id: 'MC-2', month: '2026-07', store: '马己仙', status: 'pending_supervisor' },
  ];
  const result = await getMonthlyConfirm(
    { getSharedState: async () => ({ monthlyConfirmations: confirmations }) },
    { month: '' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.confirmations.length, 2);
});

test('getMonthlyConfirm: filters by month', async () => {
  const confirmations = [
    { id: 'MC-1', month: '2026-06', store: '洪潮', status: 'approved' },
    { id: 'MC-2', month: '2026-07', store: '马己仙', status: 'pending_supervisor' },
  ];
  const result = await getMonthlyConfirm(
    { getSharedState: async () => ({ monthlyConfirmations: confirmations }) },
    { month: '2026-07' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].id, 'MC-2');
});

test('confirmMonthlyAttendance: only_managers_can_confirm for employee', async () => {
  const result = await confirmMonthlyAttendance(
    {
      pool: makePool(),
      getSharedState: async () => ({}),
      mergeSharedStateFields: async () => {},
      stateFindUserRecord: () => null,
      pickHrManagerUsername: () => '',
      appendNotifications: async () => {},
      hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    },
    {
      username: 'alice',
      role: 'employee',
      month: '2026-07',
      store: '测试店',
      summary: {},
      tenantId: 'default',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'only_managers_can_confirm');
});
