import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeishuBitableHelpers } from '../domains/feishu-bitable/create-helpers.js';

const helpers = createFeishuBitableHelpers({
  pool: null,
  axios: null,
  isExternalEnabled: () => false,
  safeErrMessage: (e) => String(e?.message || e || 'internal_error'),
  notifyAdminsDualWriteFailure: async () => {},
  feishuEnv: { encryptKey: '' },
});

test('tryParseJson: 合法 JSON 解析为对象', () => {
  assert.deepEqual(helpers.tryParseJson('{"a":1}'), { a: 1 });
});

test('tryParseJson: 非法 JSON 返回 null', () => {
  assert.equal(helpers.tryParseJson('{bad'), null);
  assert.equal(helpers.tryParseJson(''), null);
  assert.equal(helpers.tryParseJson(null), null);
});

test('decryptFeishuEncryptPayload: 缺 key 抛 missing_feishu_encrypt_key', () => {
  assert.throws(
    () => helpers.decryptFeishuEncryptPayload('dGVzdA=='),
    (err) => err instanceof Error && err.message === 'missing_feishu_encrypt_key'
  );
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
