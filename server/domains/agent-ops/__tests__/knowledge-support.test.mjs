import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchStandardOpsKnowledgeAnswer,
  mergeOpsKnowledgeResults,
  getOpsKnowledgeSupportBody,
} from '../knowledge-support-helpers.js';
import { createGetOpsKnowledgeSupport } from '../knowledge-support.js';

const knowledgeSupport = {
  standardResponses: {
    smallOysters: '生蚝SOP',
    fridgeTemperature: '冰箱SOP',
    handWashing: '洗手SOP',
  },
};

test('matchStandardOpsKnowledgeAnswer / merge results', () => {
  assert.equal(matchStandardOpsKnowledgeAnswer('冰箱温度多少', knowledgeSupport.standardResponses).response, '冰箱SOP');
  assert.equal(matchStandardOpsKnowledgeAnswer('无关问题', knowledgeSupport.standardResponses), null);
  const merged = mergeOpsKnowledgeResults(
    [{ title: 'A', content: '1' }],
    [{ content_type: 'sop', content: 'b', created_at: '2026-07-01T00:00:00Z' }]
  );
  assert.equal(merged.length, 2);
  assert.match(merged[1].title, /Bitable/);
});

test('getOpsKnowledgeSupport standard / kb / llm / fallback', async () => {
  const standard = await getOpsKnowledgeSupportBody(
    {
      log: { error() {} },
      callLLM: async () => ({ ok: false }),
      queryAgentData: async () => ({ knowledge: [], bitable: [] }),
      getOpsAgentConfig: () => ({ knowledgeSupport }),
      getOpsReasoningModel: () => 'm',
    },
    '洗手要多久',
    {}
  );
  assert.equal(standard.type, 'standard');

  const kb = await getOpsKnowledgeSupportBody(
    {
      log: { error() {} },
      callLLM: async () => ({ ok: false }),
      queryAgentData: async () => ({
        knowledge: [{ title: 'SOP', content: '细则' }],
        bitable: [],
      }),
      getOpsAgentConfig: () => ({ knowledgeSupport }),
      getOpsReasoningModel: () => 'm',
    },
    '设备怎么开',
    { store: '洪潮店', brand: '洪潮' }
  );
  assert.equal(kb.type, 'knowledge_base');
  assert.match(kb.response, /SOP/);

  const llm = await getOpsKnowledgeSupportBody(
    {
      log: { error() {} },
      callLLM: async () => ({ ok: true, content: '建议先核对' }),
      queryAgentData: async () => ({ knowledge: [], bitable: [] }),
      getOpsAgentConfig: () => ({ knowledgeSupport }),
      getOpsReasoningModel: () => 'm',
    },
    '特殊问题',
    { store: '洪潮店', brand: '洪潮' }
  );
  assert.equal(llm.type, 'llm_generated');

  const fb = await getOpsKnowledgeSupportBody(
    {
      log: { error() {} },
      callLLM: async () => {
        throw new Error('llm down');
      },
      queryAgentData: async () => {
        throw new Error('kb down');
      },
      getOpsAgentConfig: () => ({ knowledgeSupport }),
      getOpsReasoningModel: () => 'm',
    },
    '特殊问题',
    {}
  );
  assert.equal(fb.type, 'fallback');

  const api = createGetOpsKnowledgeSupport({
    log: { error() {} },
    callLLM: async () => ({ ok: false }),
    queryAgentData: async () => ({ knowledge: [], bitable: [] }),
    getOpsAgentConfig: () => ({ knowledgeSupport }),
    getOpsReasoningModel: () => 'm',
  });
  assert.equal((await api('洗手')).type, 'standard');
});
