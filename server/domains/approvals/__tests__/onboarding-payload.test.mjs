/**
 * L1：入职审批 payload → 员工记录（decide 真源）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindOnboardingPayloadDeps,
  buildOnboardingEmployeeRecordFromPayload,
} from '../onboarding-payload.js';

test('缺 username → missing_employee_username', () => {
  bindOnboardingPayloadDeps({ hrmsNowISO: () => '2026-07-25T08:00:00.000Z' });
  const r = buildOnboardingEmployeeRecordFromPayload({ name: '无账号' }, { employees: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_employee_username');
  assert.equal(r.nextEmp, null);
});

test('默认密码 123456；idCard 别名；createdAt 用注入时钟', () => {
  bindOnboardingPayloadDeps({ hrmsNowISO: () => '2026-07-25T08:00:00.000Z' });
  const r = buildOnboardingEmployeeRecordFromPayload(
    {
      username: 'alice',
      name: '爱丽丝',
      idCardNo: '110101199001011234',
      role: 'cashier',
    },
    { employees: [] }
  );
  assert.equal(r.ok, true);
  assert.equal(r.empPassword, '123456');
  assert.equal(r.nextEmp.password, '123456');
  assert.equal(r.nextEmp.idCardNumber, '110101199001011234');
  assert.equal(r.nextEmp.role, 'cashier');
  assert.equal(r.nextEmp.status, 'active');
  assert.equal(r.nextEmp.createdAt, '2026-07-25');
  assert.equal(r.nextEmp.id, '0001');
});

test('显式 password / id 保留；EMP 前缀递增', () => {
  bindOnboardingPayloadDeps({ hrmsNowISO: () => '2026-01-01T00:00:00.000Z' });
  const r = buildOnboardingEmployeeRecordFromPayload(
    { username: 'bob', password: 'secret!', id: '' },
    { employees: [{ id: 'EMP0042' }, { id: '7' }, { id: 'EMP003' }] }
  );
  assert.equal(r.ok, true);
  assert.equal(r.empPassword, 'secret!');
  assert.equal(r.nextEmp.id, '0043'); // max 42 + 1
});

test('name 缺省回落 username', () => {
  bindOnboardingPayloadDeps({ hrmsNowISO: () => '2026-07-25T00:00:00.000Z' });
  const r = buildOnboardingEmployeeRecordFromPayload({ username: 'carol' }, {});
  assert.equal(r.empName, 'carol');
  assert.equal(r.nextEmp.name, 'carol');
});
