/**
 * 客户拜访记录：销售线下/线上/电话实际拜访了客户、聊了什么、下次跟进计划。
 * 之前系统完全没有这块——只有AI自动生成的诊断/评分，没有销售人工记录的真实接触历史。
 */
export async function recordVisit(pool, {
  leadId, repId, visitType = 'onsite', occurredAt, notes, nextFollowupAt, nextFollowupPlan, createdBy,
}) {
  const r = await pool.query(
    `INSERT INTO sales_visits (lead_id, rep_id, visit_type, occurred_at, notes, next_followup_at, next_followup_plan, created_by)
     VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW()),$5,$6,$7,$8) RETURNING *`,
    [leadId, repId || null, visitType, occurredAt || null, notes || null, nextFollowupAt || null, nextFollowupPlan || null, createdBy || null]
  );
  return r.rows[0];
}

export async function listVisitsForLead(pool, leadId, limit = 50) {
  const r = await pool.query(
    `SELECT v.*, r.display_name AS rep_name
       FROM sales_visits v
       LEFT JOIN sales_reps r ON r.id = v.rep_id
      WHERE v.lead_id = $1
      ORDER BY v.occurred_at DESC LIMIT $2`,
    [leadId, limit]
  );
  return r.rows || [];
}

export async function listUpcomingFollowups(pool, { repId, days = 7 } = {}) {
  const params = [days];
  let where = `next_followup_at IS NOT NULL AND next_followup_at <= NOW() + ($1 || ' days')::interval`;
  if (repId) { params.push(repId); where += ` AND rep_id = $${params.length}`; }
  const r = await pool.query(
    `SELECT v.*, l.company, l.name AS lead_name, l.lead_key
       FROM sales_visits v
       JOIN sales_leads l ON l.id = v.lead_id
      WHERE ${where}
      ORDER BY v.next_followup_at ASC LIMIT 100`,
    params
  );
  return r.rows || [];
}
