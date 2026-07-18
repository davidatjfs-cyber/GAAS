/**
 * 客服1个工作日部署检查SLA：只做"到期未完成则标记超时+通知"，不重造 tenant-onboarding.js 的检查清单。
 */
export async function runDeployCheckSlaScan(pool, notify, now = new Date()) {
  const r = await pool.query(
    `SELECT id, lead_id, tenant_id, cs_owner, deploy_check_due_at
       FROM sales_delivery_projects
      WHERE deploy_check_due_at IS NOT NULL
        AND deploy_check_due_at <= NOW()
        AND deploy_check_completed_at IS NULL
        AND deploy_check_overdue = FALSE
      ORDER BY deploy_check_due_at ASC LIMIT 100`
  );
  let alerted = 0;
  for (const row of r.rows || []) {
    await pool.query(`UPDATE sales_delivery_projects SET deploy_check_overdue=TRUE, updated_at=NOW() WHERE id=$1`, [row.id]);
    if (typeof notify === 'function') {
      await notify(`【部署检查SLA超时】租户 ${row.tenant_id}｜负责客服 ${row.cs_owner || '未分配'}，应在1个工作日内完成部署检查，已超时`, { title: '部署检查SLA超时', audience: 'customer_service' }).catch(() => null);
    }
    alerted += 1;
  }
  return { ok: true, alerted, checked_at: now.toISOString() };
}

export async function completeDeployCheck(pool, deliveryProjectId) {
  const r = await pool.query(
    `UPDATE sales_delivery_projects SET deploy_check_completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
    [deliveryProjectId]
  );
  return r.rows?.[0] || null;
}
