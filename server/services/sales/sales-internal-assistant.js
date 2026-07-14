/**
 * 销售内部大管家：对话查询客户/线索/漏斗一切信息
 */
import { listLeads, getLead, listMessages, loadLeadFunnel } from './sales-store.js';
import { buildSalesBossMetrics } from './sales-boss-metrics.js';
import { buildDiagnosisReport } from './sales-diagnosis.js';
import { recommendCasesForLead } from './sales-case-library.js';

let _callLLM = null;
export function setSalesAssistantLlm(fn) { _callLLM = fn; }

async function ensureAssistantTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_assistant_threads (
      id BIGSERIAL PRIMARY KEY,
      owner_username TEXT NOT NULL,
      lead_id BIGINT,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_assistant_messages (
      id BIGSERIAL PRIMARY KEY,
      thread_id BIGINT NOT NULL REFERENCES sales_assistant_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

export async function buildSalesContextPack(pool, { leadId, limit = 80 } = {}) {
  const leads = await listLeads(pool, { limit });
  const metrics = buildSalesBossMetrics(leads);
  let focus = null;
  if (leadId) {
    const lead = await getLead(pool, leadId);
    const funnel = lead ? await loadLeadFunnel(pool, leadId) : {};
    const conv = await pool.query(`SELECT id FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId]);
    const messages = conv.rows?.[0] ? await listMessages(pool, conv.rows[0].id, 40) : [];
    const diagnosis = lead ? buildDiagnosisReport(lead) : null;
    const cases = lead ? await recommendCasesForLead(pool, lead) : [];
    focus = { lead, funnel, messages: messages.slice(-20), diagnosis, cases: cases.slice(0, 3) };
  }
  return {
    generated_at: new Date().toISOString(),
    pipeline_summary: metrics.summary,
    funnel: metrics.funnel,
    top5: metrics.top5,
    risks: metrics.risks.slice(0, 5),
    owner_stats: metrics.owner_stats.slice(0, 8),
    recent_leads: leads.slice(0, 15).map((l) => ({
      id: l.id, lead_key: l.lead_key, company: l.company || l.name, stage: l.stage,
      score: l.intent_score, controller: l.controller, next_action: l.next_action, tenant_id: l.tenant_id,
    })),
    focus,
  };
}

function templateAssistantReply(question, ctx) {
  const q = String(question || '');
  if (/漏斗|阶段|转化/.test(q)) {
    return `当前漏斗：${(ctx.funnel || []).map((f) => `${f.stage}${f.count}`).join('，')}。整体成交率约 ${ctx.pipeline_summary?.win_rate_pct ?? 0}%。`;
  }
  if (/风险|漏跟/.test(q)) {
    const risks = ctx.risks || [];
    return risks.length
      ? `风险客户 ${risks.length} 个：\n${risks.map((r) => `· ${r.lead_key}：${r.risks.join('、')}`).join('\n')}`
      : '当前无显著风险客户。';
  }
  if (ctx.focus?.lead && /这家|这个客户|他|她|线索/.test(q)) {
    const l = ctx.focus.lead;
    return [
      `${l.company || l.name || l.lead_key}：阶段 ${l.stage}，评分 ${l.intent_score}，控场 ${l.controller}`,
      `痛点：${l.extracted?.pain_point || (l.pain_points || [])[0] || '未明'}`,
      `下一步：${l.next_action || '—'}`,
      l.tenant_id ? `已开通租户：${l.tenant_id}` : '尚未开通租户',
      ctx.focus.diagnosis?.sales_advice ? `建议：${ctx.focus.diagnosis.sales_advice}` : '',
    ].filter(Boolean).join('\n');
  }
  if (/top|优先|跟进谁/.test(q.toLowerCase())) {
    const t5 = ctx.top5 || [];
    return t5.length
      ? `今日优先跟进：\n${t5.map((t, i) => `${i + 1}. ${t.company || t.lead_key} 分${t.intent_score} — ${t.next_action}`).join('\n')}`
      : '暂无高优先级线索。';
  }
  return `我是销售大管家。可问我：某客户情况、今日跟进谁、漏斗转化、风险客户。当前线索 ${ctx.pipeline_summary?.total ?? 0} 条，高意向 ${ctx.pipeline_summary?.high_intent ?? 0} 条。`;
}

export async function runSalesAssistantTurn(pool, {
  ownerUsername,
  threadId,
  leadId,
  message,
  history = [],
}) {
  await ensureAssistantTables(pool);
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'empty_message' };

  let thread = null;
  if (threadId) {
    const tr = await pool.query(`SELECT * FROM sales_assistant_threads WHERE id=$1 AND owner_username=$2`, [threadId, ownerUsername]);
    thread = tr.rows?.[0] || null;
  }
  if (!thread) {
    const ins = await pool.query(
      `INSERT INTO sales_assistant_threads (owner_username, lead_id, title) VALUES ($1,$2,$3) RETURNING *`,
      [ownerUsername, leadId || null, text.slice(0, 40)]
    );
    thread = ins.rows[0];
  }

  await pool.query(
    `INSERT INTO sales_assistant_messages (thread_id, role, content) VALUES ($1,'user',$2)`,
    [thread.id, text]
  );

  const ctx = await buildSalesContextPack(pool, { leadId: leadId || thread.lead_id });
  let reply = templateAssistantReply(text, ctx);
  let source = 'template';

  if (typeof _callLLM === 'function') {
    const system = `你是销售团队里那个对每个客户情况都门儿清的老同事，坐在旁边随时能被问一句的那种，不是客服机器人。
回答要求：
1. 直接说结论和判断，像同事聊天一样开口，不要说"根据提供的上下文/数据显示/以上信息表明"这类报告腔开场白。
2. 该说"没有"就说没有，不用先复述一遍问题；该提醒的风险和该催的客户主动提一句，不用等对方问。
3. 数字和事实要准（客户名、阶段、评分、天数），但不要逐条罗列成表格式的报告，用口语句子带出来，像"XX那家现在卡在合格阶段，评分还行但三天没跟进了"这种说法。
4. 不知道的信息就说不知道或建议去看哪张表/哪个客户详情，不要编造。
5. 篇幅按问题大小来，别的都简答，只有明确要求"详细说说"才展开。`;
    const user = `上下文 JSON（节选）：\n${JSON.stringify(ctx).slice(0, 12000)}\n\n销售问：${text}`;
    const hist = (history || []).slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const r = await _callLLM(
      [{ role: 'system', content: system }, ...hist, { role: 'user', content: user }],
      { purpose: 'sales_internal_assistant', temperature: 0.35, max_tokens: 700, skipCache: true }
    ).catch(() => null);
    if (r?.ok && r.content) {
      reply = String(r.content).trim();
      source = 'llm';
    }
  }

  await pool.query(
    `INSERT INTO sales_assistant_messages (thread_id, role, content, meta) VALUES ($1,'assistant',$2,$3::jsonb)`,
    [thread.id, reply, JSON.stringify({ source, lead_id: leadId || thread.lead_id })]
  );
  await pool.query(`UPDATE sales_assistant_threads SET updated_at=NOW() WHERE id=$1`, [thread.id]);

  return { ok: true, thread_id: thread.id, reply, source, context_hint: { lead_id: leadId || thread.lead_id } };
}

export async function listAssistantThreads(pool, ownerUsername, limit = 20) {
  await ensureAssistantTables(pool);
  const r = await pool.query(
    `SELECT id, lead_id, title, updated_at FROM sales_assistant_threads WHERE owner_username=$1 ORDER BY updated_at DESC LIMIT $2`,
    [ownerUsername, limit]
  );
  return r.rows || [];
}

export async function listAssistantMessages(pool, threadId, ownerUsername, limit = 50) {
  await ensureAssistantTables(pool);
  const tr = await pool.query(`SELECT id FROM sales_assistant_threads WHERE id=$1 AND owner_username=$2`, [threadId, ownerUsername]);
  if (!tr.rows?.[0]) return [];
  const r = await pool.query(
    `SELECT role, content, meta, created_at FROM sales_assistant_messages WHERE thread_id=$1 ORDER BY id ASC LIMIT $2`,
    [threadId, limit]
  );
  return r.rows || [];
}
