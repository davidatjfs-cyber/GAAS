/**
 * domains/growth-profiles/recompute.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampProfileRecomputeDays } from '../recompute.js';

test('clampProfileRecomputeDays：7–365 钳制', () => {
  assert.equal(clampProfileRecomputeDays(undefined), 90);
  assert.equal(clampProfileRecomputeDays(3), 7);
  assert.equal(clampProfileRecomputeDays(500), 365);
  assert.equal(clampProfileRecomputeDays(120), 120);
});
