import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStoreUtterance, detectStoreTriggers, buildStoreCustomerReply,
  BUILTIN_STORE_PERSONAS, BUILTIN_STORE_SCENARIOS, isStoreTrack,
} from '../store-tracks.js';
import { evaluateTraineeUtterance } from '../principles.js';
import { inferProfileAndScenario } from '../case-gen.js';

test('门店轨识别与场景种子齐全', () => {
  assert.ok(isStoreTrack('foh_server'));
  assert.ok(BUILTIN_STORE_PERSONAS.length >= 10);
  assert.ok(BUILTIN_STORE_SCENARIOS.some((s) => s.job_profile_key === 'cashier'));
});

test('服务员：催菜无安抚扣分', () => {
  const ev = evaluateStoreUtterance({
    track: 'foh_server',
    traineeText: '厨房在做了你再等等',
    customerText: '等了四十分钟菜还没来，孩子都哭了',
    turnNo: 1,
  });
  assert.ok(detectStoreTriggers('等了四十分钟').includes('rush'));
  assert.ok(ev.violations.some((v) => v.principle_id === 'soothe_guest'));
});

test('服务员：推荐前探询加分', () => {
  const ev = evaluateStoreUtterance({
    track: 'foh_server',
    traineeText: '两位是吧？有忌口吗？方便说下口味偏好？',
    customerText: '第一次来，有什么推荐？',
    turnNo: 1,
  });
  assert.ok(ev.strengths.some((s) => s.principle_id === 'recommend_after_need'));
});

test('收银：退款硬拒扣分', () => {
  const ev = evaluateTraineeUtterance({
    track: 'cashier',
    traineeText: '不能退，按规定不行',
    customerText: '团购用不了，我要全额退款',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(ev.violations.some((v) => v.principle_id === 'refund_verify'));
});

test('店长：升级客诉先稳场', () => {
  const ev = evaluateStoreUtterance({
    track: 'store_manager',
    traineeText: '你先别激动，我们按流程走',
    customerText: '服务员解决不了！你是店长吧？今天必须给说法，我要投诉！',
    turnNo: 1,
  });
  // 无抱歉/共情 → 违规
  assert.ok(ev.violations.some((v) => v.principle_id === 'stabilize_first'));
});

test('门店客户回复：无安抚返回愤怒话术', () => {
  const reply = buildStoreCustomerReply({
    track: 'foh_server',
    turnNo: 2,
    evalResult: {
      triggers: ['rush'],
      violations: [{ principle_id: 'soothe_guest' }],
      strengths: [],
    },
  });
  assert.ok(/生气|官腔|管不管/.test(reply));
});

test('真实案例推断岗位', () => {
  const a = inferProfileAndScenario('客人投诉上菜慢还要退款');
  assert.equal(a.profileKey, 'foh_server');
  const b = inferProfileAndScenario('收银台团购验券争议要退款');
  assert.equal(b.profileKey, 'cashier');
  const c = inferProfileAndScenario('神秘顾客巡店问迎宾标准');
  assert.equal(c.profileKey, 'store_manager');
});
