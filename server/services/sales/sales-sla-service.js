export function classifySlaStatus({ slaDueAt, firstHumanResponseAt, controller = 'ai', now = new Date() } = {}) {
  if (!slaDueAt) return 'not_required';
  if (firstHumanResponseAt || controller === 'human') return 'met';
  return new Date(slaDueAt).getTime() <= now.getTime() ? 'breached' : 'open';
}

export async function runSalesSlaScan(pool, notify, now = new Date()) {
  const r = await pool.query(
    `SELECT id, lead_key, company, name, assigned_to, handoff_level, sla_due_at
       FROM sales_leads
      WHERE controller <> 'human'
        AND assigned_to IS NOT NULL
        AND sla_due_at IS NOT NULL
        AND sla_due_at <= NOW()
        AND COALESCE(sla_status, 'open') <> 'breached'
        AND stage NOT IN ('won','lost','unfit')
      ORDER BY sla_due_at ASC LIMIT 100`
  );
  let alerted = 0;
  for (const lead of r.rows || []) {
    await pool.query(`UPDATE sales_leads SET sla_status='breached', escalated_at=COALESCE(escalated_at,NOW()), updated_at=NOW() WHERE id=$1`, [lead.id]);
    if (typeof notify === 'function') {
      await notify(`【销售AI·SLA超时】线索 ${lead.lead_key}｜${lead.company || lead.name || ''}｜负责人 ${lead.assigned_to}｜${lead.handoff_level || 'medium'}，请立即接管`, { title: '销售接管 SLA 超时', audience: 'sales' }).catch(() => null);
    }
    alerted += 1;
  }
  return { ok: true, alerted, checked_at: now.toISOString() };
}
