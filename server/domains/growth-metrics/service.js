/**
 * Growth metrics / events / alerts / ABC distribution — pure logic (no req/res).
 */
import { childLogger } from '../../utils/logger.js';
import { cleanText, cleanPhone, parseOccurredAt, EVENT_TYPES } from './helpers.js';

const log = childLogger({ domain: 'growth-metrics', handler: 'service' });

export async function recomputeDailyMetrics(pool, days = 7) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  await pool.query(
    `INSERT INTO growth_daily_metrics (
       metric_date, store_id, campaign_id, channel,
       scan_count, authorized_count,
       coupon_claimed_count, coupon_purchased_count, marketing_triggered_count,
       coupon_redeemed_count, payment_count, revenue_fen, roi, updated_at, tenant_id
     )
     SELECT
       occurred_at::date AS metric_date,
       COALESCE(store_id, '') AS store_id,
       COALESCE(campaign_id, '') AS campaign_id,
       COALESCE(channel, '') AS channel,
       COUNT(*) FILTER (WHERE event_type = 'campaign_scan')::int AS scan_count,
       COUNT(*) FILTER (WHERE event_type = 'phone_authorized')::int AS authorized_count,
       COUNT(*) FILTER (WHERE event_type = 'coupon_claimed')::int AS coupon_claimed_count,
       COUNT(*) FILTER (WHERE event_type = 'coupon_purchased')::int AS coupon_purchased_count,
       COUNT(*) FILTER (WHERE event_type = 'marketing_triggered')::int AS marketing_triggered_count,
       COUNT(*) FILTER (WHERE event_type = 'coupon_redeemed')::int AS coupon_redeemed_count,
       COUNT(*) FILTER (WHERE event_type = 'payment_success')::int AS payment_count,
        COALESCE(SUM(amount_fen) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed')), 0)::int AS revenue_fen,
        CASE WHEN COUNT(*) FILTER (WHERE event_type = 'campaign_scan') > 0
          THEN ROUND(COALESCE(SUM(amount_fen) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed')), 0)::numeric / COUNT(*) FILTER (WHERE event_type = 'campaign_scan'), 4)
          ELSE NULL END AS roi,
        NOW(),
        current_setting('app.tenant_id', true)
     FROM growth_events
     WHERE occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
     GROUP BY 1,2,3,4
     ON CONFLICT (metric_date, store_id, campaign_id, channel, tenant_id)
     DO UPDATE SET
       scan_count = EXCLUDED.scan_count,
       authorized_count = EXCLUDED.authorized_count,
       coupon_claimed_count = EXCLUDED.coupon_claimed_count,
       coupon_purchased_count = EXCLUDED.coupon_purchased_count,
       marketing_triggered_count = EXCLUDED.marketing_triggered_count,
       coupon_redeemed_count = EXCLUDED.coupon_redeemed_count,
        payment_count = EXCLUDED.payment_count,
        revenue_fen = EXCLUDED.revenue_fen,
        roi = EXCLUDED.roi,
        updated_at = NOW()`,
    [safeDays]
  );
  return safeDays;
}

/** Sanitize coupon_redeemed amount_fen (short_code*100 / absurd values → 0). Exported for tests. */
export function sanitizeRedeemAmountFen(amountFen, metadata = {}) {
  let fen = Math.max(0, Math.floor(Number(amountFen) || 0));
  const shortCode = String(metadata.short_code || '').trim();
  const looksLikeShortCodeAsAmount = /^[0-9]+$/.test(shortCode) && fen === Number(shortCode) * 100;
  if (looksLikeShortCodeAsAmount || fen > 500000) {
    return { amountFen: 0, cleared: true, raw: fen, shortCode };
  }
  return { amountFen: fen, cleared: false, raw: fen, shortCode };
}

export async function recomputeSegments(ctx, tenantId) {
  const result = await ctx.tenantContext.run(tenantId, () =>
    ctx.recomputeDiningSegments(ctx.pool, tenantId)
  );
  return { status: 200, body: { ok: true, result } };
}

