/**
 * 商业化验收批次1回归测试：覆盖权限矩阵、脱敏、阶段机、任务/消息/线索去重。
 * 对真实数据库运行(DATABASE_URL)，用 e2e_test_ 前缀的隔离数据，结束时清理干净。
 * 断言的是数据库最终状态，不是只看返回值/HTTP 200。
 */
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { canAccessLead, canAccessTenant, leadScopeSql, isManager, canAccessRepMetrics } from './services/sales/sales-permissions.js';
import { maskPhone, maskLeadContact, canViewFullContact } from './services/sales/sales-privacy.js';
import { canTransition } from './services/sales/sales-collaboration-service.js';
import {
  ensureSalesTables, upsertTask, addMessage, transitionLeadStage, newLeadKey,
} from './services/sales/sales-store.js';

const RUN_TAG = `e2e_test_${Date.now()}`;
let pool;
let leadId;

function log(name) { console.log(`ok ${name}`); }

async function cleanup() {
  if (!pool) return;
  await pool.query(`DELETE FROM sales_tasks WHERE dedup_key LIKE $1 OR lead_id IN (SELECT id FROM sales_leads WHERE lead_key LIKE $2)`, [`%${RUN_TAG}%`, `${RUN_TAG}%`]);
  await pool.query(`DELETE FROM sales_messages WHERE lead_id IN (SELECT id FROM sales_leads WHERE lead_key LIKE $1)`, [`${RUN_TAG}%`]);
  await pool.query(`DELETE FROM sales_stage_history WHERE lead_id IN (SELECT id FROM sales_leads WHERE lead_key LIKE $1)`, [`${RUN_TAG}%`]);
  await pool.query(`DELETE FROM sales_lead_events WHERE lead_id IN (SELECT id FROM sales_leads WHERE lead_key LIKE $1)`, [`${RUN_TAG}%`]);
  await pool.query(`DELETE FROM sales_conversations WHERE lead_id IN (SELECT id FROM sales_leads WHERE lead_key LIKE $1)`, [`${RUN_TAG}%`]);
  await pool.query(`DELETE FROM sales_leads WHERE lead_key LIKE $1`, [`${RUN_TAG}%`]);
  await pool.end();
}

