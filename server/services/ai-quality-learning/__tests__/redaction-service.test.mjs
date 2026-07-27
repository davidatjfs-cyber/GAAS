import assert from 'node:assert/strict';
import test from 'node:test';

import { redactLearningText, sanitizeJson, sha256 } from '../redaction-service.js';

test('sha256 hashes strings deterministically and tolerates empty input', () => {
  assert.equal(sha256('hello'), sha256('hello'));
  assert.notEqual(sha256('hello'), sha256('world'));
  assert.equal(sha256(''), sha256(null));
  assert.equal(sha256('x').length, 64);
});

test('redactLearningText removes direct identifiers and secrets', () => {
  const source = '手机 13812345678，邮箱 boss@example.com，身份证 110101199001011234，api_key=sk-live-secret';
  const result = redactLearningText(source);
  assert.equal(result.text.includes('13812345678'), false);
  assert.equal(result.text.includes('boss@example.com'), false);
  assert.equal(result.text.includes('110101199001011234'), false);
  assert.equal(result.text.includes('sk-live-secret'), false);
  assert.equal(result.report.replacements.phone, 1);
  assert.equal(result.report.replacements.email, 1);
  assert.equal(result.report.replacements.id_card, 1);
  assert.equal(result.report.replacements.secret, 1);
  assert.equal(result.report.truncated, false);
});

test('redactLearningText removes operational identity, entity, address, url, ip, bank card, open_id and account labels', () => {
  const source = '联系人：张三，门店：幸福路旗舰店，地址：上海市浦东新区幸福路88号，'
    + '来源 https://example.com/a?token=abc，IP 8.8.8.8，'
    + 'Authorization: Bearer abcdef1234567890，银行卡 6222021234567890123，'
    + '客户 ou_abcdef123456789，账号：admin_007';
  const result = redactLearningText(source);
  assert.equal(result.text.includes('张三'), false);
  assert.equal(result.text.includes('幸福路旗舰店'), false);
  assert.equal(result.text.includes('幸福路88号'), false);
  assert.equal(result.text.includes('example.com'), false);
  assert.equal(result.text.includes('8.8.8.8'), false);
  assert.equal(result.text.includes('abcdef1234567890'), false);
  assert.equal(result.text.includes('6222021234567890123'), false);
  assert.equal(result.text.includes('ou_abcdef123456789'), false);
  assert.equal(result.text.includes('admin_007'), false);
  assert.equal(result.report.replacements.authorization, 1);
  assert.equal(result.report.replacements.bank_card, 1);
  assert.equal(result.report.replacements.open_id, 1);
  assert.equal(result.report.replacements.account_id, 1);
  assert.equal(result.report.replacements.labeled_person, 1);
  assert.equal(result.report.replacements.labeled_entity, 1);
  assert.equal(result.report.replacements.address, 1);
  assert.equal(result.report.replacements.url, 1);
  assert.equal(result.report.replacements.ipv4, 1);
});

test('redactLearningText truncates and reports truncation past the max length', () => {
  const longText = 'a'.repeat(7000);
  const result = redactLearningText(longText);
  assert.equal(result.text.length, 6000);
  assert.equal(result.report.truncated, true);
});

test('sanitizeJson redacts flagged keys, recurses into nested structures, and caps depth/size', () => {
  const nested = { phone: '13812345678', child: { child: { child: { child: { child: { child: 'too-deep' } } } } } };
  const out = sanitizeJson(nested);
  assert.equal(out.phone, '[SECRET_REDACTED]');
  assert.equal(out.child.child.child.child.child.child, '[DEPTH_LIMIT]');

  assert.equal(sanitizeJson(null), null);
  assert.equal(sanitizeJson(42), 42);
  assert.equal(sanitizeJson(true), true);
  assert.equal(sanitizeJson('secret=abcd1234'), '[SECRET_REDACTED]');
  assert.equal(sanitizeJson(Symbol.for('x')), 'Symbol(x)');

  const bigArray = Array.from({ length: 150 }, (_, i) => i);
  assert.equal(sanitizeJson(bigArray).length, 100);

  const bigObject = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`key${i}`, i]));
  assert.equal(Object.keys(sanitizeJson(bigObject)).length, 100);
});
