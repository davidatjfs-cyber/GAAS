import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getKnowledgeExplanation,
  putKnowledgeExplanation,
  reformatExplanation,
  regenerateExplanation,
} from '../service.js';

const id = '550e8400-e29b-41d4-a716-446655440000';

function makePool(row, calls = []) {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id, title, content/i.test(sql)) return { rows: row ? [row] : [] };
      if (/SELECT ai_explanation/i.test(sql)) return { rows: row ? [row] : [] };
      return { rows: [], rowCount: 1 };
    },
  };
}

test('getKnowledgeExplanation returns locked explanation without LLM call', async () => {
  const result = await getKnowledgeExplanation(
    {
      pool: makePool({ ai_explanation: '管理员锁定内容', ai_explanation_locked: true, step_rubric: { steps: [] } }),
      callLLM: async () => { throw new Error('must not call'); },
    },
    { role: 'admin', id }
  );

  assert.deepEqual(result, {
    ok: true, success: true, explanation: '管理员锁定内容', cached: true, locked: true, rubric: { steps: [] },
  });
});

test('getKnowledgeExplanation generates SOP, handbook, and standard explanations', async () => {
  const cases = [
    { title: '煎制SOP', content: 'SOP 步骤1：预热锅具并检查温度。质量标准是表面金黄，常见失败是焦糊。' },
    { title: '员工培训手册', content: '第一章 前厅服务规范。第二章 后厨培训要求。每个岗位必须完成考核。' },
    { title: '收银培训', content: '收银员每天交班前核对现金和电子支付金额，确认无误后填写交接记录。' },
  ];

  for (const item of cases) {
    const calls = [];
    const result = await getKnowledgeExplanation(
      {
        pool: makePool({ ...item, file_type: 'text/plain', ai_explanation: null, ai_explanation_locked: false }, calls),
        callLLM: async (messages) => {
          assert.equal(messages.length, 2);
          return { content: '这是一段足够长的AI解析内容，用于验证生成成功并写入知识库缓存，同时确保超过服务要求的五十个字符长度。' };
        },
      },
      { role: 'admin', id }
    );

    assert.equal(result.ok, true);
    assert.equal(result.success, true);
    assert.ok(calls.some((call) => /UPDATE knowledge_base SET ai_explanation/i.test(call.sql)));
  }
});

test('getKnowledgeExplanation rejects unavailable content and non-admin viewers', async () => {
  const noContent = await getKnowledgeExplanation(
    {
      pool: makePool({ title: '空文档', content: '', file_type: 'text/plain', ai_explanation: null, ai_explanation_locked: false }),
      callLLM: async () => ({ content: '' }),
    },
    { role: 'admin', id }
  );
  assert.equal(noContent.error, 'no_content');

  const denied = await getKnowledgeExplanation({ pool: makePool(), callLLM: async () => ({}) }, { role: 'employee', id });
  assert.equal(denied.error, 'admin_only');
});

test('putKnowledgeExplanation, reformatExplanation, and regenerateExplanation persist explanation state', async () => {
  const calls = [];
  const pool = makePool({ ai_explanation: '这是一段已有的解析内容，长度足够用于重新整理排版。' }, calls);
  const ctx = {
    pool,
    callLLM: async () => ({ content: '这是一段重新排版后的解析内容，长度足够用于验证成功。' }),
    resolveTenantIdDefault: () => 'default',
  };

  const saved = await putKnowledgeExplanation(ctx, { role: 'admin', id, explanation: '手动精修后的解析内容', username: 'boss' });
  assert.equal(saved.locked, true);

  const reformatted = await reformatExplanation(ctx, { role: 'admin', id, username: 'boss' });
  assert.equal(reformatted.success, true);

  const regenerated = await regenerateExplanation(ctx, { role: 'admin', id });
  assert.equal(regenerated.success, true);
  assert.ok(calls.filter((call) => /UPDATE knowledge_base SET ai_explanation/i.test(call.sql)).length >= 3);
});
