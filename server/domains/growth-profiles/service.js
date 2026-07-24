/**
 * Growth profiles + strategy context — pure logic (no req/res).
 */
import { cleanText, normalizeConstraintFields, buildStrategyContextSummary } from './helpers.js';

export async function listStoreProfiles(ctx, tenantId) {
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(`SELECT * FROM store_marketing_profiles ORDER BY updated_at DESC LIMIT 300`)
  );
  return { status: 200, body: { ok: true, profiles: r.rows } };
}

export async function upsertStoreProfile(ctx, tenantId, body) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
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
      [
        storeId,
        cleanText(b.brand, 128),
        Math.max(0, Math.floor(Number(b.avg_ticket_fen) || 0)),
        cleanText(b.primary_audience, 500),
        JSON.stringify(b.peak_hours || []),
        JSON.stringify(b.suitable_offers || []),
        JSON.stringify(b.unsuitable_offers || []),
        cleanText(b.notes, 4000),
        tenantId,
      ]
    )
  );
  return { status: 200, body: { ok: true, profile: r.rows[0] } };
}

export async function listCustomerProfiles(ctx, tenantId, query) {
  const storeId = cleanText(query.store_id || '', 128);
  const lifecycle = cleanText(query.lifecycle_stage || '', 40);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT * FROM growth_customer_profiles
       WHERE ($1::text = '' OR store_id = $1)
         AND ($2::text = '' OR lifecycle_stage = $2)
       ORDER BY updated_at DESC
       LIMIT 300`,
      [storeId, lifecycle]
    )
  );
  return { status: 200, body: { ok: true, profiles: r.rows } };
}

export async function recomputeProfiles(ctx, tenantId, body) {
  const days = await ctx.tenantContext.run(tenantId, () =>
    ctx.recomputeCustomerProfiles(ctx.pool, body?.days || 90, tenantId)
  );
  return { status: 200, body: { ok: true, days } };
}

export async function listProfileSignals(ctx, tenantId, query) {
  const customerId = Number(query.customer_id) || 0;
  const signalType = cleanText(query.signal_type || '', 80);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT * FROM growth_profile_signals
       WHERE ($1::bigint = 0 OR customer_id = $1)
         AND ($2::text = '' OR signal_type = $2)
         AND tenant_id = $3
       ORDER BY occurred_at DESC
       LIMIT 300`,
      [customerId, signalType, tenantId]
    )
  );
  return { status: 200, body: { ok: true, signals: r.rows } };
}

export async function createProfileSignal(ctx, tenantId, body) {
  const b = body || {};
  const payload = {
    phone: b.phone,
    openid: b.openid,
    external_userid: b.external_userid,
    store_id: b.store_id,
    customer_meta: {},
  };
  const signal = await ctx.tenantContext.run(tenantId, async () => {
    const customer = b.customer_id
      ? { id: Number(b.customer_id) }
      : await ctx.upsertCustomer(ctx.pool, payload, tenantId);
    return ctx.pool.query(
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
        ctx.parseOccurredAt(b.occurred_at),
        JSON.stringify(b.meta || {}),
        tenantId,
      ]
    );
  });
  return { status: 200, body: { ok: true, signal: signal.rows[0] } };
}

export async function listStoreConstraints(ctx, query) {
  const storeId = cleanText(query.store_id || '', 128);
  const r = await ctx.pool.query(
    `SELECT * FROM store_marketing_constraints
       WHERE ($1::text = '' OR store_id = $1)
       ORDER BY updated_at DESC
       LIMIT 200`,
    [storeId]
  );
  return { status: 200, body: { ok: true, constraints: r.rows } };
}

export async function upsertStoreConstraint(ctx, body) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  const f = normalizeConstraintFields(b);
  const constraintTenantId = await ctx.resolveTenantIdForStore(ctx.pool, storeId);
  const r = await ctx.pool.query(
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
      f.brand,
      f.min_discount_rate,
      f.max_coupon_value_fen,
      f.monthly_budget_fen,
      f.max_touch_per_72h,
      f.cooldown_hours_after_payment,
      JSON.stringify(f.allowed_channels),
      JSON.stringify(f.disallowed_campaign_types),
      JSON.stringify(f.disallowed_dishes),
      JSON.stringify(f.preferred_channels),
      f.brand_voice_style,
      f.execution_notes,
      f.active,
      constraintTenantId,
    ]
  );
  return { status: 200, body: { ok: true, constraint: r.rows[0] } };
}

export async function getStrategyContext(ctx, storeIdRaw, channelRaw, audienceRaw) {
  const storeId = cleanText(storeIdRaw, 128);
  const channel = cleanText(channelRaw, 80);
  const audience = cleanText(audienceRaw, 200);
  const result = { storeId, channel, audience, profile: null, constraints: null };
  try {
    if (storeId) {
      const [p, c] = await Promise.all([
        ctx.pool.query('SELECT * FROM store_marketing_profiles WHERE store_id = $1 LIMIT 1', [
          storeId,
        ]),
        ctx.pool.query('SELECT * FROM store_marketing_constraints WHERE store_id = $1 LIMIT 1', [
          storeId,
        ]),
      ]);
      if (p.rows?.length) result.profile = p.rows[0];
      if (c.rows?.length) result.constraints = c.rows[0];
    }
    return {
      status: 200,
      body: {
        ok: true,
        context: result,
        summary: buildStrategyContextSummary(result),
      },
    };
  } catch (e) {
    return { status: 500, body: { ok: false, error: e?.message } };
  }
}