export async function ingestMiniprogramEvent(ctx, { body, req }) {
  const eventType = cleanText(body?.event_type, 80);
  if (!EVENT_TYPES.has(eventType)) {
    return { status: 400, body: { ok: false, error: 'invalid_event_type' } };
  }

  const storeId = cleanText(body.store_id, 128);
  const tenantId = await ctx.resolveTenantIdForStore(ctx.pool, storeId);
  const binding = await ctx.verifyServerTenantBinding(ctx.pool, req, { tenantId, storeId });
  if (!binding.ok) {
    return { status: binding.status, body: { ok: false, error: binding.error } };
  }

  try {
    const result = await ctx.tenantContext.run(tenantId, async () => {
      const customer = await ctx.upsertCustomer(ctx.pool, body, tenantId);
      const campaignId = cleanText(body.campaign_id || body.scene, 128);
      const channel = cleanText(body.channel, 80);
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      let amountFen = Math.max(0, Math.floor(Number(body.amount_fen) || 0));
      if (eventType === 'coupon_redeemed') {
        const sanitized = sanitizeRedeemAmountFen(amountFen, metadata);
        if (sanitized.cleared) {
          log.warn({ msg: 'growth-metrics_service_warn', detail: [`[growth] coupon_redeemed amount_fen 异常(疑似核销码/金额混淆)，已清零待回填：raw=${sanitized.raw} short_code=${sanitized.shortCode}`] });
          amountFen = 0;
        }
      }
      const occurredAt = parseOccurredAt(body.occurred_at);
      const idempotencyKey = cleanText(body.idempotency_key, 255) || null;

      if (campaignId) {
        await ctx.pool.query(
          `INSERT INTO growth_campaigns (campaign_id, channel, store_id, meta, tenant_id)
           VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4::jsonb, $5)
           ON CONFLICT (campaign_id, tenant_id) DO UPDATE SET
             channel = COALESCE(growth_campaigns.channel, EXCLUDED.channel),
             store_id = COALESCE(growth_campaigns.store_id, EXCLUDED.store_id),
             updated_at = NOW()`,
          [campaignId, channel, storeId, JSON.stringify({ first_event_type: eventType }), tenantId]
        );
      }

      const inserted = await ctx.pool.query(
        `INSERT INTO growth_events (
           event_type, customer_id, phone, openid, external_userid, store_id, campaign_id, channel,
           coupon_id, order_id, amount_fen, idempotency_key, metadata, occurred_at, tenant_id
         ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,$12,$13::jsonb,$14,$15)
         ON CONFLICT (idempotency_key, tenant_id) DO NOTHING
         RETURNING id`,
        [
          eventType,
          customer?.id || null,
          cleanPhone(body.phone),
          cleanText(body.openid, 128),
          cleanText(body.external_userid, 128),
          storeId,
          campaignId,
          channel,
          cleanText(body.coupon_id, 128),
          cleanText(body.order_id, 128),
          amountFen,
          idempotencyKey,
          JSON.stringify(metadata),
          occurredAt,
          tenantId,
        ]
      );

      if (eventType === 'coupon_redeemed' && inserted.rows.length) {
        await ctx.pool.query(
          `INSERT INTO growth_redemptions (customer_id, coupon_id, campaign_id, store_id, amount_fen, metadata, redeemed_at, tenant_id)
           VALUES ($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6::jsonb,$7,$8)
           ON CONFLICT DO NOTHING`,
          [
            customer?.id || null,
            cleanText(body.coupon_id, 128),
            campaignId,
            storeId,
            amountFen,
            JSON.stringify(metadata),
            occurredAt,
            tenantId,
          ]
        );
        const redeemShortCode = cleanText(metadata.short_code || '', 64);
        if (redeemShortCode) {
          await ctx.pool
            .query(
              `UPDATE growth_delivery_logs
                  SET status = 'redeemed', updated_at = NOW()
                WHERE channel = 'sms'
                  AND status = 'sent'
                  AND payload->>'coupon_code' = $1`,
              [redeemShortCode]
            )
            .catch((e) => log.warn({ msg: 'growth_delivery_redeem_flip_failed', err: e?.message }));
        }
      }

      const matchPhone = cleanPhone(body.phone);
      if ((eventType === 'phone_authorized' || eventType === 'wechat_match_check') && matchPhone) {
        try {
          const wwMatch = await ctx.pool.query(
            `UPDATE wechat_work_customers SET bind_customer_id = $1, updated_at = NOW()
             WHERE phone = $2 AND bind_customer_id IS NULL
             RETURNING id, store_id`,
            [customer?.id, matchPhone]
          );
          if (wwMatch.rows.length) {
            log.info({
              msg: 'growth_wechat_work_customer_matched',
              customer_id: customer?.id || null,
            });
          }
        } catch (e) {
          log.warn({ msg: 'growth_wechat_work_match_failed', err: e?.message });
        }
      }

      return { inserted: inserted.rows.length > 0, customer_id: customer?.id || null };
    });

    return {
      status: 200,
      body: { ok: true, inserted: result.inserted, customer_id: result.customer_id },
    };
  } catch (e) {
    log.error({ msg: 'growth_miniprogram_event_failed', err: e?.message || String(e) });
    return { status: 500, body: { ok: false, error: 'server_error' } };
  }
}

