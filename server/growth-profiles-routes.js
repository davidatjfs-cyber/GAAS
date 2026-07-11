/**
 * Growth profiles + strategy context routes (extracted from growth-api.js — monolith split).
 * registerGrowthProfilesRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  recomputeCustomerProfiles,
  upsertCustomer,
  parseOccurredAt,
  resolveTenantIdForStore,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function registerGrowthProfilesRoutes(app, pool) {
  app.get('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await tenantContext.run(getGrowthTenantId(req), () =>
      pool.query(`SELECT * FROM store_marketing_profiles ORDER BY updated_at DESC LIMIT 300`)
    );
    return res.json({ ok: true, profiles: r.rows });
  });

  app.post('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
    const tenantId = getGrowthTenantId(req);
    const r = await tenantContext.run(tenantId, () =>
      pool.query(
        `INSERT INTO store_marketing_profiles (store_id, brand, avg_ticket_fen, primary_audience, peak_hours, suitable_offers, unsuitable_offers, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
         ON CONFLICT (store_id, tenant_id) DO UPDATE SET
           brand = EXCLUDED.brand,
           avg_ticket_fen = EXCLUDED.avg_ticket_fen,
           primary_audience = EXCLUDED.primary_audience,
           peak_hours = EXCLUDED.peak_hours,
           suitable_offers = EXCLUDED.suitable_offers,
           unsuitable_offers = EXCLUDED.unsuitable_offers,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING *`,
        [storeId, cleanText(b.brand, 128), Math.max(0, Math.floor(Number(b.avg_ticket_fen) || 0)), cleanText(b.primary_audience, 500), JSON.stringify(b.peak_hours || []), JSON.stringify(b.suitable_offers || []), JSON.stringify(b.unsuitable_offers || []), cleanText(b.notes, 4000), tenantId]
      )
    );
    return res.json({ ok: true, profile: r.rows[0] });
  });

  app.get('/api/growth/customer-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const lifecycle = cleanText(req.query.lifecycle_stage || '', 40);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT * FROM growth_customer_profiles
       WHERE ($1::text = '' OR store_id = $1)
         AND ($2::text = '' OR lifecycle_stage = $2)
       ORDER BY updated_at DESC
       LIMIT 300`,
      [storeId, lifecycle]
    ));
    return res.json({ ok: true, profiles: r.rows });
  });

  app.post('/api/growth/customer-profiles/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const recomputeTenantId = getGrowthTenantId(req);
    const days = await tenantContext.run(recomputeTenantId, () => recomputeCustomerProfiles(pool, req.body?.days || 90, recomputeTenantId));
    return res.json({ ok: true, days });
  });

  app.get('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const customerId = Number(req.query.customer_id) || 0;
    const signalType = cleanText(req.query.signal_type || '', 80);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT * FROM growth_profile_signals
       WHERE ($1::bigint = 0 OR customer_id = $1)
         AND ($2::text = '' OR signal_type = $2)
         AND tenant_id = $3
       ORDER BY occurred_at DESC
       LIMIT 300`,
      [customerId, signalType, getGrowthTenantId(req)]
    ));
    return res.json({ ok: true, signals: r.rows });
  });

  app.post('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const payload = {
      phone: b.phone,
      openid: b.openid,
      external_userid: b.external_userid,
      store_id: b.store_id,
      customer_meta: {}
    };
    const tenantId = getGrowthTenantId(req);
    const signal = await tenantContext.run(tenantId, async () => {
      const customer = b.customer_id ? { id: Number(b.customer_id) } : await upsertCustomer(pool, payload, tenantId);
      return pool.query(
        `INSERT INTO growth_profile_signals (
          customer_id, signal_type, signal_key, signal_value, signal_score,
          source, store_id, campaign_id, occurred_at, meta, tenant_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
        RETURNING *`,
        [
          customer?.id || null,
          cleanText(b.signal_type, 80),
          cleanText(b.signal_key, 80),
          cleanText(b.signal_value, 500),
          b.signal_score == null ? null : Number(b.signal_score),
          cleanText(b.source, 80),
          cleanText(b.store_id, 128),
          cleanText(b.campaign_id, 128),
          parseOccurredAt(b.occurred_at),
          JSON.stringify(b.meta || {}),
          tenantId
        ]
      );
    });
    return res.json({ ok: true, signal: signal.rows[0] });
  });

  app.get('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await pool.query(
      `SELECT * FROM store_marketing_constraints
       WHERE ($1::text = '' OR store_id = $1)
       ORDER BY updated_at DESC
       LIMIT 200`,
      [storeId]
    );
    return res.json({ ok: true, constraints: r.rows });
  });

  app.post('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
    const constraintTenantId = await resolveTenantIdForStore(pool, storeId);
    const r = await pool.query(
      `INSERT INTO store_marketing_constraints (
        store_id, brand, min_discount_rate, max_coupon_value_fen, monthly_budget_fen,
        max_touch_per_72h, cooldown_hours_after_payment, allowed_channels,
        disallowed_campaign_types, disallowed_dishes, preferred_channels,
        brand_voice_style, execution_notes, active, tenant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)
      ON CONFLICT (store_id, tenant_id) DO UPDATE SET
        brand = EXCLUDED.brand,
        min_discount_rate = EXCLUDED.min_discount_rate,
        max_coupon_value_fen = EXCLUDED.max_coupon_value_fen,
        monthly_budget_fen = EXCLUDED.monthly_budget_fen,
        max_touch_per_72h = EXCLUDED.max_touch_per_72h,
        cooldown_hours_after_payment = EXCLUDED.cooldown_hours_after_payment,
        allowed_channels = EXCLUDED.allowed_channels,
        disallowed_campaign_types = EXCLUDED.disallowed_campaign_types,
        disallowed_dishes = EXCLUDED.disallowed_dishes,
        preferred_channels = EXCLUDED.preferred_channels,
        brand_voice_style = EXCLUDED.brand_voice_style,
        execution_notes = EXCLUDED.execution_notes,
        active = EXCLUDED.active,
        updated_at = NOW()
      RETURNING *`,
      [
        storeId,
        cleanText(b.brand, 128),
        b.min_discount_rate == null ? null : Number(b.min_discount_rate),
        b.max_coupon_value_fen == null ? null : Math.max(0, Math.floor(Number(b.max_coupon_value_fen) || 0)),
        b.monthly_budget_fen == null ? null : Math.max(0, Math.floor(Number(b.monthly_budget_fen) || 0)),
        Math.max(0, Math.floor(Number(b.max_touch_per_72h) || 1)),
        Math.max(0, Math.floor(Number(b.cooldown_hours_after_payment) || 24)),
        JSON.stringify(b.allowed_channels || []),
        JSON.stringify(b.disallowed_campaign_types || []),
        JSON.stringify(b.disallowed_dishes || []),
        JSON.stringify(b.preferred_channels || []),
        cleanText(b.brand_voice_style, 200),
        cleanText(b.execution_notes, 4000),
        b.active !== false,
        constraintTenantId
      ]
    );
    return res.json({ ok: true, constraint: r.rows[0] });
  });

  // ── Strategy context — 为 Agent 提供门店画像+约束上下文 ──
  app.get('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    await handleStrategyContext(cleanText(req.query.store_id, 128), cleanText(req.query.channel, 80), cleanText(req.query.audience, 200), res);
  });

  // Shared handler for strategy-context (used by both GET and POST)
  async function handleStrategyContext(storeId, channel, audience, res) {
    const result = { storeId, channel, audience, profile: null, constraints: null };
    try {
      if (storeId) {
        const [p, c] = await Promise.all([
          pool.query('SELECT * FROM store_marketing_profiles WHERE store_id = $1 LIMIT 1', [storeId]),
          pool.query('SELECT * FROM store_marketing_constraints WHERE store_id = $1 LIMIT 1', [storeId])
        ]);
        if (p.rows?.length) result.profile = p.rows[0];
        if (c.rows?.length) result.constraints = c.rows[0];
      }
      res.json({ ok: true, context: result, summary: { has_profile: !!result.profile, has_constraints: !!result.constraints } });
    } catch (e) { res.status(500).json({ ok: false, error: e?.message }); }
  }

  app.post('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    await handleStrategyContext(cleanText(req.body.store_id, 128), cleanText(req.body.channel, 80), cleanText(req.body.audience, 200), res);
  });
}
