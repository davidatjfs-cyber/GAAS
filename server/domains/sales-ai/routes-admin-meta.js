import { SALES_PERSONA, PUBLIC_KNOWLEDGE, FORBIDDEN_CLAIMS } from '../../services/sales/sales-knowledge.js';
import { listKnowledgeItemsAdmin, upsertKnowledgeItem, deleteKnowledgeItem } from '../../services/sales/sales-knowledge-store.js';
import { listSendableContentAssets, sendContentAssetToLead } from '../../services/sales/sales-content-delivery.js';
import { getLead } from '../../services/sales/sales-store.js';
import { canAccessLead, isManager } from '../../services/sales/sales-permissions.js';
import { getSalesPermissionConfig, saveSalesPermissionConfig, SALES_MODULES, SALES_CONFIGURABLE_ROLES } from '../../services/sales/sales-permission-config.js';
import { kfConfigured, kfEnv } from '../../services/sales/sales-kf.js';

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, upload?: object }} ctx */
export function registerSalesAiAdminMetaRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, upload } = ctx;
  const { managerGate } = gates;

  app.get('/api/admin/sales/meta', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, persona: SALES_PERSONA, knowledge: PUBLIC_KNOWLEDGE, forbidden_claims: FORBIDDEN_CLAIMS, kf_configured: kfConfigured(), open_kfid: kfEnv().openKfid || null });
  });

  // 任何已登录的销售后台管理员都能读(前端要靠这个算出自己能看到哪些CRM模块)，
  // 但只有销售经理/总经理/超级管理员能改——改的是别人的可见范围，不是自己的。
  app.get('/api/admin/sales/permission-config', platformAdminRequired, async (req, res) => {
    try {
      const config = await getSalesPermissionConfig(pool);
      res.json({ ok: true, config, modules: SALES_MODULES, roles: SALES_CONFIGURABLE_ROLES, my_role: req.platformAdmin?.role || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.put('/api/admin/sales/permission-config', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const config = await saveSalesPermissionConfig(pool, req.body?.config || {}, req.platformAdmin?.username);
      res.json({ ok: true, config, modules: SALES_MODULES, roles: SALES_CONFIGURABLE_ROLES });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/knowledge', platformAdminRequired, async (_req, res) => {
    try {
      const items = await listKnowledgeItemsAdmin(pool);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/knowledge', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const body = String(req.body?.body || '').trim();
      const itemKey = String(req.body?.item_key || '').trim();
      if (!itemKey || !title || !body) return res.status(400).json({ ok: false, error: 'missing_fields' });
      const painKeys = String(req.body?.pain_keys || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const item = await upsertKnowledgeItem(pool, {
        id: req.body?.id ? Number(req.body.id) : null,
        item_key: itemKey,
        title,
        body,
        pain_keys: painKeys,
        active: req.body?.active !== false,
        sort_order: Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0,
      });
      res.json({ ok: true, item });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.delete('/api/admin/sales/knowledge/:id', platformAdminRequired, managerGate, async (req, res) => {
    try {
      await deleteKnowledgeItem(pool, Number(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // 内容资产只允许销售经理/超级管理员维护；销售只能发送已审批的资产，避免把内部资料误发给客户。
  app.get('/api/admin/sales/content-assets', platformAdminRequired, async (req, res) => {
    try {
      const canViewInternal = isManager(req.platformAdmin) || req.platformAdmin?.role === 'auditor';
      const items = canViewInternal
        ? (await pool.query(
            `SELECT * FROM sales_content_assets WHERE active=true
             ORDER BY knowledge_domain, updated_at DESC LIMIT $1`,
            [Math.min(Number(req.query?.limit) || 100, 500)]
          )).rows
        : await listSendableContentAssets(pool, { tag: req.query?.tag, limit: Number(req.query?.limit) || 100 });
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/content-assets', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const body = req.body || {};
      const assetKey = String(body.asset_key || '').trim();
      const title = String(body.title || '').trim();
      const contentType = String(body.content_type || '').trim();
      const knowledgeDomain = String(body.knowledge_domain || 'customer_ai').trim();
      if (!assetKey || !title || !['text', 'image', 'file', 'video', 'link', 'qr'].includes(contentType)) return res.status(400).json({ ok: false, error: 'invalid_asset' });
      if (!['customer_ai', 'sales_ai', 'implementation'].includes(knowledgeDomain)) return res.status(400).json({ ok: false, error: 'invalid_knowledge_domain' });
      if (knowledgeDomain !== 'customer_ai' && (body.external_approved || body.auto_send_allowed)) return res.status(400).json({ ok: false, error: 'internal_asset_cannot_be_external' });
      const mediaUrl = String(body.media_url || '');
      if (['image', 'file', 'video', 'qr'].includes(contentType) && !(/^https:\/\//.test(mediaUrl) || /^\/uploads\/[A-Za-z0-9._-]+$/.test(mediaUrl))) {
        return res.status(400).json({ ok: false, error: 'safe_media_url_required' });
      }
      const r = await pool.query(
        `INSERT INTO sales_content_assets (asset_key,title,content_type,text_content,media_url,file_name,external_approved,active,auto_send_allowed,tags,created_by,approved_by,nurture_step,knowledge_domain,customer_types,version_no,effective_from,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
         ON CONFLICT (asset_key) DO UPDATE SET title=EXCLUDED.title,content_type=EXCLUDED.content_type,text_content=EXCLUDED.text_content,media_url=EXCLUDED.media_url,file_name=EXCLUDED.file_name,external_approved=EXCLUDED.external_approved,active=EXCLUDED.active,auto_send_allowed=EXCLUDED.auto_send_allowed,tags=EXCLUDED.tags,approved_by=EXCLUDED.approved_by,nurture_step=EXCLUDED.nurture_step,knowledge_domain=EXCLUDED.knowledge_domain,customer_types=EXCLUDED.customer_types,version_no=EXCLUDED.version_no,effective_from=EXCLUDED.effective_from,expires_at=EXCLUDED.expires_at,updated_at=NOW()
         RETURNING *`,
        [assetKey, title, contentType, body.text_content || null, body.media_url || null, body.file_name || null, knowledgeDomain === 'customer_ai' && !!body.external_approved, body.active !== false, knowledgeDomain === 'customer_ai' && !!body.auto_send_allowed, JSON.stringify(Array.isArray(body.tags) ? body.tags : []), req.platformAdmin.username, body.external_approved ? req.platformAdmin.username : null, body.nurture_step ? Number(body.nurture_step) : null, knowledgeDomain, JSON.stringify(Array.isArray(body.customer_types) ? body.customer_types : []), Math.max(1, Number(body.version_no) || 1), body.effective_from || null, body.expires_at || null]
      );
      res.json({ ok: true, asset: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  if (upload?.single) app.post('/api/admin/sales/content-assets/upload', platformAdminRequired, managerGate, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
      if (Number(req.file.size || 0) > 20 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'asset_too_large', message: '企微发送素材不能超过20MB' });
      const mime = String(req.file.mimetype || '');
      const contentType = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
      res.json({ ok: true, media_url: `/uploads/${req.file.filename}`, file_name: req.file.originalname, content_type: contentType });
    } catch (e) { res.status(500).json({ ok: false, error: 'upload_failed', message: e?.message }); }
  });

  if (upload?.single) app.post('/api/admin/sales/documents/upload', platformAdminRequired, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
      if (Number(req.file.size || 0) > 20 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'document_too_large' });
      const mime = String(req.file.mimetype || '');
      const allowed = mime === 'application/pdf' || mime.startsWith('image/') || mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (!allowed) return res.status(415).json({ ok: false, error: 'unsupported_document_type' });
      res.json({ ok: true, file_url: `/uploads/${req.file.filename}`, file_name: req.file.originalname });
    } catch (e) { res.status(500).json({ ok: false, error: 'upload_failed', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/content-deliveries', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const assetId = Number(req.body?.asset_id);
      const r = await pool.query(`SELECT * FROM sales_content_assets WHERE id=$1 AND active=true AND external_approved=true LIMIT 1`, [assetId]);
      if (!r.rows?.[0]) return res.status(404).json({ ok: false, error: 'approved_asset_not_found' });
      const result = await sendContentAssetToLead(pool, lead, r.rows[0], { deliveryType: 'manual', sentBy: req.platformAdmin.username });
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, asset_key, payload, created_by) VALUES ($1,'send_content',$2,$3::jsonb,$4)`, [lead.id, r.rows[0].asset_key, JSON.stringify(result), req.platformAdmin.username]);
      res.json({ ok: true, result });
    } catch (e) { res.status(502).json({ ok: false, error: 'content_delivery_failed', message: e?.message }); }
  });

  app.put('/api/admin/sales/leads/:id/auto-nurture', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const enabled = req.body?.enabled === true;
      const r = await pool.query(`UPDATE sales_leads SET auto_nurture_enabled=$2, auto_nurture_paused_at=CASE WHEN $2 THEN NULL ELSE NOW() END, updated_at=NOW() WHERE id=$1 RETURNING id,auto_nurture_enabled,auto_nurture_paused_at`, [lead.id, enabled]);
      res.json({ ok: true, lead: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });
}
