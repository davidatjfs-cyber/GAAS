/**
 * 开通失败自动重试：provisionTenantFromLead 本身是幂等的(isRetry分支)，之前只有
 * listPendingProvisioningCompensations 供人工在后台手动点重试，没有自动化。
 * 这里按退避间隔自动重试，重试到上限还失败才真正标记需要人工介入——不是"每次失败都要
 * 人盯着"，是"系统自己先试够次数，实在不行才叫人"。
 */
import { provisionTenantFromLead } from '../sales-provisioning.js';

const MAX_RETRIES = 5;
// 5分钟/15分钟/30分钟/1小时/2小时，逐步拉长，避免对着一个短期内注定会失败的外部依赖狂打请求。
const BACKOFF_MINUTES = [5, 15, 30, 60, 120];

function nextRetryDelayMinutes(retryCount) {
  return BACKOFF_MINUTES[Math.min(retryCount, BACKOFF_MINUTES.length - 1)];
}

export async function runProvisioningRetryScan(pool, notify, now = new Date()) {
  const r = await pool.query(
    `SELECT id, lead_key, company, name, tenant_id, provision_status, provision_retry_count
       FROM sales_leads
      WHERE provision_status IN ('tenant_created', 'partial')
        AND provision_retry_exhausted = FALSE
        AND (provision_next_retry_at IS NULL OR provision_next_retry_at <= NOW())
      ORDER BY updated_at ASC LIMIT 50`
  );
  let retried = 0;
  let succeeded = 0;
  let exhausted = 0;
  for (const lead of r.rows || []) {
    retried += 1;
    let result;
    try {
      result = await provisionTenantFromLead(pool, lead.id);
    } catch (e) {
      result = { ok: false, error: e?.message || String(e) };
    }
    const stillPending = await pool.query(`SELECT provision_status FROM sales_leads WHERE id=$1`, [lead.id]);
    const status = stillPending.rows?.[0]?.provision_status;
    if (status === 'done') {
      succeeded += 1;
      await pool.query(`UPDATE sales_leads SET provision_retry_count=0, provision_next_retry_at=NULL WHERE id=$1`, [lead.id]);
      continue;
    }
    const newRetryCount = (lead.provision_retry_count || 0) + 1;
    if (newRetryCount >= MAX_RETRIES) {
      exhausted += 1;
      await pool.query(
        `UPDATE sales_leads SET provision_retry_count=$2, provision_retry_exhausted=TRUE, updated_at=NOW() WHERE id=$1`,
        [lead.id, newRetryCount]
      );
      if (typeof notify === 'function') {
        await notify(
          `【开通自动重试已耗尽】客户 ${lead.company || lead.name || lead.lead_key}｜租户 ${lead.tenant_id}｜已自动重试${MAX_RETRIES}次仍未完成(最后错误：${result?.error || result?.message || '未知'})，需要人工介入排查`,
          { title: '开通失败需人工介入', audience: 'sales' }
        ).catch(() => null);
      }
    } else {
      const delayMin = nextRetryDelayMinutes(newRetryCount);
      await pool.query(
        `UPDATE sales_leads SET provision_retry_count=$2, provision_next_retry_at=NOW() + ($3::text || ' minutes')::interval, updated_at=NOW() WHERE id=$1`,
        [lead.id, newRetryCount, String(delayMin)]
      );
    }
  }
  return { ok: true, checked: r.rows?.length || 0, retried, succeeded, exhausted, checked_at: now.toISOString() };
}
