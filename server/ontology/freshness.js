/**
 * 数据新鲜度检测 — 纯逻辑与 I/O 分离，方便无 DB 环境测单元测试
 *
 * 告警走飞书（sendLarkMessage 查 feishu_users），不是企微——
 * 企微在本系统里专用于客户触达，见 notifyAdminsDualWriteFailure 的既有约定。
 */

/**
 * @param {Array<{ name: string, lastSeenAt: string|Date|null, maxStalenessHours: number }>} sources
 * @param {Date} now
 * @returns {Array<{ name: string, hoursStale: number, lastSeenAt: string|Date|null }>}
 */
export function checkFreshness(sources, now = new Date()) {
  const stale = [];
  for (const source of sources || []) {
    const { name, lastSeenAt, maxStalenessHours } = source;
    if (!lastSeenAt) {
      stale.push({ name, hoursStale: Infinity, lastSeenAt: null });
      continue;
    }
    const seenAt = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
    const hoursStale = (now.getTime() - seenAt.getTime()) / (1000 * 60 * 60);
    if (hoursStale > maxStalenessHours) {
      stale.push({ name, hoursStale: Math.round(hoursStale * 10) / 10, lastSeenAt });
    }
  }
  return stale;
}

export function formatFreshnessAlert(staleSources, { timeStr } = {}) {
  const lines = staleSources.map(
    s => `· ${s.name}：${s.lastSeenAt ? `已 ${s.hoursStale} 小时无新数据` : '从未写入过数据'}`
  );
  return `【HRMS 数据新鲜度告警】\n${lines.join('\n')}\n时间：${timeStr || new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')}（上海）`;
}

/**
 * I/O 层：查每个数据源最新一条记录时间，跑 checkFreshness，过期则组装告警文本。
 * 发送逻辑（sendLarkMessage）由调用方注入，本模块不直接依赖 index.js。
 */
export async function runFreshnessCheck(pool, sourceDefs, now = new Date()) {
  const sources = [];
  for (const def of sourceDefs) {
    const r = await pool.query(`SELECT MAX(${def.timeColumn}) AS last_seen FROM ${def.table}`);
    sources.push({
      name: def.name,
      lastSeenAt: r.rows?.[0]?.last_seen || null,
      maxStalenessHours: def.maxStalenessHours,
    });
  }
  const stale = checkFreshness(sources, now);
  return { stale, alertText: stale.length ? formatFreshnessAlert(stale) : null };
}
