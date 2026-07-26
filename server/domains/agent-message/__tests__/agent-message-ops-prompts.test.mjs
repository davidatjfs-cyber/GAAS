/**
 * ops 图片审核文案 + prompt 组装单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOpsImageAuditResponse,
  tryHandleOpsSupervisorImages,
  buildOpsSupervisorLlmSystemPrompt,
} from '../ops-supervisor-helpers.js';
import {
  shortStoreRoleLabel,
  buildAppealSystemPrompt,
  buildAppealUserMessage,
  buildGeneralAssistantSystemPrompt,
} from '../prompt-helpers.js';

test('formatOpsImageAuditResponse branches', () => {
  assert.ok(formatOpsImageAuditResponse([{ duplicate: true }]).includes('重复'));
  assert.ok(
    formatOpsImageAuditResponse([{ result: 'pass', findings: '干净' }]).includes('合格')
  );
  assert.ok(
    formatOpsImageAuditResponse([{ result: 'fail', findings: '脏' }]).includes('未通过')
  );
  assert.ok(formatOpsImageAuditResponse([{ result: 'pending' }]).includes('人工复核'));
  // [].every(pass) === true，与原 agents.js 行为一致
  assert.ok(formatOpsImageAuditResponse([]).includes('合格'));
});

test('tryHandleOpsSupervisorImages', async () => {
  const miss = await tryHandleOpsSupervisorImages(
    { imageUrls: [], route: 'ops_supervisor' },
    { auditImage: async () => ({ result: 'pass' }) }
  );
  assert.equal(miss.handled, false);

  const hit = await tryHandleOpsSupervisorImages(
    {
      imageUrls: ['http://a', 'http://b'],
      store: 'S',
      brand: '洪潮',
      senderUsername: 'u1',
      route: 'ops_supervisor',
      brandId: 'hc',
      brandConfig: {},
    },
    {
      auditImage: async (url) => ({
        result: 'pass',
        findings: url.includes('a') ? 'ok1' : 'ok2',
      }),
    }
  );
  assert.equal(hit.handled, true);
  assert.ok(hit.response.includes('合格'));
  assert.equal(hit.agentData.auditResults.length, 2);
});

test('prompt helpers', () => {
  assert.equal(shortStoreRoleLabel('store_manager'), '店长');
  assert.equal(shortStoreRoleLabel('x'), '员工');
  assert.ok(buildAppealSystemPrompt({ nowText: 'T', activeTaskContext: '' }).includes('申诉'));
  assert.ok(
    buildAppealUserMessage({
      senderName: '张三',
      store: 'A',
      senderRole: 'store_manager',
      text: '不公平',
    }).includes('店长')
  );
  assert.ok(
    buildGeneralAssistantSystemPrompt({
      nowText: 'T',
      store: 'A',
      brand: '洪潮',
      senderName: '张三',
      senderRole: 'store_employee',
      activeTaskContext: '',
    }).includes('运营任务中心')
  );
  assert.ok(
    buildOpsSupervisorLlmSystemPrompt({
      nowText: 'T',
      store: 'A',
      brand: '洪潮',
      activeTaskContext: '',
    }).includes('营运检查')
  );
});
