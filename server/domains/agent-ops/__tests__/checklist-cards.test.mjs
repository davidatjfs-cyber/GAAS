import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countOpsChecklistAbnormal,
  countOpsChecklistCompleted,
  detectOpsChecklistType,
  formatChecklistTypeLabel,
  getOpsChecklistItems,
  getOpsChecklistProgressKey,
  buildOpsChecklistCard,
  buildOpsChecklistItemDetailCard,
  buildOpsChecklistItemsCard,
  buildOpsChecklistAbnormalItemsCard,
  buildOpsChecklistTemplateText,
} from '../checklist-cards-helpers.js';
import { createOpsChecklistCardsApi } from '../checklist-cards.js';

test('labels / detect / progress key / counts', () => {
  assert.equal(formatChecklistTypeLabel('opening'), '开市');
  assert.equal(detectOpsChecklistType('开市检查'), 'opening');
  assert.equal(detectOpsChecklistType('今天营业额怎么样'), '');
  assert.equal(detectOpsChecklistType('收档'), 'closing');
  assert.match(getOpsChecklistProgressKey('oid', 'opening', '洪潮店'), /oid\|\|洪潮店\|\|opening\|\|/);
  assert.equal(
    countOpsChecklistCompleted({
      itemDetails: { 0: { status: 'pass', remark: 'ok' }, 1: { status: 'pass', remark: '' } },
    }),
    1
  );
  assert.equal(
    countOpsChecklistAbnormal({
      itemDetails: { 0: { status: 'fail' }, 1: { status: 'pass' } },
    }),
    1
  );
});

test('getOpsChecklistItems resolves store/brand/type', () => {
  const cfg = () => ({
    scheduledTasks: {
      dailyInspections: [
        { type: 'opening', store: '洪潮店', checklist: ['A', 'B'] },
        { type: 'opening', brand: '洪潮', checklist: ['C'] },
        { type: 'closing', checklist: ['D'] },
      ],
    },
  });
  assert.deepEqual(getOpsChecklistItems(cfg, 'opening', '洪潮店', ''), ['A', 'B']);
  assert.deepEqual(getOpsChecklistItems(cfg, 'opening', '', '洪潮'), ['C']);
  assert.deepEqual(getOpsChecklistItems(cfg, 'closing', '', ''), ['D']);
});

test('card builders include store and actions', () => {
  const cfg = () => ({
    scheduledTasks: { dailyInspections: [{ type: 'opening', checklist: ['环境', '设备'] }] },
  });
  const detail = buildOpsChecklistItemDetailCard({
    checkType: 'opening',
    brandName: '洪潮',
    storeName: '洪潮店',
    itemIndex: 0,
    itemName: '环境',
    detail: { status: 'pass', remark: '好', photoCount: 1 },
  });
  assert.match(JSON.stringify(detail), /本项合格/);

  const items = buildOpsChecklistItemsCard(cfg, {
    checkType: 'opening',
    brandName: '洪潮',
    storeName: '洪潮店',
    checkedIndices: new Set([0]),
  });
  assert.equal(items.elements.length >= 2, true);

  const abnormal = buildOpsChecklistAbnormalItemsCard(cfg, {
    checkType: 'opening',
    brandName: '洪潮',
    storeName: '洪潮店',
  });
  assert.match(JSON.stringify(abnormal), /其他异常/);

  const card = buildOpsChecklistCard(cfg, {
    checkType: 'opening',
    brandName: '洪潮',
    storeName: '洪潮店',
    abnormalCount: 1,
  });
  assert.match(JSON.stringify(card), /直接提交/);

  const text = buildOpsChecklistTemplateText(cfg, {
    checkType: 'opening',
    brandName: '洪潮',
    storeName: '洪潮店',
  });
  assert.match(text, /检查标准模板/);
});

test('factory exposes progress map and wrappers', () => {
  const api = createOpsChecklistCardsApi({
    getOpsAgentConfig: () => ({
      scheduledTasks: { dailyInspections: [{ type: 'opening', checklist: ['X'] }] },
    }),
    startProgressCleanup: false,
  });
  assert.equal(api.getOpsChecklistItems('opening').length, 1);
  api.opsChecklistProgress.set('k', { createdAt: Date.now() });
  assert.equal(api.opsChecklistProgress.has('k'), true);
  assert.equal(api.formatChecklistTypeLabel('closing'), '收档');
});

test('sweepExpiredChecklistProgress removes stale entries', () => {
  const api = createOpsChecklistCardsApi({
    getOpsAgentConfig: () => ({ scheduledTasks: { dailyInspections: [] } }),
    startProgressCleanup: false,
  });
  const now = Date.now();
  api.opsChecklistProgress.set('old', { createdAt: now - 3 * 60 * 60 * 1000 });
  api.opsChecklistProgress.set('new', { createdAt: now });
  assert.equal(api.sweepExpiredChecklistProgress(now), 1);
  assert.equal(api.opsChecklistProgress.has('old'), false);
  assert.equal(api.opsChecklistProgress.has('new'), true);
});
