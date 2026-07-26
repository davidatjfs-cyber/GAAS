import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBirthdayMonthDay,
  getNextMonth,
  isEndOfMonth,
} from '../helpers.js';
import { createBirthdayScheduler } from '../scheduler.js';

test('parseBirthdayMonthDay: YYYY-MM-DD', () => {
  assert.deepEqual(parseBirthdayMonthDay('1990-07-24'), { month: 7, day: 24 });
});

test('isEndOfMonth / getNextMonth smoke', () => {
  const end = new Date(2026, 6, 31); // Jul 31
  assert.equal(isEndOfMonth(end), true);
  assert.deepEqual(getNextMonth(end), { year: 2026, month: 8 });
  const mid = new Date(2026, 6, 15);
  assert.equal(isEndOfMonth(mid), false);
  assert.deepEqual(getNextMonth(new Date(2026, 11, 1)), { year: 2027, month: 1 });
});

function makeSchedulerMocks({ getNow, state }) {
  const saves = [];
  const notifications = [];
  let currentState = structuredClone(state);

  const { runBirthdayGreetingTick } = createBirthdayScheduler({
    getSharedState: async () => currentState,
    saveSharedState: async (s, tenantId) => {
      saves.push({ state: structuredClone(s), tenantId });
      currentState = structuredClone(s);
    },
    runForActiveTenants: async (fn) => {
      await fn('default');
    },
    addStateNotification: (s, notif) => {
      notifications.push(notif);
      const next = { ...s, notifications: [...(s.notifications || []), notif] };
      return next;
    },
    makeNotif: (targetUser, title, message, extra) => ({
      targetUser,
      title,
      message,
      ...(extra || {}),
    }),
    hrmsNowISO: () => '2026-07-24T09:00:00+08:00',
    isInactiveStatus: () => false,
    employeeAccountShouldDisable: () => false,
    pickAdminUsername: async () => 'admin1',
    pickHrManagerUsername: async () => '',
    stateFindUserRecord: () => ({ name: 'Admin' }),
    getNow,
  });

  return { runBirthdayGreetingTick, saves, notifications, getState: () => currentState };
}

test('runBirthdayGreetingTick at 9:00 sends greeting and saves', async () => {
  const now = new Date(2026, 6, 24, 9, 0, 0); // Jul 24 09:00
  const { runBirthdayGreetingTick, saves, notifications } = makeSchedulerMocks({
    getNow: () => now,
    state: {
      employees: [{ username: 'alice', name: 'Alice', birthday: '1990-07-24', status: 'active' }],
      birthdayGreetingsSent: {},
    },
  });

  await runBirthdayGreetingTick();

  assert.equal(saves.length, 1);
  assert.equal(saves[0].tenantId, 'default');
  assert.ok(saves[0].state.birthdayGreetingsSent['alice_2026-07-24']);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].targetUser, 'alice');
  assert.equal(notifications[0].type, 'birthday_greeting');
});

test('runBirthdayGreetingTick at hour=7 does not save', async () => {
  const now = new Date(2026, 6, 24, 7, 0, 0);
  const { runBirthdayGreetingTick, saves, notifications } = makeSchedulerMocks({
    getNow: () => now,
    state: {
      employees: [{ username: 'alice', name: 'Alice', birthday: '1990-07-24', status: 'active' }],
      birthdayGreetingsSent: {},
    },
  });

  await runBirthdayGreetingTick();

  assert.equal(saves.length, 0);
  assert.equal(notifications.length, 0);
});

test('already-sent greetingKey skips second save', async () => {
  const now = new Date(2026, 6, 24, 9, 0, 0);
  const { runBirthdayGreetingTick, saves, notifications } = makeSchedulerMocks({
    getNow: () => now,
    state: {
      employees: [{ username: 'alice', name: 'Alice', birthday: '1990-07-24', status: 'active' }],
      birthdayGreetingsSent: { 'alice_2026-07-24': '2026-07-24T08:00:00+08:00' },
    },
  });

  await runBirthdayGreetingTick();

  assert.equal(saves.length, 0);
  assert.equal(notifications.length, 0);
});
