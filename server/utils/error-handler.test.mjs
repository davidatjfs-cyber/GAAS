import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeErrorLog,
  safeExecute,
  getErrorStats,
  resetErrorStats,
} from './error-handler.js';

test('safeErrorLog records context and message', () => {
  resetErrorStats();
  safeErrorLog('unit-test', new Error('boom'), { foo: 1 });
  const stats = getErrorStats();
  assert.equal(stats.total, 1);
  assert.equal(stats.byType['unit-test'], 1);
  assert.equal(stats.recent[0].context, 'unit-test');
  assert.match(stats.recent[0].message, /boom/);
  assert.deepEqual(stats.recent[0].details, { foo: 1 });
});

test('safeExecute returns fn result on success', async () => {
  resetErrorStats();
  const v = await safeExecute('ok', async () => 42);
  assert.equal(v, 42);
  assert.equal(getErrorStats().total, 0);
});

test('safeExecute logs error and returns fallback', async () => {
  resetErrorStats();
  const v = await safeExecute(
    'fail',
    async () => { throw new Error('primary'); },
    async () => 'fallback'
  );
  assert.equal(v, 'fallback');
  assert.ok(getErrorStats().total >= 1);
  assert.ok(getErrorStats().byType.fail >= 1);
});

test('safeExecute returns null when no fallback', async () => {
  resetErrorStats();
  const v = await safeExecute('none', async () => { throw new Error('x'); });
  assert.equal(v, null);
});

test('resetErrorStats clears counters', () => {
  safeErrorLog('a', new Error('1'));
  resetErrorStats();
  const stats = getErrorStats();
  assert.equal(stats.total, 0);
  assert.deepEqual(stats.byType, {});
  assert.deepEqual(stats.recent, []);
});

test('safeErrorLog keeps only 10 recent errors', () => {
  resetErrorStats();
  for (let i = 0; i < 12; i += 1) {
    safeErrorLog('many', new Error(`e${i}`));
  }
  const stats = getErrorStats();
  assert.equal(stats.recent.length, 10);
  assert.match(stats.recent[0].message, /e11/);
});

test('safeExecute fallback failure is logged and returns null', async () => {
  resetErrorStats();
  const v = await safeExecute(
    'dual-fail',
    async () => { throw new Error('primary'); },
    async () => { throw new Error('fallback'); }
  );
  assert.equal(v, null);
  assert.ok(getErrorStats().byType['dual-fail'] >= 1);
  assert.ok(getErrorStats().byType['dual-fail-fallback'] >= 1);
});

test('safeErrorLog accepts non-Error values', () => {
  resetErrorStats();
  safeErrorLog('plain', 'string failure');
  assert.equal(getErrorStats().recent[0].message, 'string failure');
});
