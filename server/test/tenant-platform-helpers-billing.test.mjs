/**
 * L1：平台账单 profile 归一化 / 收款账户门禁 / 许可证倒计时。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billingAccountGate,
  computeLicenseCountdown,
  mergePlatformProfile,
  savePlatformBillingAccount,
  PLATFORM_BILLING_ACCOUNT_KEY,
} from '../domains/tenant-platform/helpers.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('mergePlatformProfile: 非法 delivery_method 回落默认；联系方式 trim', () => {
  const p = mergePlatformProfile({
    system_name: '  洪潮  ',
    billing: {
      delivery_method: 'fax',
      billing_contact_email: '  a@b.c  ',
      plan_name: ' 标准 ',
    },
    alerts: { notify_days_before_expiry: 0.9 },
  }, 'fallback');
  assert.equal(p.system_name, '洪潮');
  assert.equal(p.billing.delivery_method, 'email'); // default
  assert.equal(p.billing.billing_contact_email, 'a@b.c');
  assert.equal(p.billing.plan_name, '标准');
  assert.equal(p.alerts.notify_days_before_expiry, 1); // floor max(1, …)
});

test('mergePlatformProfile: wechat delivery 合法；非对象输入用默认', () => {
  const p = mergePlatformProfile({
    billing: { delivery_method: 'wechat' },
  });
  assert.equal(p.billing.delivery_method, 'wechat');
  const empty = mergePlatformProfile(null, '租户甲');
  assert.equal(empty.system_name, '租户甲');
});

test('billingAccountGate: sales 403；finance 放行', () => {
  let next = 0;
  const denied = mockRes();
  billingAccountGate({ platformAdmin: { role: 'sales' } }, denied, () => { next += 1; });
  assert.equal(denied.statusCode, 403);
  assert.equal(next, 0);

  const ok = mockRes();
  billingAccountGate({ platformAdmin: { role: 'finance' } }, ok, () => { next += 1; });
  assert.equal(next, 1);
  assert.equal(ok.statusCode, 200);
});

test('computeLicenseCountdown: 空/非法 → null；未来日为正', () => {
  assert.equal(computeLicenseCountdown(null), null);
  assert.equal(computeLicenseCountdown('not-a-date'), null);
  const days = computeLicenseCountdown(new Date(Date.now() + 5 * 86400000).toISOString());
  assert.ok(days >= 4 && days <= 6);
});

test('savePlatformBillingAccount: trim 后写入 __system__', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const saved = await savePlatformBillingAccount(db, {
    account_name: '  公司  ',
    bank_account_no: ' 6222 ',
    notes: ' x ',
  });
  assert.equal(saved.account_name, '公司');
  assert.equal(saved.bank_account_no, '6222');
  assert.equal(calls[0].params[0], PLATFORM_BILLING_ACCOUNT_KEY);
  assert.ok(String(calls[0].params[1]).includes('公司'));
});
