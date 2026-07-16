/**
 * Growth metrics/events ingestion + alerts + ABC distribution routes (extracted from growth-api.js — monolith split).
 * registerGrowthMetricsRoutes(app, pool) — behavior-preserving move.
 */
import { runForActiveTenants, tenantContext } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
  resolveTenantIdForStore,
  upsertCustomer,
  recomputeDiningSegments,
  loadRuleCandidates,
  ABC_ROTATION_ORDER,
  deriveAbcStep,
} from './growth-api.js';
import { verifyServerTenantBinding } from './middleware/server-tenant-binding.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const EVENT_TYPES = new Set([
  'campaign_scan',
  'phone_authorized',
  'coupon_claimed',
  'coupon_purchased',
  'coupon_redeemed',
  'payment_success',
  'customer_arrived',
  'marketing_triggered',
  'wechat_match_check',
  'customer_profile_updated'
]);

export function registerGrowthMetricsRoutes(app, pool) {
  async function recomputeDailyMetrics(days = 7) {
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

  // 就餐时段标签：手动重算端点 + 每日重算(随 POS 数据更新保持新鲜)
  app.post('/api/growth/segments/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const segmentTenantId = getGrowthTenantId(req);
      const result = await tenantContext.run(segmentTenantId, () => recomputeDiningSegments(pool, segmentTenantId));
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  if (!globalThis.__growthSegmentTimer) {
    globalThis.__growthSegmentTimer = setInterval(() => {
      runForActiveTenants(() => recomputeDiningSegments(pool)).catch((e) => console.warn('[segments] recompute failed:', e?.message));
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => recomputeDiningSegments(pool)).catch((e) => console.warn('[segments] initial recompute failed:', e?.message));
    }, 30000);
  }

  app.post('/api/miniprogram/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const eventType = cleanText(body.event_type, 80);
      if (!EVENT_TYPES.has(eventType)) {
        return res.status(400).json({ ok: false, error: 'invalid_event_type' });
      }

      const storeId = cleanText(body.store_id, 128);
      const tenantId = await resolveTenantIdForStore(pool, storeId);
      const binding = await verifyServerTenantBinding(pool, req, { tenantId, storeId });
      if (!binding.ok) return res.status(binding.status).json({ ok: false, error: binding.error });
      const result = await tenantContext.run(tenantId, async () => {
        const customer = await upsertCustomer(pool, body, tenantId);
        const campaignId = cleanText(body.campaign_id || body.scene, 128);
        const channel = cleanText(body.channel, 80);
        const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
        let amountFen = Math.max(0, Math.floor(Number(body.amount_fen) || 0));
        // 防御：曾发生小程序把「核销码(short_code)」误当「金额」传入的真实事故(如
        // amount_fen === short_code*100)，单笔核销污染活动累计营收/ROI统计。核销场景下
        // 金额远超合理单桌消费上限(¥5000)一律清零，交由 backfillRedemptionAmounts() 按
        // 匹配的真实POS订单金额兜底回填，而不是盲目采信客户端数值。
        if (eventType === 'coupon_redeemed') {
          const shortCode = String(metadata.short_code || '').trim();
          const looksLikeShortCodeAsAmount = /^[0-9]+$/.test(shortCode) && amountFen === Number(shortCode) * 100;
          if (looksLikeShortCodeAsAmount || amountFen > 500000) {
            console.warn(`[growth] coupon_redeemed amount_fen 异常(疑似核销码/金额混淆)，已清零待回填：raw=${amountFen} short_code=${shortCode}`);
            amountFen = 0;
          }
        }
        const occurredAt = parseOccurredAt(body.occurred_at);
        const idempotencyKey = cleanText(body.idempotency_key, 255) || null;

        if (campaignId) {
          await pool.query(
            `INSERT INTO growth_campaigns (campaign_id, channel, store_id, meta, tenant_id)
             VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4::jsonb, $5)
             ON CONFLICT (campaign_id, tenant_id) DO UPDATE SET
               channel = COALESCE(growth_campaigns.channel, EXCLUDED.channel),
               store_id = COALESCE(growth_campaigns.store_id, EXCLUDED.store_id),
               updated_at = NOW()`,
            [campaignId, channel, storeId, JSON.stringify({ first_event_type: eventType }), tenantId]
          );
        }

        const inserted = await pool.query(
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
            tenantId
          ]
        );

        if (eventType === 'coupon_redeemed' && inserted.rows.length) {
          // 幂等已经由上面 growth_events 的 idempotency_key + ON CONFLICT + inserted.rows.length
          // 门槛保证：只有真正插入了新 growth_events 行(即 idempotency_key 之前没出现过)才会走到
          // 这里。2张/1码券(coupon_count=2)小程序按 idempotency_key='coupon_redeemed:<券id>:<第几次>'
          // 区分两次合法核销(经核实同一券10秒内2条记录属于此类，非重复提交)。
          // 2026-07 曾在此加过"5分钟内同券码去重"，经排查是误判合法二次核销为重复提交，已撤销。
          await pool.query(
            `INSERT INTO growth_redemptions (customer_id, coupon_id, campaign_id, store_id, amount_fen, metadata, redeemed_at, tenant_id)
             VALUES ($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6::jsonb,$7,$8)
             ON CONFLICT DO NOTHING`,
            [customer?.id || null, cleanText(body.coupon_id, 128), campaignId, storeId, amountFen, JSON.stringify(metadata), occurredAt, tenantId]
          );
          // 闭环回写：按核销回传的短码，把对应「已发送」短信日志翻成「已核销」，
          // 使 growth_delivery_logs 单表即可查「发→核销」全过程（核销率 = redeemed / sent）。
          const redeemShortCode = cleanText(metadata.short_code || '', 64);
          if (redeemShortCode) {
            await pool.query(
              `UPDATE growth_delivery_logs
                  SET status = 'redeemed', updated_at = NOW()
                WHERE channel = 'sms'
                  AND status = 'sent'
                  AND payload->>'coupon_code' = $1`,
              [redeemShortCode]
            ).catch((e) => console.warn('[growth] delivery redeem flip failed:', e?.message));
          }
        }

        // Phase 2: 授权手机号/匹配检查时，反查 wechat_work_customers 并绑定
        const matchPhone = cleanPhone(body.phone);
        if ((eventType === 'phone_authorized' || eventType === 'wechat_match_check') && matchPhone) {
          try {
            const wwMatch = await pool.query(
              `UPDATE wechat_work_customers SET bind_customer_id = $1, updated_at = NOW()
               WHERE phone = $2 AND bind_customer_id IS NULL
               RETURNING id, store_id`,
              [customer?.id, matchPhone]
            );
            if (wwMatch.rows.length) {
              console.log(`[growth] wechat_work customer matched: phone=${matchPhone}, customer_id=${customer?.id}`);
            }
          } catch (e) {
            console.warn('[growth] wechat_work match failed:', e?.message);
          }
        }

        return { inserted: inserted.rows.length > 0, customer_id: customer?.id || null };
      });

      return res.json({ ok: true, inserted: result.inserted, customer_id: result.customer_id });
    } catch (e) {
      console.error('[growth] miniprogram event failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });


  app.post('/api/growth/metrics/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = await tenantContext.run(getGrowthTenantId(req), () => recomputeDailyMetrics(req.body?.days || 7));
    return res.json({ ok: true, days });
  });

  // 按手机号聚合 POS 消费，供小程序写回 users.total_spent 等字段。
  // 入参 { phones: ['1xx...'], window_days: 30 }；金额以「分」返回，与小程序 users.total_spent 单位一致。
  app.post('/api/growth/pos/consumption', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const body = req.body || {};
    const storeId = cleanText(body.store_id || req.headers['x-store-id'], 128);
    const tenantId = cleanText(body.tenant_id || req.headers['x-tenant-id'] || getGrowthTenantId(req), 128) || 'default';
    const binding = await verifyServerTenantBinding(pool, req, { tenantId, storeId });
    if (!binding.ok) return res.status(binding.status).json({ ok: false, error: binding.error });
    const windowDays = Math.min(Math.max(Number(body.window_days) || 30, 1), 365);
    let phones = Array.isArray(body.phones) ? body.phones : [];
    phones = phones.map((p) => cleanPhone(p)).filter(Boolean);
    phones = Array.from(new Set(phones));
    if (phones.length > 5000) phones = phones.slice(0, 5000);
    if (!phones.length) return res.json({ ok: true, window_days: windowDays, matched: 0, data: {} });

    const r = await pool.query(
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

    // 每个手机号最近一单的菜品/人数/金额（用于小程序"熟客到店"卡片展示）
    const lastOrderRes = await pool.query(
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
        dishes: row.last_order_dishes || ''
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
        last_order_amount_fen: lastOrder ? lastOrder.amount_fen : 0
      };
    }
    return res.json({ ok: true, window_days: windowDays, requested: phones.length, matched: r.rows.length, data });
  });

  app.get('/api/growth/metrics', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
    const r = await tenantContext.run(getGrowthTenantId(req), async () => {
      if (req.query.recompute === '1' || req.query.recompute === 'true') {
        await recomputeDailyMetrics(days);
      }
      return pool.query(
        `SELECT * FROM growth_daily_metrics
         WHERE metric_date >= CURRENT_DATE - ($1::int || ' days')::interval
           AND ($2::text = '' OR store_id = $2)
           AND ($3::text = '' OR campaign_id = $3)
         ORDER BY metric_date DESC, store_id, campaign_id, channel
         LIMIT 1000`,
        [days, cleanText(req.query.store_id || '', 128), cleanText(req.query.campaign_id || '', 128)]
      );
    });
    return res.json({ ok: true, rows: r.rows });
  });

  app.get('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || 'open', 40);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT * FROM growth_alerts WHERE ($1::text = '' OR status = $1) ORDER BY created_at DESC LIMIT 200`,
      [status]
    ));
    return res.json({ ok: true, alerts: r.rows });
  });

  app.post('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const alertKey = cleanText(b.alert_key || `${b.alert_type || 'growth'}:${b.store_id || ''}:${b.campaign_id || ''}:${new Date().toISOString().slice(0, 10)}`, 255);
    const alertsTenantId = getGrowthTenantId(req);
    const r = await tenantContext.run(alertsTenantId, () => pool.query(
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
      [alertKey, cleanText(b.alert_type, 80), cleanText(b.severity || 'medium', 40), cleanText(b.store_id, 128), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.message, 2000), cleanText(b.suggested_action, 2000), JSON.stringify(b.metrics || {}), alertsTenantId]
    ));
    return res.json({ ok: true, alert: r.rows[0] });
  });

  // 标记预警为已处理（关闭预警）
  app.post('/api/growth/alerts/:alertKey/resolve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const alertKey = cleanText(req.params.alertKey, 255);
    const operator = getGrowthOperator(req);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `UPDATE growth_alerts SET status = 'resolved', resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE alert_key = $1 RETURNING *`,
      [alertKey, operator.username || 'system']
    ));
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'alert_not_found' });
    return res.json({ ok: true, alert: r.rows[0] });
  });


  // ABC 6模板滚动分布：该活动当前命中人群中，各模板步骤(赠菜A/B/C+赠券30/50/2X50)×
  // 降频阶梯(0=正常频率,1+=第几轮降频)各有多少人、以及已进入「红名单」(阶梯走完未回应，
  // 本活动不再自动触达)的人数。campaign_key 未配置 ABC 轮换时返回 null。
  async function computeAbcDistributionForCampaign(pool, campaignKey, tenantId) {
    const order = ABC_ROTATION_ORDER[campaignKey];
    if (!order) return null;
    const ruleRes = await pool.query(
      `SELECT * FROM growth_touch_rules WHERE action_payload->>'campaign_key' = $1 LIMIT 1`,
      [campaignKey]
    );
    if (!ruleRes.rows.length) return null;
    const rule = ruleRes.rows[0];

    const candidates = (await loadRuleCandidates(pool, rule, tenantId)).slice(0, 500);
    const phones = [...new Set(candidates.map((c) => cleanPhone(c.phone)).filter(Boolean))];
    const sentCounts = phones.length ? await pool.query(
      // 「到店即清零」：与发送端同口径，只统计最近一次到店(pos_last_order_at)之后的成功发送数。
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
    ) : { rows: [] };
    const sentByPhone = new Map(sentCounts.rows.map((r) => [r.phone, Number(r.n)]));

    const dist = {};
    for (const step of order) dist[step] = 0;
    let cycling = 0; // 已走完至少一轮、进入更慢降频轮次(第2轮及以后)的人数
    let blacklisted = 0;
    for (const c of candidates) {
      const phone = cleanPhone(c.phone);
      if (!phone) continue;
      const totalSent = sentByPhone.get(phone) || 0;
      const { step, blacklisted: bl } = deriveAbcStep(campaignKey, totalSent);
      if (bl) { blacklisted++; continue; }
      dist[step] = (dist[step] || 0) + 1;
      if (totalSent >= order.length) cycling++; // 超过一轮(perCycle)即已进入降频后续轮次
    }
    return { rule_key: rule.rule_key, total: candidates.length, step_distribution: dist, cycling, blacklisted };
  }

  app.get('/api/growth/campaign/:campaignKey/abc-distribution', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaignKey = cleanText(req.params.campaignKey, 64);
    if (!ABC_ROTATION_ORDER[campaignKey]) return res.json({ ok: true, enabled: false });
    const result = await tenantContext.run(getGrowthTenantId(req), () =>
      computeAbcDistributionForCampaign(pool, campaignKey, getGrowthTenantId(req)));
    if (!result) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    return res.json({ ok: true, enabled: true, ...result });
  });

  // 红名单总览：汇总所有 ABC 滚动活动(段)已流入红名单(阶梯走完仍未回应，本活动不再自动触达)
  // 的人数，供决策"什么时候该对这批人另外出营销计划"。按 campaign_key 拆分+给总数。
  app.get('/api/growth/abc-blacklist-summary', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const tenantId = getGrowthTenantId(req);
    const campaignKeys = Object.keys(ABC_ROTATION_ORDER);
    const items = await tenantContext.run(tenantId, async () => {
      const out = [];
      for (const campaignKey of campaignKeys) {
        const r = await computeAbcDistributionForCampaign(pool, campaignKey, tenantId).catch(() => null);
        if (r) out.push({ campaign_key: campaignKey, rule_key: r.rule_key, total: r.total, blacklisted: r.blacklisted });
      }
      return out;
    });
    const totalBlacklisted = items.reduce((sum, it) => sum + it.blacklisted, 0);
    return res.json({ ok: true, items, total_blacklisted: totalBlacklisted });
  });
}
