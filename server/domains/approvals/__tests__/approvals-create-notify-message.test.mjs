import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateApprovalNotifyMessage } from '../create-notify-message.js';

const safeDateOnly = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const safeNumber = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

function msg(partial) {
  return buildCreateApprovalNotifyMessage({
    label: '审批',
    applicantName: '甲',
    payload: {},
    state: {},
    stateFindUserRecord: () => null,
    safeDateOnly,
    safeNumber,
    ...partial,
  });
}

test('buildCreateApprovalNotifyMessage: 默认与各类型', () => {
  assert.equal(msg({ type: 'payment' }), '甲 提交了审批申请，请审批。');
  assert.match(
    msg({ type: 'leave', payload: { startDate: '2026-08-01', endDate: '2026-08-02' } }),
    /休假申请：2026-08-01 至 2026-08-02/
  );
  assert.match(
    msg({ type: 'offboarding', payload: { resignDate: '2026-09-01' } }),
    /期望离职日期：2026-09-01/
  );
  assert.match(
    msg({ type: 'onboarding', payload: { employee: { name: '新人乙' } } }),
    /新员工「新人乙」/
  );
  assert.match(
    msg({ type: 'promotion', payload: { newLevel: 'T2' } }),
    /目标级别：T2/
  );
  assert.match(
    msg({
      type: 'reward_punishment',
      payload: { targetUsername: 'emp2', rpType: '奖励' },
      stateFindUserRecord: () => ({ name: '乙' }),
    }),
    /奖励申请（乙）/
  );
  assert.match(
    msg({ type: 'points', payload: { itemName: '好评', points: 3 } }),
    /积分申请（好评，3分）/
  );
});
