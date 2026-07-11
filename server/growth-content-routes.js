/**
 * Growth content library routes (extracted from growth-api.js — monolith split).
 * registerGrowthContentRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext, resolveTenantIdDefault } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  resolveTenantIdForStore,
  parseOccurredAt,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function registerGrowthContentRoutes(app, pool) {
  app.get('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM public_channels WHERE enabled = TRUE ORDER BY store_id, platform, name LIMIT 300`);
    return res.json({ ok: true, channels: r.rows });
  });

  app.post('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO public_channels (channel_key, name, platform, store_id, owner_username, meta, enabled, tenant_id)
       VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6::jsonb,COALESCE($7, TRUE),$8)
       ON CONFLICT (channel_key, tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         platform = EXCLUDED.platform,
         store_id = EXCLUDED.store_id,
         owner_username = EXCLUDED.owner_username,
         meta = EXCLUDED.meta,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [cleanText(b.channel_key, 128), cleanText(b.name, 200), cleanText(b.platform, 80), cleanText(b.store_id, 128), cleanText(b.owner_username, 128), JSON.stringify(b.meta || {}), b.enabled !== false, resolveTenantIdDefault()]
    );
    return res.json({ ok: true, channel: r.rows[0] });
  });

  app.get('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const r = await pool.query(
      `SELECT * FROM public_promo_tasks
       WHERE ($1::text = '' OR status = $1)
       ORDER BY COALESCE(due_at, created_at) DESC
       LIMIT 300`,
      [status]
    );
    return res.json({ ok: true, tasks: r.rows });
  });

  app.post('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const tenantId = await resolveTenantIdForStore(pool, cleanText(b.store_id, 128));
    const r = await pool.query(
      `INSERT INTO public_promo_tasks (task_key, store_id, channel_key, campaign_id, title, content_brief, copy_text, poster_url, qr_scene, status, assignee_username, due_at, tenant_id)
       VALUES (NULLIF($1,''),NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,COALESCE(NULLIF($10,''),'planned'),NULLIF($11,''),$12,$13)
       ON CONFLICT (task_key, tenant_id) DO UPDATE SET status = EXCLUDED.status, copy_text = EXCLUDED.copy_text, poster_url = EXCLUDED.poster_url, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.task_key, 255), cleanText(b.store_id, 128), cleanText(b.channel_key, 80), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.content_brief, 2000), cleanText(b.copy_text, 4000), cleanText(b.poster_url, 1000), cleanText(b.qr_scene, 255), cleanText(b.status, 40), cleanText(b.assignee_username, 128), b.due_at ? parseOccurredAt(b.due_at) : null, tenantId]
    );
    return res.json({ ok: true, task: r.rows[0] });
  });

  app.get('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await tenantContext.run(getGrowthTenantId(req), () =>
      pool.query(
        `SELECT * FROM creative_assets
         WHERE enabled = TRUE AND ($1::text = '' OR store_id = $1)
         ORDER BY created_at DESC
         LIMIT 300`,
        [storeId]
      )
    );
    return res.json({ ok: true, assets: r.rows });
  });

  app.post('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const tenantId = getGrowthTenantId(req);
    const r = await tenantContext.run(tenantId, () =>
      pool.query(
        `INSERT INTO creative_assets (asset_key, store_id, asset_type, name, url, tags, meta, enabled, tenant_id)
         VALUES (NULLIF($1,''),NULLIF($2,''),$3,$4,$5,$6::jsonb,$7::jsonb,COALESCE($8, TRUE),$9)
         ON CONFLICT (asset_key, tenant_id) DO UPDATE SET
           store_id = EXCLUDED.store_id,
           asset_type = EXCLUDED.asset_type,
           name = EXCLUDED.name,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           meta = EXCLUDED.meta,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()
         RETURNING *`,
        [cleanText(b.asset_key, 255), cleanText(b.store_id, 128), cleanText(b.asset_type, 80), cleanText(b.name, 300), cleanText(b.url, 1000), JSON.stringify(b.tags || []), JSON.stringify(b.meta || {}), b.enabled !== false, tenantId]
      )
    );
    return res.json({ ok: true, asset: r.rows[0] });
  });

  app.get('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM poster_templates WHERE enabled = TRUE ORDER BY category, name LIMIT 300`);
    return res.json({ ok: true, templates: r.rows });
  });

  app.post('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const purposes = Array.isArray(b.purposes) ? b.purposes.filter(Boolean) : [];
    const channels = Array.isArray(b.channels) ? b.channels.filter(Boolean) : [];
    const r = await pool.query(
      `INSERT INTO poster_templates (template_key, name, category, channel, aspect_ratio, layout, style_guide, image_url, enabled, purposes, channels, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,COALESCE($9, TRUE),$10,$11,$12)
       ON CONFLICT (template_key, tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         channel = EXCLUDED.channel,
         aspect_ratio = EXCLUDED.aspect_ratio,
         layout = EXCLUDED.layout,
         style_guide = EXCLUDED.style_guide,
         image_url = EXCLUDED.image_url,
         enabled = EXCLUDED.enabled,
         purposes = EXCLUDED.purposes,
         channels = EXCLUDED.channels,
         updated_at = NOW()
       RETURNING *`,
      [cleanText(b.template_key, 128), cleanText(b.name, 300), cleanText(b.category, 80), cleanText(b.channel, 80), cleanText(b.aspect_ratio, 40), JSON.stringify(b.layout || {}), JSON.stringify(b.style_guide || {}), cleanText(b.image_url, 1000), b.enabled !== false, purposes, channels, resolveTenantIdDefault()]
    );
    return res.json({ ok: true, template: r.rows[0] });
  });

  app.delete('/api/growth/poster-templates/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM poster_templates WHERE id = $1', [id]);
    return res.json({ ok: true });
  });

  app.delete('/api/growth/creative-assets/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM creative_assets WHERE id = $1', [id]);
    return res.json({ ok: true });
  });

  app.get('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const r = await pool.query(
      `SELECT * FROM generated_posters
       WHERE ($1::text = '' OR status = $1)
       ORDER BY created_at DESC
       LIMIT 300`,
      [status]
    );
    return res.json({ ok: true, posters: r.rows });
  });

  app.post('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const tenantId = await resolveTenantIdForStore(pool, cleanText(b.store_id, 128));
    const r = await pool.query(
      `INSERT INTO generated_posters (poster_key, campaign_id, store_id, template_key, title, subtitle, cta, image_url, output_url, purposes, channels, status, meta, tenant_id)
       VALUES (NULLIF($1,''),NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,COALESCE(NULLIF($12,''),'draft'),$13::jsonb,$14)
       ON CONFLICT (poster_key, tenant_id) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, cta = EXCLUDED.cta, output_url = EXCLUDED.output_url, purposes = EXCLUDED.purposes, channels = EXCLUDED.channels, status = EXCLUDED.status, meta = EXCLUDED.meta, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.poster_key, 255), cleanText(b.campaign_id, 128), cleanText(b.store_id, 128), cleanText(b.template_key, 128), cleanText(b.title, 500), cleanText(b.subtitle, 1000), cleanText(b.cta, 500), cleanText(b.image_url, 1000), cleanText(b.output_url, 1000), Array.isArray(b.purposes) ? b.purposes.filter(Boolean) : [], Array.isArray(b.channels) ? b.channels.filter(Boolean) : [], cleanText(b.status, 40), JSON.stringify(b.meta || {}), tenantId]
    );
    return res.json({ ok: true, poster: r.rows[0] });
  });

  app.get('/api/growth/content-library', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const purpose = cleanText(req.query.purpose || '', 40);
    const channel = cleanText(req.query.channel || '', 40);
    const storeId = cleanText(req.query.store_id || '', 128);
    const conditions = ["gp.status IN ('generated','published')"];
    const params = [];
    let idx = 1;
    if (purpose) { conditions.push(`$${idx} = ANY(gp.purposes)`); params.push(purpose); idx++; }
    if (channel) { conditions.push(`$${idx} = ANY(gp.channels)`); params.push(channel); idx++; }
    if (storeId) { conditions.push(`(gp.store_id IS NULL OR gp.store_id = '' OR gp.store_id = $${idx})`); params.push(storeId); idx++; }
    const query = `SELECT gp.id, gp.poster_key AS template_key, COALESCE(pt.name, gp.title, '海报') AS name, gp.title, gp.subtitle, gp.purposes, gp.channels, gp.output_url AS image_url, gp.created_at
      FROM generated_posters gp
      LEFT JOIN poster_templates pt ON pt.template_key = gp.template_key
      WHERE ${conditions.join(' AND ')}
      ORDER BY gp.created_at DESC LIMIT 100`;
    const r = await pool.query(query, params);
    return res.json({ ok: true, items: r.rows });
  });

  app.delete('/api/growth/generated-posters/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM generated_posters WHERE id = $1', [id]);
    return res.json({ ok: true });
  });
}
