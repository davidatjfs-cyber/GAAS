import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationsCleanupScheduler } from '../domains/notifications/scheduler-cleanup.js';

test('cleanupOldNotifications calls runForActiveTenants and accumulates deleted rowCount', async () => {
  const queries = [];
  let continueOnError;
  const { cleanupOldNotifications } = createNotificationsCleanupScheduler({
    pool: {
      query: async (sql) => {
        queries.push(sql);
        return { rowCount: 3 };
      },
    },
    runForActiveTenants: async (fn, opts) => {
      continueOnError = opts?.continueOnError;
      await fn('tenant-a');
      await fn('tenant-b');
    },
  });

  const logs = [];
  const realLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };
  try {
    await cleanupOldNotifications();
  } finally {
    console.log = realLog;
  }

  assert.equal(continueOnError, true);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /interval '3 days'/);
  assert.match(queries[0], /LIMIT 50/);
  assert.ok(logs.some((l) => l.includes('deleted:') && l.includes('6')));
});

test('cleanupOldNotifications swallows runForActiveTenants errors', async () => {
  const { cleanupOldNotifications } = createNotificationsCleanupScheduler({
    pool: { query: async () => ({ rowCount: 1 }) },
    runForActiveTenants: async () => {
      throw new Error('boom');
    },
  });

  const errors = [];
  const realError = console.error;
  console.error = (...args) => {
    errors.push(args.join(' '));
  };
  try {
    await assert.doesNotReject(() => cleanupOldNotifications());
  } finally {
    console.error = realError;
  }
  assert.ok(errors.some((e) => e.includes('[cleanup] hrms_user_notifications error:')));
});

test('startNotificationsCleanupScheduler is idempotent', () => {
  const realSetTimeout = global.setTimeout;
  const realSetInterval = global.setInterval;
  const timeouts = [];
  const intervals = [];
  global.setTimeout = (fn, ms) => {
    const id = realSetTimeout(() => {}, 60_000);
    timeouts.push({ fn, ms, id });
    return id;
  };
  global.setInterval = (fn, ms) => {
    const id = realSetInterval(() => {}, 60_000);
    intervals.push({ fn, ms, id });
    return id;
  };
  try {
    const { startNotificationsCleanupScheduler } = createNotificationsCleanupScheduler({
      pool: { query: async () => ({ rowCount: 0 }) },
      runForActiveTenants: async () => {},
    });
    startNotificationsCleanupScheduler();
    startNotificationsCleanupScheduler();
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].ms, 60000);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].ms, 6 * 3600 * 1000);
  } finally {
    for (const t of timeouts) clearTimeout(t.id);
    for (const i of intervals) clearInterval(i.id);
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
  }
});
