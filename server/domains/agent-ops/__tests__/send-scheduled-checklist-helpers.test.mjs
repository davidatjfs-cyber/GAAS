import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduledChecklistCard,
  insertScheduledChecklistMasterTask,
} from '../send-scheduled-checklist-helpers.js';

function baseDeps(overrides = {}) {
  return {
    formatChecklistTypeLabel: (t) =>
      ({ opening: '开市', closing: '收档', hygiene: '卫生巡检' }[t] || t || '巡检'),
    getOpsChecklistItems: () => ['地面卫生', '设备关闭'],
    opsTaskReplyAuditLarkMd: '**审核要求**',
    nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'),
    ...overrides,
  };
}

test('buildScheduledChecklistCard: opening 蓝色 + formUrl 按钮', () => {
  const { card, typeLabel, timeWindow } = buildScheduledChecklistCard(
    { checkType: 'opening', formUrl: 'https://example.com/form', timeWindow: 30 },
    { name: '洪潮久光店', brand: '洪潮' },
    '洪潮品牌',
    baseDeps()
  );

  assert.equal(typeLabel, '开市');
  assert.equal(timeWindow, 30);
  assert.equal(card.header.template, 'blue');
  assert.match(card.header.title.content, /开市检查通知/);
  const body = JSON.stringify(card);
  assert.match(body, /洪潮久光店/);
  assert.match(body, /洪潮品牌/);
  assert.match(body, /打开检查表/);
  assert.match(body, /example\.com\/form/);
  assert.match(body, /审核要求/);
});

test('buildScheduledChecklistCard: closing 橙色 + 默认 formUrl', () => {
  const { card } = buildScheduledChecklistCard(
    { checkType: 'closing', formUrl: '', timeWindow: 3 },
    { name: '马己仙店', brand: '马己仙' },
    '',
    baseDeps()
  );

  assert.equal(card.header.template, 'orange');
  assert.match(JSON.stringify(card), /feishu\.cn\/base/);
  assert.match(JSON.stringify(card), /完成时限/);
});

test('buildScheduledChecklistCard: 无 formUrl 时内联检查项', () => {
  const { card } = buildScheduledChecklistCard(
    { checkType: 'hygiene', formUrl: '' },
    { name: '测试店' },
    undefined,
    baseDeps({ getOpsChecklistItems: () => [] })
  );

  const body = JSON.stringify(card);
  assert.match(body, /检查项目/);
  assert.match(body, /现场完成巡检/);
  assert.doesNotMatch(body, /打开检查表/);
  assert.match(body, /"-"|"\\-"|品牌/);
});

test('buildScheduledChecklistCard: timeWindow 下限 5 分钟', () => {
  const { timeWindow } = buildScheduledChecklistCard(
    { checkType: 'opening', formUrl: 'https://x.test', timeWindow: 2 },
    { name: '店' },
    '',
    baseDeps()
  );
  assert.equal(timeWindow, 5);
});

test('insertScheduledChecklistMasterTask: 写入 master_tasks 并记录日志', async () => {
  const queries = [];
  const logCalls = [];
  const pool = () => ({
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  });

  await insertScheduledChecklistMasterTask(pool, {
    store: { name: '洪潮久光店', brand: '洪潮' },
    configBrand: '洪潮',
    username: 'mgr1',
    targets: [{ username: 'mgr1', role: 'store_manager' }],
    typeLabel: '开市',
    timeWindow: 45,
    deadlineAt: '07/26 10:30',
    cardResult: { data: { data: { message_id: 'msg_abc' } } },
    nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'),
    randomFn: () => 0.1234,
    log: { info: (p) => logCalls.push(p) },
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO master_tasks/);
  assert.match(queries[0].params[0], /^OPS-20260726-1234$/);
  assert.equal(queries[0].params[2], 'scheduled_checklist');
  assert.equal(queries[0].params[6], 'mgr1');
  assert.equal(queries[0].params[7], 'store_manager');
  assert.equal(queries[0].params[10], JSON.stringify(['msg_abc']));
  assert.equal(logCalls[0].msg, 'created_master_task');
});

test('insertScheduledChecklistMasterTask: 无 message_id 时 feishu_msg_ids 为空数组', async () => {
  const queries = [];
  await insertScheduledChecklistMasterTask(
    () => ({
      query: async (_sql, params) => {
        queries.push(params);
      },
    }),
    {
      store: { name: '店' },
      configBrand: '',
      username: 'u1',
      targets: [],
      typeLabel: '收档',
      timeWindow: 60,
      deadlineAt: '07/26 11:00',
      cardResult: { ok: true },
      nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'),
      randomFn: () => 0.99,
      log: { info: () => {} },
    }
  );
  assert.equal(queries[0][10], '[]');
  assert.equal(queries[0][7], 'store_manager');
});
