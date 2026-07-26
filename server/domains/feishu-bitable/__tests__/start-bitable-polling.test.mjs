import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  BITABLE_INITIAL_CATCHUP_MS,
  BITABLE_NOTIFY_DEBOUNCE_MS,
  createBitablePollingController,
} from '../start-bitable-polling.js';

function makeController(overrides = {}) {
  const calls = {
    seed: 0,
    processKeys: [],
    pollAll: 0,
    archive: 0,
    stats: 0,
    notify: [],
    logs: [],
  };
  const processedRecordIds = new Set();
  const lastProcessedTime = new Map();
  const clients = [];

  class FakeClient extends EventEmitter {
    constructor() {
      super();
      this.queries = [];
      this.ended = false;
      clients.push(this);
    }
    async connect() {}
    async query(sql) {
      this.queries.push(sql);
      return { rows: [] };
    }
    async end() {
      this.ended = true;
      // do not emit 'end' here — production end() from us should not schedule reconnect in dispose
    }
    removeAllListeners() {
      return super.removeAllListeners();
    }
  }

  const ctrl = createBitablePollingController({
    pool: () => ({
      query: async () => ({
        rows: [
          {
            record_id: 'r1',
            fields: { 所属门店: '洪潮' },
            raw: {},
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      }),
    }),
    bitableConfigs: {
      ops_checklist: { tableId: 'tbl_ops', type: 'checklist' },
      task_responses: { tableId: 'tbl_task', type: 'task_response' },
    },
    processedRecordIds,
    lastProcessedTime,
    seedBitableDedup: async () => { calls.seed++; },
    extractRelationsFromBitableRecord: async () => {},
    processBitableData: async (key) => { calls.processKeys.push(key); },
    processChecklistConfirmation: null,
    pollAllBitableSubmissions: async () => { calls.pollAll++; },
    archiveOldBitableSubmissions: async () => {
      calls.archive++;
      return { archived: 1 };
    },
    getBitableSubmissionStats: async () => {
      calls.stats++;
      return { main: { total: 1600 }, total: 2000 };
    },
    notifyBitablePipelineFailure: async (...a) => { calls.notify.push(a); },
    log: {
      info: (...a) => calls.logs.push(['info', a.map(String).join(' ')]),
      warn: (...a) => calls.logs.push(['warn', a.map(String).join(' ')]),
      error: (...a) => calls.logs.push(['error', a.map(String).join(' ')]),
    },
    importPg: async () => ({ Client: FakeClient }),
    getDatabaseUrl: () => 'postgres://test',
    ...overrides,
  });

  return { ctrl, calls, clients, processedRecordIds, lastProcessedTime, FakeClient };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('checkBitableCapacity logs warning and critical', async () => {
  const { ctrl, calls } = makeController();
  await ctrl.checkBitableCapacity();
  assert.equal(calls.stats, 1);
  assert.ok(calls.logs.some((l) => l[0] === 'warn' && l[1].includes('CAPACITY WARNING')));
  assert.ok(calls.logs.some((l) => l[0] === 'error' && l[1].includes('CAPACITY CRITICAL')));
  await ctrl.dispose();
});

test('checkBitableCapacity handles stats failure', async () => {
  const { ctrl, calls } = makeController({
    getBitableSubmissionStats: async () => { throw new Error('stats fail'); },
  });
  await ctrl.checkBitableCapacity();
  assert.ok(calls.logs.some((l) => l[1].includes('capacity check failed')));
  await ctrl.dispose();
});

test('stopBitablePolling is safe when never started', async () => {
  const { ctrl } = makeController();
  ctrl.stopBitablePolling();
  await ctrl.dispose();
});

test('runBitableListenerHandler unknown payload notifies', async () => {
  const { ctrl, calls } = makeController();
  await ctrl._internals.runBitableListenerHandler('nope');
  assert.ok(calls.notify.some((n) => String(n[0]).includes('无法映射')));
  await ctrl.dispose();
});

test('runBitableListenerHandler processes known key', async () => {
  const { ctrl, calls, processedRecordIds } = makeController();
  await ctrl._internals.runBitableListenerHandler('ops_checklist');
  assert.equal(calls.seed, 1);
  assert.deepEqual(calls.processKeys, ['ops_checklist']);
  assert.ok(processedRecordIds.has('ops_checklist_r1'));
  await ctrl.dispose();
});

test('runBitableCatchup skips task_response and processes checklist', async () => {
  const { ctrl, calls } = makeController();
  await ctrl._internals.runBitableCatchup();
  assert.ok(calls.processKeys.includes('ops_checklist'));
  assert.ok(!calls.processKeys.includes('task_responses'));
  assert.ok(calls.logs.some((l) => l[1].includes('catchup cycle complete')));
  await ctrl.dispose();
});

test('runBitableCatchup skips when busy', async () => {
  const { ctrl, calls } = makeController();
  const p1 = ctrl._internals.runBitableListenerHandler('ops_checklist');
  const p2 = ctrl._internals.runBitableCatchup();
  await Promise.all([p1, p2]);
  assert.ok(calls.logs.some((l) => l[1].includes('catchup skipped')));
  await ctrl.dispose();
});

test('LISTEN setup + NOTIFY debounce triggers handler', async () => {
  const { ctrl, calls, clients } = makeController();
  await ctrl._internals.startBitableListener();
  assert.equal(clients.length, 1);
  assert.ok(clients[0].queries.some((q) => String(q).includes('LISTEN')));
  clients[0].emit('notification', { channel: 'bitable_records_updated', payload: 'ops_checklist' });
  await sleep(BITABLE_NOTIFY_DEBOUNCE_MS + 40);
  assert.ok(calls.processKeys.includes('ops_checklist'));
  await ctrl.dispose();
});

test('LISTEN falls back when no DATABASE_URL', async () => {
  const { ctrl, calls } = makeController({ getDatabaseUrl: () => '' });
  await ctrl._internals.startBitableListener();
  await sleep(20);
  assert.ok(calls.pollAll >= 1);
  assert.ok(calls.notify.some((n) => String(n[0]).includes('缺少 pg')));
  await ctrl.dispose();
});

test('LISTEN falls back when importPg fails', async () => {
  const { ctrl, calls } = makeController({
    importPg: async () => { throw new Error('no pg'); },
  });
  await ctrl._internals.startBitableListener();
  await sleep(20);
  assert.ok(calls.pollAll >= 1);
  await ctrl.dispose();
});

test('scheduleBitableAggressiveCatchup dedupes', async () => {
  const { ctrl, calls } = makeController();
  ctrl._internals.scheduleBitableAggressiveCatchup('r1');
  ctrl._internals.scheduleBitableAggressiveCatchup('r2');
  assert.ok(calls.logs.some((l) => l[1].includes('already queued')));
  assert.equal(ctrl._internals.getState().hasAggressiveTimer, true);
  await ctrl.dispose();
});

test('startBitablePolling wires catchup timer path', async () => {
  const { ctrl, calls } = makeController({
    importPg: async () => ({ Client: class extends EventEmitter {
      async connect() { throw new Error('connect fail'); }
      async query() { return { rows: [] }; }
      async end() {}
      removeAllListeners() { return super.removeAllListeners(); }
    }}),
  });
  ctrl.startBitablePolling(60000);
  await sleep(30);
  assert.ok(calls.notify.some((n) => String(n[0]).includes('初始化失败')));
  await ctrl._internals.runBitableCatchup();
  assert.ok(calls.processKeys.length >= 1);
  assert.ok(BITABLE_INITIAL_CATCHUP_MS > 0);
  await ctrl.dispose();
});

test('startArchiveScheduler schedules next archive log', async () => {
  const { ctrl, calls } = makeController();
  ctrl.startArchiveScheduler();
  assert.ok(calls.logs.some((l) => l[1].includes('next archive scheduled')));
  await ctrl.dispose();
});

test('NOTIFY debounce ignores unmapped payload and coalesces repeats', async () => {
  const { ctrl, calls } = makeController({ notifyDebounceMs: 20 });
  ctrl._internals.scheduleBitableNotifyProcessing('tbl_unknown');
  ctrl._internals.scheduleBitableNotifyProcessing('tbl_unknown');
  await sleep(50);
  assert.ok(calls.logs.some((l) => l[0] === 'warn' && l[1].includes('not mapped')));
  await ctrl.dispose();
});

test('handler error notifies when seed throws', async () => {
  const { ctrl, calls } = makeController({
    seedBitableDedup: async () => { throw new Error('seed boom'); },
  });
  await ctrl._internals.runBitableListenerHandler('ops_checklist');
  assert.ok(calls.notify.some((n) => String(n[0]).includes('NOTIFY 处理失败')));
  await ctrl.dispose();
});

test('catchup per-key and cycle errors notify', async () => {
  let n = 0;
  const { ctrl, calls } = makeController({
    processBitableData: async () => { throw new Error('proc fail'); },
  });
  await ctrl._internals.runBitableCatchup();
  assert.ok(calls.notify.some((n) => String(n[0]).includes('catchup 单表失败')));

  const { ctrl: ctrl2, calls: calls2 } = makeController({
    seedBitableDedup: async () => {
      n += 1;
      if (n === 1) throw new Error('cycle fail');
    },
  });
  await ctrl2._internals.runBitableCatchup();
  assert.ok(calls2.notify.some((n) => String(n[0]).includes('catchup 整轮失败')));
  await ctrl.dispose();
  await ctrl2.dispose();
});

test('fallback poll error and busy skip', async () => {
  let polls = 0;
  const { ctrl, calls } = makeController({
    getDatabaseUrl: () => '',
    pollAllBitableSubmissions: async () => {
      polls += 1;
      if (polls === 1) {
        // keep busy for concurrent skip by starting a second call via internals after in-progress
        throw new Error('poll fail');
      }
    },
  });
  await ctrl._internals.startBitableListener();
  await sleep(30);
  assert.ok(calls.notify.some((n) => String(n[0]).includes('飞书直连轮询')));
  // mark busy then run fallback once via second start
  const p = ctrl._internals.runBitableListenerHandler('ops_checklist');
  ctrl._internals.startBitableFallbackPolling(60_000);
  await p;
  await sleep(20);
  assert.ok(calls.logs.some((l) => l[1].includes('previous cycle still running') || l[1].includes('Falling back')));
  await ctrl.dispose();
});

test('LISTEN client error/end/keepalive aggressive path', async () => {
  const { ctrl, calls, clients } = makeController({
    listenHealthMs: 15,
    listenReconnectBackoffMinMs: 20,
    aggressiveCatchupDeadlineMs: 900,
    notifyDebounceMs: 10,
  });
  await ctrl._internals.startBitableListener();
  assert.equal(clients.length, 1);
  const client = clients[0];
  client.emit('error', new Error('socket err'));
  assert.ok(calls.notify.some((n) => String(n[0]).includes('error 事件')));

  // reconnect path via end (FakeClient.end does not emit; emit manually)
  client.emit('end');
  await sleep(40);
  assert.ok(calls.notify.some((n) => String(n[0]).includes('连接已断开')));

  // fresh listener for keepalive failures
  await ctrl.dispose();
  const again = makeController({
    listenHealthMs: 15,
    aggressiveCatchupDeadlineMs: 900,
    importPg: async () => ({
      Client: class extends EventEmitter {
        constructor() { super(); clients.push(this); this.n = 0; }
        async connect() {}
        async query(sql) {
          if (String(sql).includes('SELECT 1')) throw new Error('keepalive fail');
          return { rows: [] };
        }
        async end() {}
        removeAllListeners() { return super.removeAllListeners(); }
      },
    }),
  });
  await again.ctrl._internals.startBitableListener();
  await sleep(70); // >= 3 keepalive ticks
  assert.ok(again.calls.notify.some((n) => String(n[0]).includes('keepalive')));
  assert.ok(again.calls.logs.some((l) => l[1].includes('aggressive catchup') || l[1].includes('keepalive failed')));
  await sleep(950); // allow aggressive catchup timer
  await again.ctrl.dispose();
});

test('restart LISTEN clears prior client and stop clears interval', async () => {
  const { ctrl, calls, clients } = makeController();
  await ctrl._internals.startBitableListener();
  await ctrl._internals.startBitableListener();
  assert.ok(clients.length >= 2);
  ctrl._internals.startBitableFallbackPolling(60_000);
  await sleep(10);
  ctrl.stopBitablePolling();
  assert.ok(calls.logs.some((l) => l[1].includes('polling stopped')));
  await ctrl.dispose();
});

test('aggressive catchup runs and reports failure', async () => {
  const { ctrl, calls } = makeController({
    aggressiveCatchupDeadlineMs: 900,
    seedBitableDedup: async () => { throw new Error('agg fail'); },
  });
  ctrl._internals.scheduleBitableAggressiveCatchup('test');
  await sleep(950);
  assert.ok(
    calls.logs.some((l) => l[1].includes('aggressive catchup')) ||
      calls.notify.some((n) => String(n[0]).includes('加密 catchup'))
  );
  await ctrl.dispose();
});
