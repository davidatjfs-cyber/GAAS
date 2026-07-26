/**
 * Pure helpers for BI weekly/monthly report Feishu delivery (P2 peel from agents.js).
 */

export function splitMarkdownForCard(md, maxLen = 3600) {
  const text = String(md || '');
  if (!text) return [''];
  if (text.length <= maxLen) return [text];
  const lines = text.split('\n');
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    const isSectionStart = /^##\s/.test(line) || /^###\s/.test(line);
    if (next.length > maxLen && cur) {
      chunks.push(cur);
      cur = line;
      continue;
    }
    if (isSectionStart && cur.length > Math.floor(maxLen * 0.75)) {
      chunks.push(cur);
      cur = line;
      continue;
    }
    cur = next;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function uniqBiReportRecipients(list) {
  const seen = new Set();
  return (list || []).filter((u) => {
    const k = String(u?.username || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function getReportStoresForBiReportsBody(deps, tenantId = 'default') {
  const { agentPool, reportStoresSeed, log } = deps;
  const seed = reportStoresSeed.slice();
  try {
    const r = await agentPool.query(`
      SELECT DISTINCT TRIM(store) AS store FROM pos_sales_detail
      WHERE date >= (CURRENT_DATE - INTERVAL '120 days')
        AND TRIM(COALESCE(store, '')) <> '' AND tenant_id = $1
      UNION
      SELECT DISTINCT TRIM(store) AS store FROM daily_reports
      WHERE date >= (CURRENT_DATE - INTERVAL '120 days')
        AND TRIM(COALESCE(store, '')) <> '' AND tenant_id = $1
    `, [tenantId]);
    const fromDb = (r.rows || []).map((x) => String(x.store || '').trim()).filter(Boolean);
    const set = new Set([...seed, ...fromDb]);
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
  } catch (e) {
    log.error('[bi-report] getReportStoresForBiReports failed:', e?.message);
    return seed;
  }
}

/** 月报投递：匹配该门店的飞书店长（店名字段与 canonical / 日报别名对齐） */
export async function feishuStoreManagersForMonthlyReportBody(deps, storeDisplayName) {
  const {
    pool,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    log,
  } = deps;
  const canon = String(resolveAgentCanonicalStore(storeDisplayName) || storeDisplayName).trim();
  const pats = [...new Set([
    ...dailyReportIlikePatterns(storeDisplayName),
    ...dailyReportIlikePatterns(canon)
  ])].filter((x) => x && String(x).length > 1);
  const patArr = pats.length ? pats : [`%${String(storeDisplayName).replace(/%/g, '')}%`];
  try {
    const r = await pool().query(
      `SELECT username FROM feishu_users
       WHERE COALESCE(registered, false) = true
         AND TRIM(COALESCE(open_id, '')) <> ''
         AND role = 'store_manager'
         AND (
           TRIM(COALESCE(store, '')) = $1
           OR TRIM(COALESCE(store, '')) = $2
           OR TRIM(COALESCE(store, '')) ILIKE ANY($3::text[])
         )`,
      [storeDisplayName, canon, patArr]
    );
    const seen = new Set();
    const out = [];
    for (const row of r.rows || []) {
      const u = String(row.username || '').trim();
      const k = u.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ username: u });
    }
    return out;
  } catch (e) {
    log.error('[bi-report] feishuStoreManagersForMonthlyReport failed:', e?.message);
    return [];
  }
}
