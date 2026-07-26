import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVisionAuditJudgment,
  hashImageBuffer,
  parseVisionAuditLlmContent,
  auditImageBody,
} from '../audit-image-helpers.js';
import { createAuditImage } from '../audit-image.js';

const baseConfig = {
  visualInspection: { accuracyThresholds: { labelClarity: 0.8 } },
  judgmentStandards: {
    visualAccuracy: { poorQualityResponse: '环境光线不足，请打开补光灯重拍' },
    authenticity: { exifTolerance: 300 },
  },
};

test('parseVisionAuditLlmContent / hash / judgment', () => {
  const parsed = parseVisionAuditLlmContent('前置{"result":"pass","confidence":0.9,"findings":"ok","clarity":0.95}尾');
  assert.equal(parsed.result, 'pass');
  assert.equal(parsed.confidence, 0.9);
  assert.ok(hashImageBuffer(Buffer.from('abc')).length === 64);

  const lowConf = applyVisionAuditJudgment({
    result: 'pass',
    confidence: 0.5,
    findings: 'x',
    clarity: 0.95,
    duplicateOf: null,
    config: baseConfig,
    exifData: { timestamp: new Date().toISOString() },
  });
  assert.equal(lowConf.result, 'unclear');

  const dup = applyVisionAuditJudgment({
    result: 'pass',
    confidence: 0.9,
    findings: 'ok',
    clarity: 0.95,
    duplicateOf: 12,
    config: baseConfig,
    exifData: { timestamp: new Date().toISOString() },
  });
  assert.equal(dup.result, 'fail');
  assert.match(dup.findings, /重复图片/);

  const blurry = applyVisionAuditJudgment({
    result: 'pass',
    confidence: 0.9,
    findings: 'ok',
    clarity: 0.2,
    duplicateOf: null,
    config: baseConfig,
    exifData: { timestamp: new Date().toISOString() },
  });
  assert.equal(blurry.result, 'fail');
  assert.match(blurry.findings, /补光灯/);

  const stale = applyVisionAuditJudgment({
    result: 'pass',
    confidence: 0.9,
    findings: 'ok',
    clarity: 0.95,
    duplicateOf: null,
    config: baseConfig,
    exifData: { timestamp: new Date(Date.now() - 3600_000).toISOString() },
    now: new Date(),
  });
  assert.equal(stale.result, 'fail');
  assert.match(stale.findings, /拍摄时间异常/);
});

test('auditImageBody success path persists audit', async () => {
  const inserts = [];
  const audit = createAuditImage({
    pool: () => ({
      query: async (sql, params) => {
        if (/SELECT id FROM agent_visual_audits/i.test(sql)) return { rows: [] };
        if (/INSERT INTO agent_visual_audits/i.test(sql)) {
          inserts.push(params);
          return { rows: [{ id: 99 }] };
        }
        return { rows: [] };
      },
    }),
    log: { error() {} },
    callVisionLLM: async () => ({
      ok: true,
      content: '{"result":"pass","confidence":0.95,"findings":"现场清晰","clarity":0.9}',
    }),
    getOpsAgentConfig: () => baseConfig,
  });
  const r = await audit('data:image/jpeg;base64,YQ==', 'hygiene', { store: '洪潮店' });
  assert.equal(r.auditId, 99);
  assert.equal(r.result, 'pass');
  assert.equal(inserts.length, 1);
});

test('auditImageBody llm failure and duplicate fail', async () => {
  const r1 = await auditImageBody(
    {
      pool: () => ({ query: async () => ({ rows: [] }) }),
      log: { error() {} },
      callVisionLLM: async () => ({ ok: false, error: 'down' }),
      getOpsAgentConfig: () => baseConfig,
    },
    'data:image/jpeg;base64,YQ==',
    'general',
    {}
  );
  // LLM 失败时 clarity=0，判定链路会按清晰度阈值改写为光线不足
  assert.equal(r1.result, 'fail');
  assert.match(r1.findings, /补光灯|API调用失败/);

  const r2 = await auditImageBody(
    {
      pool: () => ({
        query: async (sql) => {
          if (/SELECT id FROM agent_visual_audits/i.test(sql)) return { rows: [{ id: 7 }] };
          if (/INSERT/i.test(sql)) return { rows: [{ id: 8 }] };
          return { rows: [] };
        },
      }),
      log: { error() {} },
      callVisionLLM: async () => ({
        ok: true,
        content: '{"result":"pass","confidence":0.99,"findings":"ok","clarity":0.99}',
      }),
      getOpsAgentConfig: () => baseConfig,
    },
    'data:image/jpeg;base64,YQ==',
    'plating',
    {}
  );
  assert.equal(r2.result, 'fail');
  assert.equal(r2.duplicate, true);
});
