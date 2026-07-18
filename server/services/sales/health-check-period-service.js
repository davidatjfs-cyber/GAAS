/**
 * 7天体检期正式诊断报告交付追踪：素材由 daily-diagnosis-scheduler.js 每天自动生成，
 * 这里只追踪"客服是否在7天窗口内把底稿整理成正式报告并标记交付"，不重复造诊断逻辑。
 */
export async function runHealthCheckPeriodScan(pool, notify, now = new Date()) {
  const r = await pool.query(
    `SELECT id, lead_id, tenant_id, cs_owner, health_check_due_at
       FROM sales_delivery_projects
      WHERE health_check_due_at IS NOT NULL
        AND health_check_due_at <= NOW()
        AND health_check_delivered_at IS NULL
        AND health_check_overdue = FALSE
      ORDER BY health_check_due_at ASC LIMIT 100`
  );
  let alerted = 0;
  for (const row of r.rows || []) {
    await pool.query(`UPDATE sales_delivery_projects SET health_check_overdue=TRUE, updated_at=NOW() WHERE id=$1`, [row.id]);
    if (typeof notify === 'function') {
      await notify(`【7天体检期超时】租户 ${row.tenant_id}｜负责客服 ${row.cs_owner || '未分配'}，正式诊断报告应在体检期内交付，已超时`, { title: '体检期报告超时', audience: 'customer_service' }).catch(() => null);
    }
    alerted += 1;
  }
  return { ok: true, alerted, checked_at: now.toISOString() };
}

export async function deliverHealthCheckReport(pool, deliveryProjectId, reportRef) {
  const r = await pool.query(
    `UPDATE sales_delivery_projects SET health_check_delivered_at=NOW(), health_check_report_ref=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [deliveryProjectId, reportRef || null]
  );
  return r.rows?.[0] || null;
}
