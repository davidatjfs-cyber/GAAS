import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNumericLiterals,
  fallbackQualityAudit,
  normalizeLlmAuditResult,
  normalizePlainText,
  safeJsonParse,
  verifyNumericGrounding,
} from '../check-agent-quality-helpers.js';
import {
  checkAgentAuditBody,
  enforceUnifiedQualityGateBody,
  runWithCheckAgentBody,
} from '../check-agent-quality-io.js';
import { createCheckAgentQualityApi } from '../check-agent-quality.js';

test('helpers: parse / normalize / numeric grounding', () => {
  assert.equal(normalizePlainText('  a\n\tb  ', 10), 'a b');
  assert.deepEqual(safeJsonParse('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(safeJsonParse('not json', null), null);
  assert.deepEqual(extractNumericLiterals('营收 12.5% 和 3'), ['12.5%', '3']);
  assert.equal(verifyNumericGrounding('营收 10', '证据无数字').ok, false);
  assert.equal(verifyNumericGrounding('营收 10', '证据含 10').ok, true);
  const empty = fallbackQualityAudit('多少营收', '');
  assert.equal(empty.pass, false);
  // 默认分约 6.3，短回复会再扣 relevance → 明确不通过
  const short = fallbackQualityAudit('你好', '太短了');
  assert.equal(short.pass, false);
  assert.equal(normalizeLlmAuditResult(null), null);
  assert.equal(normalizeLlmAuditResult({ accuracy: 8, relevance: 8, tone: 8, pass: true }).total, 8);
});

test('checkAgentAuditBody uses LLM JSON then fallback', async () => {
  const pass = await checkAgentAuditBody(
    {
      callLLM: async () => ({
        content: JSON.stringify({ accuracy: 9, relevance: 9, tone: 9, total: 9, pass: true, feedback: '' }),
      }),
      log: { error() {}, info() {} },
    },
    'q',
    'answer',
    'data_auditor'
  );
  assert.equal(pass.pass, true);

  const fb = await checkAgentAuditBody(
    {
      callLLM: async () => {
        throw new Error('llm down');
      },
      log: { error() {}, info() {} },
    },
    '多少营收',
    '',
    'data_auditor'
  );
  assert.equal(fb.pass, false);
});

test('runWithCheckAgentBody skips non-check routes and rewrites on fail', async () => {
  const metrics = [];
  const skipped = await runWithCheckAgentBody(
    {
      callLLM: async () => ({ content: '{}' }),
      log: { error() {}, info() {} },
      markQualityMetric: (f) => metrics.push(f),
      recordAgentQualityAudit: async () => {},
    },
    'hi',
    'general',
    async () => 'raw'
  );
  assert.equal(skipped, 'raw');
  assert.equal(metrics.length, 0);

  let audits = 0;
  const out = await runWithCheckAgentBody(
    {
      callLLM: async () => {
        audits += 1;
        if (audits === 1) {
          return {
            content: JSON.stringify({ accuracy: 3, relevance: 3, tone: 3, total: 3, pass: false, feedback: '改' }),
          };
        }
        return {
          content: JSON.stringify({ accuracy: 9, relevance: 9, tone: 9, total: 9, pass: true, feedback: '' }),
        };
      },
      log: { error() {}, info() {} },
      markQualityMetric: (f) => metrics.push(f),
      recordAgentQualityAudit: async () => {},
    },
    '绩效如何',
    'chief_evaluator',
    async (feedback) => (feedback ? '重写后的足够长回复内容' : '初稿太短'),
    2
  );
  assert.match(out, /重写/);
  assert.ok(metrics.includes('rewrites'));
});

test('enforceUnifiedQualityGateBody deterministic skip and numeric block', async () => {
  const api = createCheckAgentQualityApi({
    callLLM: async () => ({
      content: JSON.stringify({ accuracy: 9, relevance: 9, tone: 9, total: 9, pass: true, feedback: '' }),
    }),
    log: { error() {}, info() {} },
    markQualityMetric() {},
    recordAgentQualityAudit: async () => {},
  });

  const det = await api.enforceUnifiedQualityGate({
    userQuery: '多少',
    route: 'data_auditor',
    response: 'x',
    agentData: { deterministic: true },
    senderUsername: 'u',
    senderRole: 'admin',
    store: '洪潮',
    brand: '洪潮',
  });
  assert.equal(det.agentData.qualityAudit.skipped, 'deterministic');

  // evidence JSON 含 generatedAt 日期数字；需多个无法对上的数字才触发拦截阈值
  const blocked = await enforceUnifiedQualityGateBody(
    {
      callLLM: async () => ({
        content: JSON.stringify({ accuracy: 9, relevance: 9, tone: 9, total: 9, pass: true, feedback: '' }),
      }),
      log: { error() {}, info() {} },
      markQualityMetric() {},
      recordAgentQualityAudit: async () => {},
    },
    {
      userQuery: '洪潮店营业额多少',
      route: 'data_auditor',
      response: '营业额 111 222 333 444',
      agentData: { groundingFacts: '无数字' },
      senderUsername: 'u',
      senderRole: 'admin',
      store: '洪潮',
      brand: '洪潮',
    }
  );
  assert.equal(blocked.agentData.numericGroundingBlocked, true);
  assert.match(blocked.response, /精确数字/);
});

test('enforceUnifiedQualityGateBody rewrites when audit fails', async () => {
  let audits = 0;
  const out = await enforceUnifiedQualityGateBody(
    {
      callLLM: async (messages) => {
        const sys = String(messages?.[0]?.content || '');
        if (sys.includes('回复重写器')) {
          return { content: '这是重写后的合规回复，已对齐可用事实。' };
        }
        audits += 1;
        if (audits === 1) {
          return {
            content: JSON.stringify({
              accuracy: 2,
              relevance: 2,
              tone: 2,
              total: 2,
              pass: false,
              feedback: '缺事实',
            }),
          };
        }
        return {
          content: JSON.stringify({
            accuracy: 9,
            relevance: 9,
            tone: 9,
            total: 9,
            pass: true,
            feedback: '',
          }),
        };
      },
      log: { error() {}, info() {} },
      markQualityMetric() {},
      recordAgentQualityAudit: async () => {},
    },
    {
      userQuery: '今天天气怎样',
      route: 'appeal',
      response: '不知道',
      agentData: {},
      senderUsername: 'u',
      senderRole: 'admin',
      store: '',
      brand: '',
    }
  );
  assert.match(out.response, /重写后/);
  assert.equal(out.agentData.qualityAudit.rewriteCount, 1);
  assert.equal(out.agentData.qualityAudit.pass, true);
});