export async function triggerMetricsRecompute(ctx, tenantId, days) {
  const safeDays = await ctx.tenantContext.run(tenantId, () =>
    recomputeDailyMetrics(ctx.pool, days || 7)
  );
  return { status: 200, body: { ok: true, days: safeDays } };
}

export async function posConsumption(ctx, { body, headers, tenantIdFromAuth, req }) {
  const storeId = cleanText(body.store_id || headers['x-store-id'], 128);
  const tenantId =
    cleanText(body.tenant_id || headers['x-tenant-id'] || tenantIdFromAuth, 128) || 'default';
  const binding = await ctx.verifyServerTenantBinding(ctx.pool, req, { tenantId, storeId });
  if (!binding.ok) {
    return { status: binding.status, body: { ok: false, error: binding.error } };
  }
  const windowDays = Math.min(Math.max(Number(body.window_days) || 30, 1), 365);
  let phones = Array.isArray(body.phones) ? body.phones : [];
  phones = phones.map((p) => cleanPhone(p)).filter(Boolean);
  phones = Array.from(new Set(phones));
  if (phones.length > 5000) phones = phones.slice(0, 5000);
  if (!phones.length) {
    return {
      status: 200,
      body: { ok: true, window_days: windowDays, matched: 0, data: {} },
    };
  }

  const r = await ctx.pool.query(
    `SELECT trim(phone) AS phone,
            ROUND(COALESCE(SUM(amount_after_discount), 0) * 100)::bigint AS total_spent_fen,
            COUNT(*)::int AS total_orders,
            ROUND(COALESCE(SUM(amount_after_discount)
              FILTER (WHERE biz_date >= (CURRENT_DATE - ($2::int || ' days')::interval)), 0) * 100)::bigint AS spent_30d_fen,
            MAX(checkout_time) AS last_visit,
            (ARRAY_AGG(store_id ORDER BY checkout_time DESC NULLS LAST))[1] AS last_store_id
     FROM pos_orders
     WHERE trim(phone) = ANY($1::text[]) AND phone IS NOT NULL AND trim(phone) <> ''
     GROUP BY trim(phone)`,
    [phones, windowDays]
  );

  const lastOrderRes = await ctx.pool.query(
    `WITH last_orders AS (
       SELECT DISTINCT ON (trim(phone))
              trim(phone) AS phone, order_no, diners, amount_after_discount
       FROM pos_orders
       WHERE trim(phone) = ANY($1::text[]) AND phone IS NOT NULL AND trim(phone) <> ''
       ORDER BY trim(phone), checkout_time DESC NULLS LAST
     )
     SELECT lo.phone, lo.diners, lo.amount_after_discount,
            COALESCE(STRING_AGG(DISTINCT oi.dish_name, '、' ORDER BY oi.dish_name)
              FILTER (WHERE oi.dish_name IS NOT NULL AND oi.dish_name <> ''), '') AS last_order_dishes
     FROM last_orders lo
     LEFT JOIN pos_order_items oi ON oi.order_no = lo.order_no
     GROUP BY lo.phone, lo.diners, lo.amount_after_discount`,
    [phones]
  );
  const lastOrderByPhone = {};
  for (const row of lastOrderRes.rows) {
    lastOrderByPhone[row.phone] = {
      diners: Number(row.diners) || 0,
      amount_fen: Math.round((Number(row.amount_after_discount) || 0) * 100),
      dishes: row.last_order_dishes || '',
    };
  }

  const data = {};
  for (const row of r.rows) {
    const lastOrder = lastOrderByPhone[row.phone] || null;
    data[row.phone] = {
      total_spent_fen: Number(row.total_spent_fen) || 0,
      total_orders: Number(row.total_orders) || 0,
      spent_30d_fen: Number(row.spent_30d_fen) || 0,
      last_visit: row.last_visit ? new Date(row.last_visit).toISOString() : null,
      store_id: row.last_store_id || '',
      last_order_dishes: lastOrder ? lastOrder.dishes : '',
      last_order_diners: lastOrder ? lastOrder.diners : 0,
      last_order_amount_fen: lastOrder ? lastOrder.amount_fen : 0,
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      window_days: windowDays,
      requested: phones.length,
      matched: r.rows.length,
      data,
    },
  };
}

