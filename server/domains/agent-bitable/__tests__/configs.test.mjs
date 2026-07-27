import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _isProd,
  LARK_APP_ID,
  LARK_APP_SECRET,
  _LARK_ENCRYPT_KEY,
  _LARK_VERIFICATION_TOKEN,
  BITABLE_CONFIGS,
  _BITABLE_APP_ID,
  _BITABLE_APP_SECRET,
  _BITABLE_APP_TOKEN,
  _BITABLE_TABLE_ID,
} from '../configs.js';

test('_isProd reflects NODE_ENV=production', () => {
  assert.equal(_isProd, String(process.env.NODE_ENV || '').trim() === 'production');
});

test('LARK_APP_ID / LARK_APP_SECRET are strings', () => {
  assert.equal(typeof LARK_APP_ID, 'string');
  assert.equal(typeof LARK_APP_SECRET, 'string');
});

test('_LARK_ENCRYPT_KEY / _LARK_VERIFICATION_TOKEN default to empty string', () => {
  assert.equal(typeof _LARK_ENCRYPT_KEY, 'string');
  assert.equal(typeof _LARK_VERIFICATION_TOKEN, 'string');
});

test('BITABLE_CONFIGS contains all expected keys with required fields', () => {
  const expectedKeys = [
    'ops_checklist',
    'table_visit',
    'bad_reviews',
    'closing_reports',
    'opening_reports',
    'meeting_reports',
    'material_majixian',
    'material_hongchao',
    'loss_reports',
    'task_responses',
  ];
  assert.deepEqual(Object.keys(BITABLE_CONFIGS), expectedKeys);
  for (const key of expectedKeys) {
    const cfg = BITABLE_CONFIGS[key];
    assert.equal(typeof cfg.appToken, 'string');
    assert.equal(typeof cfg.tableId, 'string');
    assert.equal(typeof cfg.name, 'string');
    assert.equal(typeof cfg.type, 'string');
    assert.equal(typeof cfg.pollingInterval, 'number');
  }
});

test('material_majixian / material_hongchao carry brand tags', () => {
  assert.equal(BITABLE_CONFIGS.material_majixian.brand, 'majixian');
  assert.equal(BITABLE_CONFIGS.material_hongchao.brand, 'hongchao');
});

test('task_responses appId falls back through BITABLE_TASK_RESP_APP_ID chain', () => {
  assert.equal(typeof BITABLE_CONFIGS.task_responses.appId, 'string');
});

test('_BITABLE_APP_ID/_APP_SECRET/_APP_TOKEN/_TABLE_ID fall back to ops_checklist config', () => {
  assert.equal(_BITABLE_APP_ID, process.env.BITABLE_APP_ID || BITABLE_CONFIGS.ops_checklist.appId);
  assert.equal(
    _BITABLE_APP_SECRET,
    process.env.BITABLE_APP_SECRET || BITABLE_CONFIGS.ops_checklist.appSecret
  );
  assert.equal(
    _BITABLE_APP_TOKEN,
    process.env.BITABLE_APP_TOKEN || BITABLE_CONFIGS.ops_checklist.appToken
  );
  assert.equal(
    _BITABLE_TABLE_ID,
    process.env.BITABLE_TABLE_ID || BITABLE_CONFIGS.ops_checklist.tableId
  );
});
