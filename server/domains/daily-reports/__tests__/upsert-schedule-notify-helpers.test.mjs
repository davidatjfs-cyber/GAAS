import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDailyReportStore,
  applyScheduleNotifications,
} from '../upsert-schedule-notify-helpers.js';

test('resolveDailyReportStore: store_manager picks allowed/current/myStore', () => {
  assert.equal(
    resolveDailyReportStore({
      role: 'store_manager',
      bodyStore: 'B店',
      allowedStores: ['A店', 'B店'],
      currentStore: 'A店',
      myStore: 'C店',
    }),
    'B店'
  );
  assert.equal(
    resolveDailyReportStore({
      role: 'store_manager',
      bodyStore: 'X店',
      allowedStores: ['A店'],
      currentStore: 'A店',
      myStore: 'C店',
    }),
    'A店'
  );
});

test('resolveDailyReportStore: front_manager uses myStore', () => {
  assert.equal(
    resolveDailyReportStore({
      role: 'front_manager',
      bodyStore: 'X店',
      allowedStores: [],
      currentStore: '',
      myStore: '我的店',
    }),
    '我的店'
  );
});

test('applyScheduleNotifications: morning shift creates notification', () => {
  const state0 = {
    employees: [{ username: 'bob', name: 'Bob' }],
    users: [],
  };
  const notifications = [];
  const next = applyScheduleNotifications({
    state0,
    nextState: { ...state0, notifications },
    payload: {
      scheduleNextDay: {
        morningStaff: [{ username: 'bob', name: 'Bob' }],
      },
    },
    store: 'A店',
    date: '2026-07-24',
    item: { id: 'dr-1' },
    stateFindUserRecord: (s, u) => s.employees.find((e) => e.username === u),
    addStateNotification: (s, n) => ({ ...s, notifications: [...(s.notifications || []), n] }),
    makeNotif: (u, title, msg, meta) => ({ user: u, title, message: msg, ...meta }),
  });
  assert.equal(next.notifications.length, 1);
  assert.match(next.notifications[0].message, /早班/);
  assert.equal(next.notifications[0].shift, 'morning');
});