export async function listMetrics(ctx, tenantId, query) {
  const days = Math.min(Math.max(Number(query.days) || 7, 1), 365);
  const r = await ctx.tenantContext.run(tenantId, async () => {
    if (query.recompute === '1' || query.recompute === 'true') {
      await recomputeDailyMetrics(ctx.pool, days);
    }
    return ctx.pool.query(
      `SELECT * FROM growth_daily_metrics
       WHERE metric_date >= CURRENT_DATE - ($1::int || ' days')::interval
         AND ($2::text = '' OR store_id = $2)
         AND ($3::text = '' OR campaign_id = $3)
       ORDER BY metric_date DESC, store_id, campaign_id, channel
       LIMIT 1000`,
      [days, cleanText(query.store_id || '', 128), cleanText(query.campaign_id || '', 128)]
    );
  });
  return { status: 200, body: { ok: true, rows: r.rows } };
}

export async function listAlerts(ctx, tenantId, query) {
  const status = cleanText(query.status || 'open', 40);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT * FROM growth_alerts WHERE ($1::text = '' OR status = $1) ORDER BY created_at DESC LIMIT 200`,
      [status]
    )
  );
  return { status: 200, body: { ok: true, alerts: r.rows } };
}

export async function upsertAlert(ctx, tenantId, body) {
  const b = body || {};
  const alertKey = cleanText(
    b.alert_key ||
      `${b.alert_type || 'growth'}:${b.store_id || ''}:${b.campaign_id || ''}:${new Date().toISOString().slice(0, 10)}`,
    255
  );
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, campaign_id, title, message, suggested_action, metrics, tenant_id)
       VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT (alert_key, tenant_id) DO UPDATE SET
         severity = EXCLUDED.severity,
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         suggested_action = EXCLUDED.suggested_action,
         metrics = EXCLUDED.metrics,
         status = 'open',
         updated_at = NOW()
       RETURNING *`,
      [
        alertKey,
        cleanText(b.alert_type, 80),
        cleanText(b.severity || 'medium', 40),
        cleanText(b.store_id, 128),
        cleanText(b.campaign_id, 128),
        cleanText(b.title, 500),
        cleanText(b.message, 2000),
        cleanText(b.suggested_action, 2000),
        JSON.stringify(b.metrics || {}),
        tenantId,
      ]
    )
  );
  return { status: 200, body: { ok: true, alert: r.rows[0] } };
}

