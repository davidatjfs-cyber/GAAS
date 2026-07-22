/** 客户 AI / 销售向企业微信客服发送资料的唯一入口。 */
import { sendKfText, sendKfImage, sendKfFile, sendKfVideo, uploadKfMedia } from './sales-kf.js';
import fs from 'fs/promises';
import path from 'path';

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

function safeAssetUrl(raw) {
  const url = new URL(String(raw || '').trim());
  if (url.protocol !== 'https:') throw new Error('asset_url_must_use_https');
  return url;
}

export function renderContentAssetText(text, lead = {}) {
  const extracted = lead.extracted || {};
  const values = {
    customer_name: lead.company || lead.name || extracted.company || extracted.name || '您',
    pain_point: extracted.pain_point || lead.pain_points?.[0] || '门店经营问题',
    store_count: lead.store_count || extracted.store_count || '当前',
    city: lead.city || extracted.city || '所在城市',
  };
  return String(text || '').replace(/\{\{(customer_name|pain_point|store_count|city)\}\}/g, (_match, key) => String(values[key]));
}

async function fetchApprovedAsset(url) {
  const raw = String(url || '').trim();
  if (/^\/uploads\/[a-zA-Z0-9._-]+$/.test(raw)) {
    const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
    const filePath = path.resolve(uploadsRoot, path.basename(raw));
    if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error('invalid_local_asset_path');
    const buffer = await fs.readFile(filePath);
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('asset_too_large');
    return { buffer, mimeType: 'application/octet-stream' };
  }
  const response = await fetch(safeAssetUrl(url), { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`asset_download_failed_${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_MEDIA_BYTES) throw new Error('asset_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('asset_too_large');
  return { buffer, mimeType: response.headers.get('content-type') || 'application/octet-stream' };
}

export async function listSendableContentAssets(pool, { tag, limit = 50 } = {}) {
  const params = [];
  let sql = `SELECT * FROM sales_content_assets
    WHERE active=true AND external_approved=true AND knowledge_domain='customer_ai'
      AND (effective_from IS NULL OR effective_from <= NOW())
      AND (expires_at IS NULL OR expires_at > NOW())`;
  if (tag) { params.push(tag); sql += ` AND tags ? $${params.length}`; }
  params.push(limit);
  sql += ` ORDER BY updated_at DESC LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

export async function sendContentAssetToLead(pool, lead, asset, { deliveryType = 'manual', sentBy = 'sales' } = {}) {
  if (!lead?.open_kfid || !lead?.external_userid) throw new Error('wecom_conversation_missing');
  if (!asset?.external_approved || !asset?.active) throw new Error('asset_not_approved');
  if ((asset.knowledge_domain || 'customer_ai') !== 'customer_ai') throw new Error('internal_asset_cannot_be_sent_to_customer');
  const record = await pool.query(
    `INSERT INTO sales_content_deliveries (lead_id, asset_id, delivery_type, status, sent_by)
     VALUES ($1,$2,$3,'pending',$4) RETURNING id`,
    [lead.id, asset.id, deliveryType, sentBy]
  );
  const deliveryId = record.rows[0].id;
  try {
    let result;
    if (asset.content_type === 'text' || asset.content_type === 'link' || (asset.content_type === 'qr' && !asset.media_url)) {
      const text = renderContentAssetText(asset.text_content || asset.media_url || '', lead).trim();
      if (!text) throw new Error('asset_text_missing');
      result = await sendKfText({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, content: text });
    } else {
      if (!asset.media_url) throw new Error('asset_media_url_missing');
      const { buffer, mimeType } = await fetchApprovedAsset(asset.media_url);
      const type = asset.content_type === 'image' || asset.content_type === 'qr' ? 'image' : asset.content_type === 'video' ? 'video' : 'file';
      const mediaId = await uploadKfMedia(buffer, { type, filename: asset.file_name || `${asset.asset_key}.${type}`, mimeType });
      if (type === 'image') result = await sendKfImage({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, mediaId });
      else if (type === 'video') result = await sendKfVideo({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, mediaId });
      else result = await sendKfFile({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, mediaId });
    }
    await pool.query(`UPDATE sales_content_deliveries SET status='sent', wecom_msg_id=$2, sent_at=NOW() WHERE id=$1`, [deliveryId, String(result?.msgid || result?.msg_id || '') || null]);
    return { ok: true, delivery_id: deliveryId };
  } catch (e) {
    await pool.query(`UPDATE sales_content_deliveries SET status='failed', error_message=$2 WHERE id=$1`, [deliveryId, String(e?.message || e).slice(0, 1000)]);
    throw e;
  }
}
