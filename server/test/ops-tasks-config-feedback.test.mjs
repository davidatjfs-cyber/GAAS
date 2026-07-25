/**
 * domains/ops-tasks/{config,feedback}.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPS_BRAND_STORE_MAP,
  OPS_BRAND_RULES,
  normalizeOpsRole,
} from '../domains/ops-tasks/config.js';
import { buildOpsFeedback } from '../domains/ops-tasks/feedback.js';

test('normalizeOpsRole / 品牌常量', () => {
  assert.equal(normalizeOpsRole('store_product_manager'), 'store_production_manager');
  assert.equal(normalizeOpsRole('store_manager'), 'store_manager');
  assert.equal(normalizeOpsRole(''), '');
  assert.ok(OPS_BRAND_STORE_MAP['洪潮大宁久光店']);
  assert.ok(OPS_BRAND_RULES['马己仙广东小馆'].lunchDeadline);
});

test('buildOpsFeedback：verified 准时满分 / 迟到扣分 / 分数夹紧', () => {
  const due = new Date('2026-07-01T12:00:00Z');
  const onTime = buildOpsFeedback(
    { due_at: due.toISOString(), required_photos: 2 },
    due.getTime() - 1000,
    2,
    { contentVerified: true }
  );
  assert.equal(onTime.score, 5);
  assert.equal(onTime.verificationStatus, 'verified');
  assert.match(onTime.feedback, /匹配/);

  const lateShort = buildOpsFeedback(
    { due_at: due.toISOString(), required_photos: 3 },
    due.getTime() + 1000,
    0,
    null
  );
  assert.equal(lateShort.score, 1); // 3-1-2 clamped
  assert.equal(lateShort.verificationStatus, 'unverified');
  assert.match(lateShort.feedback, /晚于计划/);
  assert.match(lateShort.feedback, /照片不足/);

  const extraPhotos = buildOpsFeedback(
    { due_at: 'bad', required_photos: 1 },
    Date.now(),
    5,
    { contentVerified: true }
  );
  assert.equal(extraPhotos.score, 5);
  assert.match(extraPhotos.feedback, /照片数量达标/);
});
