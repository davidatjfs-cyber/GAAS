/**
 * 内容日历 + 渠道效果（从 growth-phases Phase 8 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';

export async function upsertContentCalendarItem(pool, tenantId, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const tid = String(tenantId || 'default');
  const r = await pool.query(
    `INSERT INTO growth_content_calendar(item_id,store_id,channel,publish_date,title,content_brief,copy_text,image_url,campaign_id,qr_scene,status,assignee_username,tenant_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(item_id, tenant_id) DO UPDATE SET title=EXCLUDED.title,copy_text=EXCLUDED.copy_text,status=EXCLUDED.status,updated_at=NOW() RETURNING *`,
    [
      cleanText(b.item_id, 128),
      cleanText(b.store_id, 128),
      cleanText(b.channel, 80),
      b.publish_date ? String(b.publish_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      cleanText(b.title, 500),
      cleanText(b.content_brief, 2000),
      cleanText(b.copy_text, 4000),
      cleanText(b.image_url, 1000),
      cleanText(b.campaign_id, 128),
      cleanText(b.qr_scene, 255),
      cleanText(b.status || 'draft', 40),
      cleanText(b.assignee_username, 128),
      tid,
    ]
  );
  return r.rows[0] || null;
}

export async function listContentCalendar(pool, { storeId = '', channel = '' } = {}) {
  const sid = cleanText(storeId, 128);
  const ch = cleanText(channel, 80);
  const r = await pool.query(
    `SELECT * FROM growth_content_calendar WHERE ($1='' OR store_id=$1) AND ($2='' OR channel=$2) ORDER BY publish_date DESC LIMIT 300`,
    [sid, ch]
  );
  return r.rows || [];
}

export async function listUpcomingContentCalendar(pool, storeId = '') {
  const sid = cleanText(storeId, 128);
  const r = await pool.query(
    `SELECT * FROM growth_content_calendar WHERE publish_date>=CURRENT_DATE AND ($1='' OR store_id=$1) ORDER BY publish_date ASC LIMIT 30`,
    [sid]
  );
  return r.rows || [];
}

export async function listChannelEffects(pool, daysRaw) {
  const days = Math.min(Math.max(Number(daysRaw) || 30, 1), 365);
  const r = await pool.query(
    `SELECT gc.channel,COUNT(*)::int total_items,
              COUNT(*) FILTER(WHERE gc.status='published')::int published,
              SUM(gc.result_scan_count)::int total_scans,
              SUM(gc.result_revenue_fen)::int total_revenue_fen
       FROM growth_content_calendar gc WHERE gc.publish_date>=CURRENT_DATE-($1::int||' days')::interval
       GROUP BY gc.channel ORDER BY total_revenue_fen DESC`,
    [days]
  );
  return r.rows || [];
}