async function main() {
  // ---- 纯函数：权限矩阵 + 脱敏 + 阶段机(不需要DB) ----
  {
    const managerAdmin = { username: 'boss1', role: 'super_admin' };
    const salesAdmin = { username: 'sales_a', role: 'sales' };
    const csAdmin = { username: 'cs_a', role: 'customer_service' };
    const otherSales = { username: 'sales_b', role: 'sales' };

    const leadOwnedByA = { owner_username: 'sales_a', assigned_to: null, cs_owner_username: null };
    const leadOwnedByOther = { owner_username: 'sales_c', assigned_to: null, cs_owner_username: null };
    const leadCsA = { owner_username: 'sales_c', assigned_to: null, cs_owner_username: 'cs_a' };

    assert.equal(canAccessLead(managerAdmin, leadOwnedByOther), true, 'manager sees everything');
    assert.equal(canAccessLead(salesAdmin, leadOwnedByA), true, 'sales sees own lead');
    assert.equal(canAccessLead(otherSales, leadOwnedByA), false, 'sales cannot see others lead');
    assert.equal(canAccessLead(csAdmin, leadOwnedByOther), false, 'cs cannot see unassigned lead by default');
    assert.equal(canAccessLead(csAdmin, leadCsA), true, 'cs sees explicitly assigned lead');
    log('permission matrix: canAccessLead role/ownership rules');

    assert.equal(isManager(managerAdmin), true);
    assert.equal(isManager(salesAdmin), false);
    log('permission matrix: isManager');

    assert.equal(canAccessRepMetrics(managerAdmin, 'someone_else'), true, 'manager sees any rep metrics');
    assert.equal(canAccessRepMetrics(salesAdmin, 'sales_a'), true, 'sales sees own metrics');
    assert.equal(canAccessRepMetrics(salesAdmin, 'sales_b'), false, 'sales cannot see other rep commission');
    log('permission matrix: canAccessRepMetrics (commission scoping)');

    const scope = leadScopeSql(salesAdmin, 4);
    assert.match(scope.clause, /owner_username = \$4 OR assigned_to = \$4/);
    assert.deepEqual(scope.params, ['sales_a']);
    const managerScope = leadScopeSql(managerAdmin, 4);
    assert.equal(managerScope.clause, 'TRUE');
    log('permission matrix: leadScopeSql SQL fragment shape');
  }

  {
    assert.equal(maskPhone('13800001111'), '138****1111');
    assert.equal(maskPhone(''), '');
    const lead = { owner_username: 'sales_a', phone: '13800001111', extracted: { phone: '13900002222', contact_phone: '13700003333' } };
    const maskedForStranger = maskLeadContact(lead, { username: 'sales_b', role: 'sales' });
    assert.equal(maskedForStranger.phone, '138****1111');
    assert.equal(maskedForStranger.extracted.phone, '139****2222');
    assert.equal(maskedForStranger.extracted.contact_phone, '137****3333');
    const unmaskedForOwner = maskLeadContact(lead, { username: 'sales_a', role: 'sales' });
    assert.equal(unmaskedForOwner.phone, '13800001111');
    assert.equal(canViewFullContact({ username: 'boss', role: 'super_admin' }, lead), true);
    log('phone masking: top-level + recursive extracted.* fields, owner sees plaintext');
  }

  {
    assert.equal(canTransition('new', 'won'), true, 'widened map allows real createDeal jump');
    assert.equal(canTransition('demo_completed', 'won'), true);
    assert.equal(canTransition('won', 'new'), false, 'won is terminal, cannot go back');
    assert.equal(canTransition('lost', 'won'), false, 'lost cannot jump straight to won');
    log('stage machine: widened transitions match real business actions, terminal states still guarded');
  }

  // ---- DB-backed：并发去重 + 阶段审计 + provisioning语义(用隔离测试数据) ----
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.log('SKIP: no DATABASE_URL, DB-backed assertions skipped (pure-function assertions above all passed)');
    return;
  }
  pool = new Pool({ connectionString: DATABASE_URL });
  await ensureSalesTables(pool);

  const leadKey = `${RUN_TAG}_lead`;
  const insertLead = await pool.query(
    `INSERT INTO sales_leads (lead_key, external_userid, source_channel, stage, controller) VALUES ($1,$2,'sandbox','new','ai') RETURNING id`,
    [leadKey, `${RUN_TAG}_ext`]
  );
  leadId = insertLead.rows[0].id;

  // 任务dedup_key并发去重：模拟同一个nurture step被"两次cron"同时创建
  {
    const dedupKey = `nurture:${leadId}:1`;
    const [t1, t2] = await Promise.all([
      upsertTask(pool, { leadId, title: '培育Day1', detail: 'x', dedupKey, taskDomain: 'nurture' }),
      upsertTask(pool, { leadId, title: '培育Day1', detail: 'y', dedupKey, taskDomain: 'nurture' }),
    ]);
    assert.equal(t1.id, t2.id, 'concurrent upsertTask with same dedup_key must return the same row');
    const count = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sales_tasks WHERE dedup_key=$1`, [dedupKey]);
    assert.equal(count.rows[0].cnt, 1, 'exactly one task row for this dedup_key');
    log('sales_tasks: concurrent dedup_key upsert produces exactly one row');
  }

  // 消息msgId并发去重：模拟企微重推同一条消息
  {
    const conv = await pool.query(`INSERT INTO sales_conversations (lead_id, open_kfid, external_userid, controller) VALUES ($1,'kf1',$2,'ai') RETURNING id`, [leadId, `${RUN_TAG}_ext`]);
    const convId = conv.rows[0].id;
    const msgId = `${RUN_TAG}_msg1`;
    const [m1, m2] = await Promise.all([
      addMessage(pool, { conversationId: convId, leadId, direction: 'inbound', sender: 'customer', content: 'hi', msgId }),
      addMessage(pool, { conversationId: convId, leadId, direction: 'inbound', sender: 'customer', content: 'hi', msgId }),
    ]);
    assert.equal(m1.id, m2.id, 'concurrent addMessage with same msg_id must return same row');
    assert.notEqual(m1.inserted, m2.inserted, 'exactly one of the two calls should report inserted=true');
    const count = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sales_messages WHERE msg_id=$1`, [msgId]);
    assert.equal(count.rows[0].cnt, 1, 'exactly one message row for this msg_id');
    log('sales_messages: concurrent msg_id insert produces exactly one row, inserted flag distinguishes caller');
  }

  // 阶段机：合法转换写入stage_history+lead_events；非法转换被拒绝且不留痕迹
  {
    const before = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sales_stage_history WHERE lead_id=$1`, [leadId]);
    const t = await transitionLeadStage(pool, { leadId, toStage: 'ai_greeting', actorType: 'system', actorId: 'test', reason: 'e2e' });
    assert.equal(t.ok, true);
    assert.equal(t.changed, true);
    assert.equal(t.from_stage, 'new');
    assert.equal(t.to_stage, 'ai_greeting');
    const after = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sales_stage_history WHERE lead_id=$1`, [leadId]);
    assert.equal(after.rows[0].cnt, before.rows[0].cnt + 1, 'legal transition writes exactly one stage_history row');
    const leadRow = await pool.query(`SELECT stage FROM sales_leads WHERE id=$1`, [leadId]);
    assert.equal(leadRow.rows[0].stage, 'ai_greeting', 'sales_leads.stage actually updated');

    const illegal = await transitionLeadStage(pool, { leadId, toStage: 'new', actorType: 'system', actorId: 'test', reason: 'e2e_illegal' });
    assert.equal(illegal.ok, false);
    assert.equal(illegal.error, 'illegal_transition');
    const afterIllegal = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sales_stage_history WHERE lead_id=$1`, [leadId]);
    assert.equal(afterIllegal.rows[0].cnt, after.rows[0].cnt, 'illegal transition does not write stage_history');
    const leadRowAfterIllegal = await pool.query(`SELECT stage FROM sales_leads WHERE id=$1`, [leadId]);
    assert.equal(leadRowAfterIllegal.rows[0].stage, 'ai_greeting', 'sales_leads.stage unchanged after rejected transition');
    log('transitionLeadStage: legal transition audited, illegal transition rejected with no side effect');

    const idempotent = await transitionLeadStage(pool, { leadId, toStage: 'ai_greeting', actorType: 'system', actorId: 'test' });
    assert.equal(idempotent.ok, true);
    assert.equal(idempotent.changed, false, 'same-stage transition is a no-op, not an error');
    log('transitionLeadStage: idempotent when toStage === current stage');
  }

  // 不同租户隔离的最小验证：canAccessTenant在查不到关联线索时拒绝(manager除外)
  {
    const denied = await canAccessTenant(pool, { username: 'sales_x', role: 'sales' }, `${RUN_TAG}_nonexistent_tenant`);
    assert.equal(denied, false, 'non-manager cannot access a tenant with no linkable lead');
    const allowedForManager = await canAccessTenant(pool, { username: 'boss', role: 'super_admin' }, `${RUN_TAG}_nonexistent_tenant`);
    assert.equal(allowedForManager, true, 'manager can access any tenant regardless of linkage');
    log('canAccessTenant: fails closed for non-manager when no lead links the tenant');
  }
}

main()
  .then(() => cleanup())
  .then(() => { console.log('\nALL PASS'); process.exit(0); })
  .catch(async (e) => {
    console.error('\nFAIL:', e);
    try { await cleanup(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
