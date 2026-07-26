import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const LOGGER_MODULE = new URL('../utils/logger.js', import.meta.url).href;
const ACCOUNT_GATE_MODULE = new URL('../domains/employees/account-gate.js', import.meta.url).href;

function makeGateFromModule(createAccountGateHelpers, syncError = new Error('update failed')) {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: [{ tenant_id: 't1' }] };
      }
      throw syncError;
    },
  };
  return createAccountGateHelpers({
    pool,
    DATABASE_URL: 'postgres://test',
    tenantContext: {
      run: async (_tenantId, fn) => fn(),
    },
    storeSessionNonce: async () => {},
    randomUUID: () => 'aabbccdd-eeff-1122-3344-556677889900',
    getSharedState: async () => ({}),
    stateFindUserRecord: () => null,
  });
}

test('account-gate logger bindings and sync failure payloads', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('requires node --experimental-test-module-mocks');
    return;
  }
  const logCalls = [];
  let loggerBindings = null;
  mock.module(LOGGER_MODULE, {
    cache: false,
    namedExports: {
      childLogger: (bindings = {}) => {
        loggerBindings = bindings;
        return {
          error: (payload) => logCalls.push(payload),
          info: () => {},
          warn: () => {},
          debug: () => {},
        };
      },
      logger: {
        child: (bindings = {}) => {
          loggerBindings = bindings;
          return { error: (payload) => logCalls.push(payload) };
        },
      },
      createHttpAccessLogger: () => () => {},
    },
  });

  const { createAccountGateHelpers } = await import(`${ACCOUNT_GATE_MODULE}?mocklog=${Date.now()}`);

  const disableHelpers = makeGateFromModule(createAccountGateHelpers);
  await disableHelpers.applyHrmsUserAccountGateFromEmployee({ username: 'err', status: '离职' });

  assert.deepEqual(loggerBindings, { domain: 'employees', handler: 'account-gate' });
  assert.equal(logCalls.length, 1);
  assert.deepEqual(logCalls[0], {
    msg: 'account_gate_sync_failed',
    username: 'err',
    action: 'disable',
    err: 'update failed',
  });

  logCalls.length = 0;
  const enableHelpers = makeGateFromModule(createAccountGateHelpers, new Error('enable boom'));
  await enableHelpers.applyHrmsUserAccountGateFromEmployee({ username: 'bob', status: 'active' });
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].action, 'enable');
  assert.equal(logCalls[0].err, 'enable boom');

  logCalls.length = 0;
  const stringThrowHelpers = makeGateFromModule(createAccountGateHelpers, 'plain-failure');
  await stringThrowHelpers.applyHrmsUserAccountGateFromEmployee({ username: 'err', status: '离职' });
  assert.equal(logCalls[0].err, 'plain-failure');
});
