import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractScore,
  validateSubmissionLogic,
} from '../submission-validation-helpers.js';
import { createOpsSubmissionValidation } from '../submission-validation.js';

test('extractScore parses slash and colon forms', () => {
  assert.equal(extractScore('评分 8.5 / 10'), 8.5);
  assert.equal(extractScore('评分：7'), 7);
  assert.equal(extractScore(''), 0);
  assert.equal(extractScore('no score'), 0);
});

test('validateSubmissionLogic flags unqualified open-check without remark', () => {
  const r = validateSubmissionLogic({
    checkType: '开档检查',
    checkStatus: '不合格',
    checkRemark: '短',
    checkPhotos: [],
    submitTime: '2026-07-26T10:00:00+08:00',
  });
  assert.equal(r.isValid, false);
  assert.ok(r.issues.some((x) => x.includes('详细说明')));
});

test('validateSubmissionLogic flags open-check outside morning window', () => {
  const r = validateSubmissionLogic({
    checkType: '开档检查',
    checkStatus: '合格',
    checkRemark: 'ok',
    checkPhotos: [],
    submitTime: '2026-07-26T15:00:00+08:00',
  });
  assert.equal(r.isValid, false);
  assert.ok(r.issues.some((x) => x.includes('时间异常')));
});

test('validatePhotoAuthenticity success + duplicate path', async () => {
  const queries = [];
  const api = createOpsSubmissionValidation({
    pool: () => ({
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [{ count: 2 }] };
      },
    }),
    callVisionLLM: async () => ({ content: '地点匹配 马己仙' }),
    log: { info() {}, error() {} },
  });

  const recent = Date.now() - 60_000;
  const v = await api.validatePhotoAuthenticity(
    'https://example.com/photos/abc123.jpg',
    '马己仙',
    recent,
  );
  assert.equal(v.timeValid, true);
  assert.equal(v.notDuplicate, false);
  assert.equal(v.isAuthentic, false);
  assert.equal(v.locationMatch, true);
  assert.equal(queries.length, 1);
});

test('validatePhotoAuthenticity returns error object on vision failure', async () => {
  const api = createOpsSubmissionValidation({
    pool: () => ({ query: async () => ({ rows: [{ count: 0 }] }) }),
    callVisionLLM: async () => { throw new Error('vision down'); },
    log: { info() {}, error() {} },
  });
  const v = await api.validatePhotoAuthenticity('https://x/a.jpg', '店', Date.now());
  assert.equal(v.isAuthentic, false);
  assert.equal(v.error, 'vision down');
});

test('checkPhotoDuplicate returns false on query error', async () => {
  const api = createOpsSubmissionValidation({
    pool: () => ({
      query: async () => { throw new Error('db'); },
    }),
    callVisionLLM: async () => ({ content: '' }),
    log: { info() {}, error() {} },
  });
  assert.equal(await api.checkPhotoDuplicate('h'), false);
});

test('factory validateSubmissionLogic logs then validates', async () => {
  const infos = [];
  const api = createOpsSubmissionValidation({
    pool: () => ({ query: async () => ({ rows: [{ count: 0 }] }) }),
    callVisionLLM: async () => ({ content: '' }),
    log: { info: (...a) => infos.push(a.join(' ')), error() {} },
  });
  const r = await api.validateSubmissionLogic({
    checkType: '巡检',
    checkStatus: '合格',
    checkRemark: 'ok',
    checkPhotos: [],
    submitTime: '2026-07-26T10:00:00+08:00',
  });
  assert.equal(r.isValid, true);
  assert.ok(infos.some((x) => x.includes('validating submission logic')));
});
