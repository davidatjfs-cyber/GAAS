import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateIncidentCards, buildFromTableVisit, buildFromBadReview, rejectTwinCard,
  setTwinCardActive,
} from '../incident-generator.js';

function mockPool(rowsFor = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM table_visit_records')) return { rows: rowsFor.tv || [] };
      if (sql.includes('content_type')) return { rows: rowsFor.br || [] };
      return { rows: [] };
    },
  };
}

test('桌访真实客诉 → 事故卡（催菜）', () => {
  const row = {
    id: 1,
    date: '2026-03-24',
    store: '马己仙大宁店',
    satisfaction_level: '不满意',
    repeat_customer: false,
    feedback: '',
    customer_complaint: '等了30分钟菜还没上',
    dissatisfaction_dish: '炒吊龙',
    complaint_resolution: null,
    guest_count: 2,
    amount: 200,
  };
  const card = buildFromTableVisit(row);
  assert.ok(card);
  assert.equal(card.card_key, 'twin_tv_1');
  assert.equal(card.category_key, 'dine_complaint');
  assert.ok(card.locked_facts.length >= 2);
  assert.ok(card.locked_facts.some((f) => f.includes('炒吊龙')));
  assert.equal(card.meta.source, 'customer_twin');
  assert.equal(card.meta.source_table, 'table_visit_records');
});

test('无实质内容的桌访行不生成卡片', () => {
  const row = {
    id: 2, date: '2026-03-24', store: '马己仙大宁店', satisfaction_level: '满意',
    feedback: '', customer_complaint: '', dissatisfaction_dish: '',
  };
  assert.equal(buildFromTableVisit(row), null);
});

test('差评（外卖超时）→ 事故卡归入外卖客诉类', () => {
  const row = {
    id: 'abc-123',
    agent_data: {
      store: '洪潮大宁久光店', date: '未提及', platform: '大众点评',
      product: '外卖', reason: '外卖超时，餐洒了，汤全漏了', recordId: 'recX',
    },
  };
  const card = buildFromBadReview(row);
  assert.ok(card);
  assert.equal(card.card_key, 'twin_br_abc-123');
  assert.equal(card.category_key, 'delivery_complaint');
  assert.ok(card.locked_facts.some((f) => f.includes('大众点评')));
});

test('差评假阳性（好评/无内容）不生成卡片', () => {
  const row1 = { id: 'bad1', agent_data: { store: '马己仙大宁店', reason: '该评价为好评，不属于差评' } };
  assert.equal(buildFromBadReview(row1), null);
  const row2 = { id: 'bad2', agent_data: { store: '马己仙大宁店', reason: '无' } };
  assert.equal(buildFromBadReview(row2), null);
});

test('generateIncidentCards：写入 job_coach_incident_cards 且 active=false', async () => {
  const pool = mockPool({
    tv: [{
      id: 1, date: '2026-03-24', store: '马己仙大宁店', satisfaction_level: '不满意',
      feedback: '', customer_complaint: '上错菜了', dissatisfaction_dish: '烧鹅',
    }],
    br: [{
      id: 'br1',
      agent_data: { store: '洪潮大宁久光店', reason: '鱼生不鲜，鱼饭腥', recordId: 'recY' },
    }],
  });
  const result = await generateIncidentCards(pool, { limitPerSource: 5 });
  assert.equal(result.candidates, 2);
  assert.equal(result.upserted, 2);
  const inserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO job_coach_incident_cards'));
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every((c) => c.sql.includes('FALSE') && c.sql.includes('$18::jsonb')));
  assert.ok(inserts.every((c) => c.sql.includes("meta->>'review_status' IS NULL")), '已处理来源不得被重新更新');
  const keys = inserts.map((c) => c.params[0]).sort();
  assert.deepEqual(keys, ['twin_br_br1', 'twin_tv_1']);
});

test('拒绝=软删除：标记 rejected 且只允许 customer_twin 来源', async () => {
  let captured = null;
  const pool = {
    query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ card_key: 'twin_tv_1' }] };
    },
  };
  const row = await rejectTwinCard(pool, 'twin_tv_1', 'admin');
  assert.equal(row.card_key, 'twin_tv_1');
  assert.ok(captured.sql.includes("meta->>'source' = 'customer_twin'"));
  assert.ok(captured.sql.includes('review_status'));
  assert.ok(captured.sql.includes('active = FALSE'));
  assert.deepEqual(captured.params, ['twin_tv_1', 'admin']);
});

test('审核通过：标记 approved 且不引用不存在的 updated_at 列', async () => {
  let captured = null;
  const pool = {
    query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ card_key: 'twin_tv_1' }] };
    },
  };
  await setTwinCardActive(pool, 'twin_tv_1', true, 'admin');
  assert.ok(captured.sql.includes('SET active'));
  assert.ok(captured.sql.includes('review_status'));
  assert.ok(!captured.sql.includes('updated_at'), '表无 updated_at 列，禁止在 UPDATE 中引用');
  assert.deepEqual(captured.params, ['twin_tv_1', true, 'approved', 'admin']);
});
