/**
 * 统一客户时间线：打通售前(销售AI线索事件/阶段变化)与售后(SaaS租户健康度事件)，
 * 避免销售接管后重新问客户"您有几家店"、客户成功接手后又不知道售前聊过什么。
 */
import { getLead } from './sales-store.js';

export async function getUnifiedCustomerTimeline(pool, leadId) {
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'not_found' };

  const [events, stages, messages] = await Promise.all([
    pool.query(`SELECT event_type, summary, priority, created_at FROM sales_lead_events WHERE lead_id=$1 ORDER BY created_at ASC`, [leadId]),
    pool.query(`SELECT from_stage, to_stage, reason, created_at FROM sales_stage_history WHERE lead_id=$1 ORDER BY created_at ASC`, [leadId]),
    pool.query(`SELECT direction, sender, content, created_at FROM sales_messages WHERE lead_id=$1 ORDER BY created_at ASC`, [leadId]),
  ]);

  const timeline = [];
  for (const e of events.rows || []) {
    timeline.push({ at: e.created_at, phase: 'pre_sale', kind: 'event', label: e.summary || e.event_type, detail: e.event_type, priority: e.priority });
  }
  for (const s of stages.rows || []) {
    timeline.push({ at: s.created_at, phase: 'pre_sale', kind: 'stage_change', label: `阶段变更：${s.from_stage || '（新）'} → ${s.to_stage}`, detail: s.reason || '' });
  }
  for (const m of messages.rows || []) {
    const who = m.sender === 'customer' ? '客户' : (m.sender === 'human' ? '销售' : 'AI');
    timeline.push({ at: m.created_at, phase: 'pre_sale', kind: 'message', label: `${who}：${String(m.content || '').slice(0, 60)}`, detail: m.direction });
  }

  // 只有已开通租户的客户才有售后阶段数据，未成交/未开通线索这段留空属于正常状态
  if (lead.tenant_id) {
    const incidents = await pool.query(
      `SELECT item_name, item_key, severity, status, created_at, resolved_at
         FROM tenant_health_incidents WHERE tenant_id=$1 ORDER BY created_at ASC LIMIT 200`,
      [lead.tenant_id]
    ).catch(() => ({ rows: [] }));
    for (const inc of incidents.rows || []) {
      timeline.push({ at: inc.created_at, phase: 'post_sale', kind: 'health_incident_opened', label: `健康度异常：${inc.item_name || inc.item_key}（${inc.severity || ''}）`, detail: inc.status });
      if (inc.resolved_at) {
        timeline.push({ at: inc.resolved_at, phase: 'post_sale', kind: 'health_incident_resolved', label: `已解决：${inc.item_name || inc.item_key}`, detail: '' });
      }
    }
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    ok: true,
    lead_id: leadId,
    lead_key: lead.lead_key,
    tenant_id: lead.tenant_id || null,
    has_post_sale_data: !!lead.tenant_id,
    timeline,
  };
}
