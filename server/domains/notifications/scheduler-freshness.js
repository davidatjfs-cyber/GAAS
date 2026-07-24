/**
 * Data freshness monitor cron (every 6h, first run deferred 90s).
 * Wave H13 peel from index.js.
 */
export function createFreshnessMonitorScheduler({
  pool,
  runForActiveTenants,
  runFreshnessCheck,
  FRESHNESS_SOURCES,
  sendLarkMessage,
}) {
  // 数据新鲜度监控：server/ontology/freshness.js写好后一直没接cron，是纯代码骨架，
  // 这里激活它——每6小时按活跃租户检查一遍，每个租户每天最多告警一次(防止刷屏)。
  const _freshnessAlertFiredDate = new Map();

  async function runFreshnessMonitorTick() {
    try {
      await runForActiveTenants(async (tenantId) => {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
        if (_freshnessAlertFiredDate.get(tenantId) === todayStr) return;
        const { stale, alertText } = await runFreshnessCheck(pool, FRESHNESS_SOURCES);
        if (!alertText) return;
        _freshnessAlertFiredDate.set(tenantId, todayStr);
        const r = await pool.query(
          `SELECT DISTINCT open_id
         FROM feishu_users
         WHERE registered = true
           AND open_id IS NOT NULL
           AND open_id NOT LIKE '%probe%'
           AND (
             TRIM(LOWER(role)) IN ('admin', 'hq_manager')
             OR TRIM(role) IN ('管理员', '系统管理员', '总部经理', '总部营运')
           )
         LIMIT 35`
        );
        const rows = r.rows || [];
        if (!rows.length) {
          console.error('[freshness] 数据陈旧但无可投递飞书账号，tenant:', tenantId, stale.map(s => s.name));
          return;
        }
        const sends = rows.map((row) =>
          sendLarkMessage(row.open_id, alertText, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
        );
        const settled = await Promise.all(sends);
        const failed = settled.filter((x) => x && x.err);
        if (failed.length) {
          console.error('[freshness] 部分飞书告警发送失败:', tenantId, failed.length, '/', settled.length, failed[0]?.err);
        } else {
          console.error('[freshness] alert sent, tenant:', tenantId, 'stale:', stale.map(s => s.name));
        }
      }, { continueOnError: true });
    } catch (e) {
      console.error('[freshness] runForActiveTenants error:', e?.message || e);
    }
  }

  let started = false;
  function startFreshnessMonitorScheduler() {
    if (started) return;
    started = true;
    setTimeout(() => {
      runFreshnessMonitorTick();
    }, 90000);
    setInterval(runFreshnessMonitorTick, 6 * 3600 * 1000);
  }

  return { runFreshnessMonitorTick, startFreshnessMonitorScheduler };
}
