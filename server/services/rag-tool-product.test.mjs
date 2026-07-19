import test from 'node:test';
import assert from 'node:assert/strict';
import { setPool } from '../utils/database.js';

test('Agent 的 RAG 查询会优先返回同版本系统使用手册', async () => {
  const rawPool = {
    async connect() {
      return {
        async query(sql) {
          const text = String(sql);
          if (text.includes('pg_extension')) return { rows: [] };
          if (text.includes('FROM knowledge_base')) return { rows: [] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  setPool(rawPool);
  const { ragQuery } = await import('../rag-tool.js');
  const result = await ragQuery({
    agentName: 'master_agent',
    userRole: 'admin',
    query: '请款超过预算还能提交吗',
    limit: 5,
  });
  assert.equal(result.success, true);
  assert.ok(result.productKnowledgeVersion);
  assert.equal(result.results[0].source, 'product_knowledge');
  assert.equal(result.results[0].id, 'product:approval.budget');
  assert.match(result.results[0].content, /预算|权限说明/);
});
