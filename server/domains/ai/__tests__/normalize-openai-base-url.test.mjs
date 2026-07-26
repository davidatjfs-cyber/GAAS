import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenAiCompatibleBaseUrl } from '../routes-chat-completions.js';

test('empty / whitespace → empty string', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl(''), '');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('   '), '');
  assert.equal(normalizeOpenAiCompatibleBaseUrl(null), '');
  assert.equal(normalizeOpenAiCompatibleBaseUrl(undefined), '');
});

test('strips trailing slashes then appends /v1', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com/'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com///'), 'https://api.openai.com/v1');
});

test('keeps existing /v1 suffix', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
});

test('volces ark: bare host → /api/v3', () => {
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
});

test('volces ark: /v1 → /api/v3', () => {
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/v1'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/v1/'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
});

test('volces ark: already /api/v3 kept', () => {
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/api/v3/'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
});
