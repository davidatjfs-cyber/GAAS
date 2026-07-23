/**
 * GET /api/agents/bitable-sync
 * (Wave 4o — behavior-preserving extract from index.js).
 */

// ── Bitable Sync Status (for 数据中心 dashboard) ──
const BITABLE_TABLE_NAMES = {
  'tblpx5Efqc6eHo3L': '桌访表',
  'tblz4kW1cY22XRlL': '马己仙原料收货日报',
  'tblZXgaU0LpSye2m': '例会报告',
  'tbl32E6d0CyvLvfi': '开档报告',
  'tblgReexNjWJOJB6': '差评报告DB',
  'tbllcV1evqTJyzlN': '洪潮原料收货日报',
  'tblXYfSBRrgNGohN': '收档报告DB',
  'tblLCxLO0ZbV7uyo': '报损单',
  'tblxHI9ZAKONOTpp': '运营检查表(含开收档)',
  'tblT86H1uuTJydne': '异常任务回复',
  /** 实际毛利率多维表（线上表 ID 可能为 I 或 l，兼容两种） */
  'tbl4RTo9ZVTxlpLw': '实际毛利率（飞书多维表）',
  'tbl4RTo9ZVTxIpLw': '实际毛利率（飞书多维表）'
};

function bitableSyncDisplayName(tableId) {
  const id = String(tableId || '').trim();
  if (!id) return '—';
  if (BITABLE_TABLE_NAMES[id]) return BITABLE_TABLE_NAMES[id];
  if (/^tbl[A-Za-z0-9]{10,}$/.test(id)) {
    return `飞书多维表（未登记中文名｜${id}）`;
  }
  return id;
}

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: import('pg').Pool }} deps
 */
export function registerBitableSyncRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/agents/bitable-sync', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'hr_manager', 'store_manager', 'front_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const r = await pool.query(
        `SELECT table_id, COUNT(*) as cnt, MAX(updated_at) as last_sync FROM feishu_generic_records WHERE tenant_id = $1 GROUP BY table_id ORDER BY last_sync DESC`,
        [req.tenantId || req.user?.tenant_id || 'default']
      );
      const items = (r.rows || []).map(row => ({
        tableId: row.table_id,
        name: bitableSyncDisplayName(row.table_id),
        count: Number(row.cnt),
        lastSync: row.last_sync
      }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'internal_error' });
    }
  });
}
