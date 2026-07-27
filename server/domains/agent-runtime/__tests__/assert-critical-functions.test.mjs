import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssertCriticalFunctions } from '../assert-critical-functions.js';

test('assertCriticalFunctions passes when all are functions', () => {
  const infos = [];
  const assertCritical = createAssertCriticalFunctions({
    fns: { a: () => {}, b: async () => {} },
    log: { info: (...x) => infos.push(x), error: () => {} },
  });
  assertCritical();
  assert.ok(infos.some((x) => /Startup assertion passed/.test(String(x[0]))));
});

test('assertCriticalFunctions throws listing missing names', () => {
  const errors = [];
  const assertCritical = createAssertCriticalFunctions({
    fns: { ok: () => {}, missing: null, also: 1 },
    log: { info: () => {}, error: (...x) => errors.push(x.join(' ')) },
  });
  assert.throws(() => assertCritical(), /Missing functions.*missing.*also/);
  assert.ok(errors.some((s) => /Missing functions/.test(s)));
});
