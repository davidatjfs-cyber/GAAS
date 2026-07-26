/**
 * post-route quality 纯逻辑单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFactDemand,
  isDataBackedReply,
  computeSourceCoverage,
  computeResponseConfidence,
  applyFactDemandGuardrail,
  enrichAgentEvidenceMeta,
  needsAutonomousDataTask,
  FACTUAL_DATA_UNAVAILABLE_MESSAGE,
} from '../quality-helpers.js';
import { applyPostRouteQualityGates } from '../post-route-quality.js';

test('detectFactDemand hard/soft/none', () => {
  assert.equal(detectFactDemand('近7天营业额多少'), 'hard');
  assert.equal(detectFactDemand('考核说明一下'), 'soft');
  assert.equal(detectFactDemand('你好'), 'none');
  assert.equal(detectFactDemand(''), 'none');
});

test('isDataBackedReply', () => {
  assert.equal(isDataBackedReply({ deterministic: true }), true);
  assert.equal(isDataBackedReply({ source: 'daily_reports' }), true);
  assert.equal(isDataBackedReply({}), false);
  assert.equal(isDataBackedReply(null), false);
});

test('applyFactDemandGuardrail blocks hard without data', () => {
  const metrics = [];
  const r = applyFactDemandGuardrail(
    { text: '营业额多少', response: '大概还行', agentData: { route: 'data_auditor' } },
    { markQualityMetric: (f, d) => metrics.push([f, d]) }
  );
  assert.equal(r.response, FACTUAL_DATA_UNAVAILABLE_MESSAGE);
  assert.equal(r.agentData.factualGuardrailBlocked, true);
  assert.equal(r.agentData.factDemand, 'hard');
  assert.deepEqual(metrics, [['factualBlocks', 1]]);
});

test('applyFactDemandGuardrail passes when deterministic', () => {
  const r = applyFactDemandGuardrail({
    text: '营业额多少',
    response: '营收 12 万',
    agentData: { deterministic: true, source: 'daily_reports' },
  });
  assert.equal(r.response, '营收 12 万');
  assert.equal(r.agentData.factDemand, 'hard');
  assert.equal(r.agentData.factualGuardrailBlocked, undefined);
});

test('computeSourceCoverage / confidence', () => {
  assert.equal(computeSourceCoverage({ deterministic: true }), 1);
  assert.equal(
    computeSourceCoverage({
      sourceAuditRows: [{ status: 'ok' }, { status: 'missing' }],
    }),
    0.5
  );
  const conf = computeResponseConfidence('data_auditor', '这是一段足够长的回复内容', {
    deterministic: true,
    grounded: true,
    source: 'x',
  });
  assert.ok(conf >= 0.8 && conf <= 0.99);
});

test('enrichAgentEvidenceMeta', () => {
  const r = enrichAgentEvidenceMeta({
    response: 'ok',
    agentData: { deterministic: true, source: 'daily_reports' },
    route: 'data_auditor',
    store: 'S1',
    brand: '洪潮',
  });
  assert.equal(r.evidence.store, 'S1');
  assert.equal(r.agentData.sourceCoverage, 1);
  assert.ok(typeof r.agentData.confidence === 'number');
});

test('needsAutonomousDataTask', () => {
  assert.equal(needsAutonomousDataTask({ factualGuardrailBlocked: true }), true);
  assert.equal(needsAutonomousDataTask({ reason: 'insufficient_sources' }), true);
  assert.equal(needsAutonomousDataTask({ deterministic: true }), false);
});

test('applyPostRouteQualityGates wires guardrail + gate + evidence', async () => {
  const metrics = [];
  const r = await applyPostRouteQualityGates(
    {
      text: '营业额多少',
      route: 'data_auditor',
      response: '瞎猜',
      agentData: {},
      senderUsername: 'u1',
      senderRole: 'admin',
      store: 'S1',
      brand: '洪潮',
    },
    {
      markQualityMetric: (f) => metrics.push(f),
      enforceUnifiedQualityGate: async ({ response, agentData }) => ({
        response: response + '|qg',
        agentData: { ...agentData, qualityAudit: { pass: true } },
      }),
    }
  );
  assert.ok(r.response.startsWith(FACTUAL_DATA_UNAVAILABLE_MESSAGE));
  assert.ok(r.response.endsWith('|qg'));
  assert.equal(r.agentData.factualGuardrailBlocked, true);
  assert.equal(r.evidence.store, 'S1');
  assert.ok(metrics.includes('factualBlocks'));
});