export async function resolveAlert(ctx, tenantId, alertKeyRaw, operatorUsername) {
  const alertKey = cleanText(alertKeyRaw, 255);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `UPDATE growth_alerts SET status = 'resolved', resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE alert_key = $1 RETURNING *`,
      [alertKey, operatorUsername || 'system']
    )
  );
  if (!r.rows.length) return { status: 404, body: { ok: false, error: 'alert_not_found' } };
  return { status: 200, body: { ok: true, alert: r.rows[0] } };
}

export async function computeAbcDistributionForCampaign(ctx, campaignKey, tenantId) {
  const order = ctx.ABC_ROTATION_ORDER[campaignKey];
  if (!order) return null;
  const ruleRes = await ctx.pool.query(
    `SELECT * FROM growth_touch_rules WHERE action_payload->>'campaign_key' = $1 LIMIT 1`,
    [campaignKey]
  );
  if (!ruleRes.rows.length) return null;
  const rule = ruleRes.rows[0];

  const candidates = (await ctx.loadRuleCandidates(ctx.pool, rule, tenantId)).slice(0, 500);
  const phones = [...new Set(candidates.map((c) => cleanPhone(c.phone)).filter(Boolean))];
  const sentCounts = phones.length
    ? await ctx.pool.query(
        `WITH lastvisit AS (
           SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
            WHERE phone = ANY($2::text[]) GROUP BY phone
         )
         SELECT dl.payload->>'phone' AS phone, count(*)::int n FROM growth_delivery_logs dl
           LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
          WHERE dl.channel='sms' AND dl.status = 'sent' AND dl.rule_key = $1
            AND dl.payload->>'phone' = ANY($2::text[])
            AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
          GROUP BY 1`,
        [campaignKey, phones]
      )
    : { rows: [] };
  const sentByPhone = new Map(sentCounts.rows.map((r) => [r.phone, Number(r.n)]));

  const dist = {};
  for (const step of order) dist[step] = 0;
  let cycling = 0;
  let blacklisted = 0;
  for (const c of candidates) {
    const phone = cleanPhone(c.phone);
    if (!phone) continue;
    const totalSent = sentByPhone.get(phone) || 0;
    const { step, blacklisted: bl } = ctx.deriveAbcStep(campaignKey, totalSent);
    if (bl) {
      blacklisted++;
      continue;
    }
    dist[step] = (dist[step] || 0) + 1;
    if (totalSent >= order.length) cycling++;
  }
  return {
    rule_key: rule.rule_key,
    total: candidates.length,
    step_distribution: dist,
    cycling,
    blacklisted,
  };
}

export async function abcDistribution(ctx, tenantId, campaignKeyRaw) {
  const campaignKey = cleanText(campaignKeyRaw, 64);
  if (!ctx.ABC_ROTATION_ORDER[campaignKey]) {
    return { status: 200, body: { ok: true, enabled: false } };
  }
  const result = await ctx.tenantContext.run(tenantId, () =>
    computeAbcDistributionForCampaign(ctx, campaignKey, tenantId)
  );
  if (!result) return { status: 404, body: { ok: false, error: 'rule_not_found' } };
  return { status: 200, body: { ok: true, enabled: true, ...result } };
}

export async function abcBlacklistSummary(ctx, tenantId) {
  const campaignKeys = Object.keys(ctx.ABC_ROTATION_ORDER);
  const items = await ctx.tenantContext.run(tenantId, async () => {
    const out = [];
    for (const campaignKey of campaignKeys) {
      const r = await computeAbcDistributionForCampaign(ctx, campaignKey, tenantId).catch(() => null);
      if (r) {
        out.push({
          campaign_key: campaignKey,
          rule_key: r.rule_key,
          total: r.total,
          blacklisted: r.blacklisted,
        });
      }
    }
    return out;
  });
  const totalBlacklisted = items.reduce((sum, it) => sum + it.blacklisted, 0);
  return { status: 200, body: { ok: true, items, total_blacklisted: totalBlacklisted } };
}
