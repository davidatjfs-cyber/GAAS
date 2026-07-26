import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAliyunSmsConfigured,
  isAliyunSmsAutoSendEnabled,
  sendAliyunSms,
  querySmsTemplate,
} from './sms.js';

test('isAliyunSmsConfigured requires core env vars', () => {
  const prev = {
    id: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    secret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
    sign: process.env.ALIYUN_SMS_SIGN_NAME,
  };
  delete process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  delete process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  delete process.env.ALIYUN_SMS_SIGN_NAME;
  try {
    assert.equal(isAliyunSmsConfigured(), false);
    process.env.ALIYUN_SMS_ACCESS_KEY_ID = 'ak';
    process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = 'sk';
    process.env.ALIYUN_SMS_SIGN_NAME = '签名';
    assert.equal(isAliyunSmsConfigured(), true);
  } finally {
    if (prev.id == null) delete process.env.ALIYUN_SMS_ACCESS_KEY_ID;
    else process.env.ALIYUN_SMS_ACCESS_KEY_ID = prev.id;
    if (prev.secret == null) delete process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
    else process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = prev.secret;
    if (prev.sign == null) delete process.env.ALIYUN_SMS_SIGN_NAME;
    else process.env.ALIYUN_SMS_SIGN_NAME = prev.sign;
  }
});

test('isAliyunSmsAutoSendEnabled accepts truthy flags only', () => {
  const prev = process.env.ALIYUN_SMS_ENABLED;
  process.env.ALIYUN_SMS_ENABLED = '0';
  assert.equal(isAliyunSmsAutoSendEnabled(), false);
  process.env.ALIYUN_SMS_ENABLED = 'true';
  assert.equal(isAliyunSmsAutoSendEnabled(), true);
  if (prev == null) delete process.env.ALIYUN_SMS_ENABLED;
  else process.env.ALIYUN_SMS_ENABLED = prev;
});

test('sendAliyunSms validates credentials and phones', async () => {
  const prev = {
    id: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    secret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
    sign: process.env.ALIYUN_SMS_SIGN_NAME,
    tpl: process.env.ALIYUN_SMS_TEMPLATE_DEFAULT,
  };
  delete process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  try {
    await assert.rejects(() => sendAliyunSms({ phoneNumbers: '13800138000' }), /missing_aliyun_sms_credentials/);
  } finally {
    Object.entries(prev).forEach(([k, v]) => {
      const key = k === 'id' ? 'ALIYUN_SMS_ACCESS_KEY_ID'
        : k === 'secret' ? 'ALIYUN_SMS_ACCESS_KEY_SECRET'
          : k === 'sign' ? 'ALIYUN_SMS_SIGN_NAME' : 'ALIYUN_SMS_TEMPLATE_DEFAULT';
      if (v == null) delete process.env[key];
      else process.env[key] = v;
    });
  }

  process.env.ALIYUN_SMS_ACCESS_KEY_ID = 'ak-test';
  process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = 'sk-test';
  process.env.ALIYUN_SMS_SIGN_NAME = '测试签名';
  process.env.ALIYUN_SMS_TEMPLATE_DEFAULT = 'SMS_001';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ Code: 'OK', BizId: 'biz-1', RequestId: 'req-1' }),
  });
  try {
    const result = await sendAliyunSms({ phoneNumbers: '13800138000', templateParam: { code: '1234' } });
    assert.equal(result.provider_msg_id, 'biz-1');
    await assert.rejects(
      () => sendAliyunSms({ phoneNumbers: '', templateCode: 'SMS_001' }),
      /missing_sms_phone/
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.entries(prev).forEach(([k, v]) => {
      const key = k === 'id' ? 'ALIYUN_SMS_ACCESS_KEY_ID'
        : k === 'secret' ? 'ALIYUN_SMS_ACCESS_KEY_SECRET'
          : k === 'sign' ? 'ALIYUN_SMS_SIGN_NAME' : 'ALIYUN_SMS_TEMPLATE_DEFAULT';
      if (v == null) delete process.env[key];
      else process.env[key] = v;
    });
  }
});

test('querySmsTemplate parses Aliyun RPC response', async () => {
  const prev = {
    id: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    secret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
  };
  process.env.ALIYUN_SMS_ACCESS_KEY_ID = 'ak-test';
  process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = 'sk-test';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      Code: 'OK',
      TemplateCode: 'SMS_001',
      TemplateContent: '您的验证码${code}',
      TemplateStatus: 1,
      Reason: '',
    }),
  });
  try {
    const tpl = await querySmsTemplate('SMS_001');
    assert.equal(tpl.template_code, 'SMS_001');
    assert.equal(tpl.status, 1);
    assert.match(tpl.content, /验证码/);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev.id == null) delete process.env.ALIYUN_SMS_ACCESS_KEY_ID;
    else process.env.ALIYUN_SMS_ACCESS_KEY_ID = prev.id;
    if (prev.secret == null) delete process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
    else process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = prev.secret;
  }
});
