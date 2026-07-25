import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { createFeishuBitableHelpers } from '../domains/feishu-bitable/create-helpers.js';
import {
  tryParseJson,
  decryptFeishuEncryptPayload,
} from '../domains/feishu-bitable/crypto.js';

const helpers = createFeishuBitableHelpers({
  pool: null,
  axios: null,
  isExternalEnabled: () => false,
  safeErrMessage: (e) => String(e?.message || e || 'internal_error'),
  notifyAdminsDualWriteFailure: async () => {},
  feishuEnv: { encryptKey: '' },
});

function encryptWithKey(plain, encryptKey) {
  let keyBuf = Buffer.from(String(encryptKey || ''), 'base64');
  if (keyBuf.length !== 32) {
    keyBuf = Buffer.from(String(encryptKey || ''), 'utf8');
    if (keyBuf.length < 32) keyBuf = Buffer.concat([keyBuf, Buffer.alloc(32 - keyBuf.length)]);
    if (keyBuf.length > 32) keyBuf = keyBuf.subarray(0, 32);
  }
  const iv = keyBuf.subarray(0, 16);
  const cipher = createCipheriv('aes-256-cbc', keyBuf, iv);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

test('tryParseJson: 合法 JSON 解析为对象', () => {
  assert.deepEqual(helpers.tryParseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParseJson('{"b":2}'), { b: 2 });
});

test('tryParseJson: 非法 JSON 返回 null', () => {
  assert.equal(helpers.tryParseJson('{bad'), null);
  assert.equal(helpers.tryParseJson(''), null);
  assert.equal(helpers.tryParseJson(null), null);
});

test('decryptFeishuEncryptPayload: 缺 key / 空 payload / utf8 填充与截断 / base64-32', () => {
  assert.throws(
    () => helpers.decryptFeishuEncryptPayload('dGVzdA=='),
    (err) => err instanceof Error && err.message === 'missing_feishu_encrypt_key'
  );
  assert.throws(
    () => decryptFeishuEncryptPayload('', 'short-key'),
    (err) => err instanceof Error && err.message === 'invalid_encrypt_payload'
  );
  const short = 'k';
  assert.equal(decryptFeishuEncryptPayload(encryptWithKey('hello', short), short), 'hello');
  const long = 'x'.repeat(40);
  assert.equal(decryptFeishuEncryptPayload(encryptWithKey('world', long), long), 'world');
  const b64Key = Buffer.alloc(32, 7).toString('base64');
  assert.equal(decryptFeishuEncryptPayload(encryptWithKey('ok', b64Key), b64Key), 'ok');
});
test('findConfigKeyByTableInfo: 空入参返回 null', () => {
  assert.equal(helpers.findConfigKeyByTableInfo('', 'tbl'), null);
  assert.equal(helpers.findConfigKeyByTableInfo('app', ''), null);
  assert.equal(helpers.findConfigKeyByTableInfo(null, null), null);
});

test('mapFeishuFieldToHrms table_visit: 日期+门店映射', () => {
  const mapped = helpers.mapFeishuFieldToHrms(
    {
      record_id: 'rec_test_1',
      fields: {
        日期: '2024-06-01',
        门店: '洪潮',
      },
    },
    'table_visit'
  );
  assert.equal(mapped.date, '2024-06-01');
  assert.equal(mapped.store, '洪潮');
  assert.equal(mapped.recordId, 'rec_test_1');
});
