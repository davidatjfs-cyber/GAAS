import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeLLMOutput,
  sanitizeLLMOutputWithAudit,
} from '../utils/llm-output-sanitize.js';

test('sanitizeLLMOutput：剥离零宽与控制字符，保留换行', async () => {
  assert.equal(sanitizeLLMOutput(''), '');
  assert.equal(sanitizeLLMOutput(null), '');
  const dirty = `hello\u200B\u0001world\nline`;
  assert.equal(sanitizeLLMOutput(dirty), 'helloworld\nline');
  assert.equal(sanitizeLLMOutput('ok\tkeep'), 'ok\tkeep');
  // 覆盖更多 Cc：VT/FF/DEL/0x0E
  assert.equal(sanitizeLLMOutput('a\u000B\u000C\u000E\u007Fb'), 'ab');
  assert.equal(await sanitizeLLMOutputWithAudit(null, 'x\uFEFFy'), 'xy');
});

test('sanitizeLLMOutputWithAudit：命中时写 warning 审计', async () => {
  const ops = [];
  const pool = {
    query: async (sql, params) => {
      ops.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  const clean = await sanitizeLLMOutputWithAudit(pool, 'plain', { agentName: 't' });
  assert.equal(clean, 'plain');
  assert.equal(ops.length, 0);

  const out = await sanitizeLLMOutputWithAudit(pool, 'a\u200Bb', {
    agentName: 't',
    tenantId: 'default',
  });
  assert.equal(out, 'ab');
  assert.equal(ops.length, 1);
  assert.match(ops[0].sql, /INSERT INTO agent_operation_log/i);
  assert.equal(ops[0].params[3], 'llm_output_sanitize');
  assert.equal(ops[0].params[7], 'warning');
});
