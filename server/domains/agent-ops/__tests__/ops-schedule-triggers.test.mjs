import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleOpsTasks, createCheckDataTriggers } from '../ops-schedule-triggers.js';

test('scheduleOpsTasks matches current HH:mm and skips empty store', async () => {
  const scheduleOpsTasks = createScheduleOpsTasks({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [
          { time: '09:30', store: '洪潮店', brand: '洪潮', type: 'open', checklist: ['a'] },
          { time: '09:30', store: '  ', brand: 'x', type: 'open', checklist: [] },
          { time: '10:00', store: '马己仙', brand: '马己仙', type: 'close', checklist: [] },
        ],
      },
    }),
    now: () => new Date('2026-07-28T01:30:00Z'), // UTC 01:30 → depends on local TZ; force via mock hours
  });
  // Use explicit now with fixed local hours via Date overridden methods
  const scheduleOpsTasks2 = createScheduleOpsTasks({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [
          { time: '09:30', store: '洪潮店', brand: '洪潮', type: 'open', checklist: ['a'] },
          { time: '09:30', store: '', brand: 'x', type: 'open', checklist: [] },
        ],
      },
    }),
    now: () => {
      const d = new Date();
      d.getHours = () => 9;
      d.getMinutes = () => 30;
      d.toISOString = () => '2026-07-28T01:30:00.000Z';
      return d;
    },
  });
  const tasks = await scheduleOpsTasks2();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].store, '洪潮店');
  assert.equal(tasks[0].type, 'daily_inspection');
  void scheduleOpsTasks;
});

test('checkDataTriggers maps complaint rows and swallows query errors', async () => {
  const check = createCheckDataTriggers({
    getOpsAgentConfig: () => ({ scheduledTasks: { dataTriggers: { productComplaintThreshold: 2 } } }),
    pool: () => ({
      query: async () => ({
        rows: [{ store: 's1', product_name: 'p', complaint_count: 3 }],
      }),
    }),
    log: { error: () => {} },
  });
  const triggers = await check();
  assert.deepEqual(triggers, [{
    type: 'product_complaints',
    store: 's1',
    product: 'p',
    count: 3,
    action: 'check_production_process',
  }]);

  const errs = [];
  const checkFail = createCheckDataTriggers({
    getOpsAgentConfig: () => ({ scheduledTasks: { dataTriggers: { productComplaintThreshold: 1 } } }),
    pool: () => ({ query: async () => { throw new Error('db'); } }),
    log: { error: (...a) => errs.push(a.join(' ')) },
  });
  assert.deepEqual(await checkFail(), []);
  assert.ok(errs.some((e) => /data trigger check failed/.test(e)));
});
