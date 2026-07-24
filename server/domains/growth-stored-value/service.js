/**
 * Stored-value sync + campaign launch/SMS — pure logic (no req/res).
 */
import {
  cleanText,
  cleanPhone,
  maskPhone,
  parseCampaignCriteria,
  aggregateStoredValueMembers,
} from './helpers.js';

export async function syncStoredValueMembers(ctx, tenantId) {
  const records = await ctx.readStoredValueBitableRecords();
  const byCard = aggregateStoredValueMembers(records, {
    bitText: ctx.bitText,
    bitNum: ctx.bitNum,
    bitDateMs: ctx.bitDateMs,
    bitPhone: ctx.bitPhone,
    mapStoreNameToId: ctx.mapStoreNameToId,
  });
  const upserted = await ctx.tenantContext.run(tenantId, async () => {
    let upsertedCount = 0;
    for (const m of byCard.values()) {
      await ctx.pool.query(
        `INSERT INTO growth_stored_value_members
               (card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date, last_recharge_date, updated_at, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10)
             ON CONFLICT (card_no, tenant_id) DO UPDATE SET
               member_name=EXCLUDED.member_name, phone=EXCLUDED.phone, level=EXCLUDED.level,
               tags=EXCLUDED.tags, store_id=EXCLUDED.store_id, balance_fen=EXCLUDED.balance_fen,
               last_consume_date=EXCLUDED.last_consume_date, last_recharge_date=EXCLUDED.last_recharge_date, updated_at=NOW()`,
        [
          m.card,
          m.member_name || null,
          m.phone || null,
          m.level || null,
          m.tags || null,
          m.store_id || null,
          m.balance_fen || 0,
          m.consumeMs > 0 ? new Date(m.consumeMs) : null,
          m.rechargeMs > 0 ? new Date(m.rechargeMs) : null,
          ctx.resolveTenantIdDefault(),
        ]
      );
      upsertedCount++;
    }
    return upsertedCount;
  });
  return {
    status: 200,
    body: { ok: true, records: records.length, members: byCard.size, upserted },
  };
}

export async function listStoredValueTargets(ctx, tenantId, query) {
  const storeId = cleanText(query.store_id, 128);
  const dormantDays = Math.max(1, Math.floor(Number(query.dormant_days) || 14));
  const minBalanceFen = Math.max(0, Math.floor((Number(query.min_balance_yuan) || 1) * 100));
  const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
  const params = [];
  const clauses = [
    "phone IS NOT NULL AND phone <> ''",
    `balance_fen >= ${minBalanceFen}`,
    `(last_consume_date IS NULL OR last_consume_date <= (CURRENT_DATE - ${dormantDays}))`,
  ];
  if (storeId) {
    params.push(storeId);
    clauses.push(`store_id = $${params.length}`);
  }
  params.push(limit);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date
           FROM growth_stored_value_members
          WHERE ${clauses.join(' AND ')}
          ORDER BY balance_fen DESC LIMIT $${params.length}`,
      params
    )
  );
  return { status: 200, body: { ok: true, count: r.rows.length, targets: r.rows } };
}

export async function previewCampaign(ctx, tenantId, body) {
  const b = body && typeof body === 'object' ? body : {};
  const campaignKey = cleanText(b.campaign_key, 64);
  if (!ctx.CAMPAIGN_TYPES[campaignKey]) {
    return { status: 400, body: { ok: false, error: 'unknown_campaign_key' } };
  }
  const c = parseCampaignCriteria(b);
  const freqDays = Math.max(
    0,
    Math.floor(
      Number(
        b.freq_days != null ? b.freq_days : process.env.ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS || 30
      )
    )
  );
  const q = ctx.buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: 5000 });
  if (!q) return { status: 400, body: { ok: false, error: 'need_audience_filter' } };
  const r = await ctx.tenantContext.run(tenantId, () => ctx.pool.query(q.sql, q.params));
  const sendable = r.rows.filter((x) => x.sendable);
  const sample = sendable.slice(0, 10).map((x) => ({
    phone: maskPhone(x.phone),
    name: x.name || '',
    visits: x.visits,
    days: x.days,
  }));
  return {
    status: 200,
    body: {
      ok: true,
      dry_run: true,
      match_count: r.rows.length,
      capped_count: r.rows.length - sendable.length,
      sendable_count: sendable.length,
      coupon_count: ctx.CAMPAIGN_TYPES[campaignKey].coupon_count,
      frequency_days: freqDays,
      sample,
    },
  };
}

export async function launchCampaign(ctx, tenantId, body) {
  const b = body && typeof body === 'object' ? body : {};
  const campaignKey = cleanText(b.campaign_key, 64);
  const cfg = ctx.CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return { status: 400, body: { ok: false, error: 'unknown_campaign_key' } };
  const c = parseCampaignCriteria(b);
  if (!c.storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
  const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
  if (valueYuan <= 0) return { status: 400, body: { ok: false, error: 'missing_value' } };
  const launchAbcOrder = ctx.ABC_ROTATION_ORDER[campaignKey];
  const launchTplOk = launchAbcOrder
    ? !!ctx.pickAbcTemplate(launchAbcOrder[0], c.storeId)
    : !!ctx.pickCampaignTemplate(campaignKey, c.storeId);
  if (!launchTplOk) {
    return { status: 503, body: { ok: false, error: 'sms_template_not_configured' } };
  }
  const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
  const freqDays = ctx.freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
  const q = ctx.buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: maxTargets });
  if (!q) return { status: 400, body: { ok: false, error: 'need_audience_filter' } };
  const launchResult = await ctx.tenantContext.run(tenantId, async () => {
    const r = await ctx.pool.query(q.sql, q.params);
    const targets = r.rows.filter((x) => x.sendable).map((x) => ({ phone: x.phone, name: x.name || '' }));
    if (!targets.length) {
      return { job_id: null, target_count: 0, message: '没有符合条件的对象(人群/频控筛选后为空)' };
    }
    const campaignId =
      cleanText(b.campaign_id, 128) || campaignKey + '_' + c.storeId + '_' + Date.now();
    const result = { campaign_key: campaignKey, coupon_count: cfg.coupon_count };
    const ins = await ctx.pool.query(
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
           VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb,$10) RETURNING id`,
      [
        campaignId,
        c.storeId,
        valueYuan,
        validDays,
        JSON.stringify(targets),
        targets.length,
        campaignKey,
        cleanText(b.operator, 128) || 'hrms_admin',
        JSON.stringify(result),
        ctx.resolveTenantIdDefault(),
      ]
    );
    return {
      job_id: ins.rows[0].id,
      campaign_id: campaignId,
      target_count: targets.length,
      coupon_count: cfg.coupon_count,
    };
  });
  return { status: 200, body: { ok: true, ...launchResult } };
}

export async function sendCampaignSms(ctx, body) {
  const b = body && typeof body === 'object' ? body : {};
  const campaignKey = cleanText(b.campaign_key, 64);
  const cfg = ctx.CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return { status: 400, body: { ok: false, error: 'unknown_campaign_key' } };
  const phone = cleanPhone(b.phone);
  const storeId = cleanText(b.store_id, 128);
  const code = cleanText(b.coupon_code || b.code, 64);
  const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
  const validUntil = cleanText(b.valid_until || b.date, 40) || ctx.formatSmsValidDate(b.valid_days);
  const campaignId = cleanText(b.campaign_id || b.scene, 128);
  const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `${campaignKey}:${code}` : '');
  const tenantId = await ctx.resolveTenantIdForStore(ctx.pool, storeId);

  if (!phone) return { status: 400, body: { ok: false, error: 'missing_phone' } };

  return ctx.tenantContext.run(tenantId, async () => {
    const abcOrder = ctx.ABC_ROTATION_ORDER[campaignKey];
    let effectiveVars = cfg.vars;
    let templateCode;
    let abcFreqDaysOverride = null;
    let abcStep = null;
    if (abcOrder) {
      const totalSent = await ctx.countCampaignSent(ctx.pool, campaignKey, phone, tenantId);
      const derived = ctx.deriveAbcStep(campaignKey, totalSent);
      if (derived.blacklisted) {
        return { status: 200, body: { ok: true, skipped: true, reason: 'abc_blacklisted' } };
      }
      abcStep = derived.step;
      abcFreqDaysOverride = derived.freqDaysOverride;
      effectiveVars = ctx.ABC_STEP_DEFS[abcStep].vars;
      templateCode = ctx.pickAbcTemplate(abcStep, storeId);
    } else {
      templateCode = ctx.pickCampaignTemplate(campaignKey, storeId);
    }
    if (effectiveVars.includes('code') && !code) {
      return { status: 400, body: { ok: false, error: 'missing_coupon_code' } };
    }
    if (effectiveVars.includes('value') && valueYuan <= 0) {
      return { status: 400, body: { ok: false, error: 'missing_value' } };
    }
    if (!templateCode) {
      return { status: 503, body: { ok: false, error: 'sms_template_not_configured' } };
    }

    if (idempotencyKey) {
      const dup = await ctx.pool.query(
        `SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`,
        [idempotencyKey]
      );
      if (dup.rows.length && dup.rows[0].status === 'sent') {
        return { status: 200, body: { ok: true, deduped: true } };
      }
    }

    const freqDays =
      abcFreqDaysOverride != null
        ? abcFreqDaysOverride
        : ctx.freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
    if (freqDays > 0) {
      const recent = await ctx.pool.query(
        `SELECT 1 FROM growth_delivery_logs
            WHERE channel = 'sms' AND rule_key = $1 AND status = 'sent'
              AND payload->>'phone' = $2 AND created_at > now() - ($3 || ' days')::interval
            LIMIT 1`,
        [campaignKey, phone, String(freqDays)]
      );
      if (recent.rows.length) {
        return {
          status: 200,
          body: { ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays },
        };
      }
    }

    const gCap = await ctx.globalSmsCapped(ctx.pool, phone, tenantId);
    if (gCap) {
      return {
        status: 200,
        body: { ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap },
      };
    }
    if (await ctx.isPhoneSuppressed(ctx.pool, phone, tenantId)) {
      return { status: 200, body: { ok: true, skipped: true, reason: 'suppressed' } };
    }
    if (await ctx.marketingFatigueCapped(ctx.pool, phone, tenantId)) {
      return { status: 200, body: { ok: true, skipped: true, reason: 'marketing_fatigue' } };
    }
    if (!abcOrder && (await ctx.campaignTouchCapped(ctx.pool, campaignKey, phone, tenantId))) {
      return { status: 200, body: { ok: true, skipped: true, reason: 'touch_capped' } };
    }

    const deliveryKey = idempotencyKey || `${campaignKey}:${phone}:${Date.now()}`;
    const templateParam = {};
    if (effectiveVars.includes('value')) templateParam.value = String(valueYuan);
    if (effectiveVars.includes('date')) templateParam.date = validUntil;
    if (effectiveVars.includes('code')) templateParam.code = code;

    try {
      const sent = await ctx.sendAliyunSms({
        phoneNumbers: phone,
        templateCode,
        templateParam,
        signName: ctx.pickCampaignSmsSign(storeId),
      });
      const camCustomer = await ctx
        .upsertCustomer(ctx.pool, { phone, store_id: storeId }, tenantId)
        .catch(() => null);
      await ctx.upsertDeliveryLog(
        ctx.pool,
        {
          delivery_key: deliveryKey,
          action_key: campaignId || campaignKey,
          rule_key: campaignKey,
          customer_id: camCustomer?.id || null,
          store_id: storeId,
          channel: 'sms',
          external_userid: '',
          provider_msg_id: sent.provider_msg_id,
          status: 'sent',
          payload: {
            phone,
            template_param: templateParam,
            coupon_code: code,
            campaign_id: campaignId,
            campaign_key: campaignKey,
          },
          result: sent.raw || {},
        },
        tenantId
      );
      await ctx.insertGrowthEvent(
        ctx.pool,
        {
          event_type: 'marketing_triggered',
          customer_id: camCustomer?.id || null,
          phone,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'sms',
          coupon_id: code,
          idempotency_key: `marketing_triggered:${campaignKey}:${code || phone}`,
          metadata: {
            rule_key: campaignKey,
            delivery_key: deliveryKey,
            provider_msg_id: sent.provider_msg_id,
            short_code: code,
            coupon_value_fen: valueYuan * 100,
            template_code: templateCode,
          },
        },
        tenantId
      );
      return { status: 200, body: { ok: true, provider_msg_id: sent.provider_msg_id } };
    } catch (deliveryErr) {
      await ctx.upsertDeliveryLog(
        ctx.pool,
        {
          delivery_key: deliveryKey,
          action_key: campaignId || campaignKey,
          rule_key: campaignKey,
          customer_id: null,
          store_id: storeId,
          channel: 'sms',
          external_userid: '',
          status: 'failed',
          payload: {
            phone,
            template_param: templateParam,
            coupon_code: code,
            campaign_id: campaignId,
            campaign_key: campaignKey,
          },
          result: {},
          error_message: deliveryErr?.message || 'sms_send_failed',
        },
        tenantId
      );
      await ctx.handleSmsFailure(ctx.pool, phone, deliveryErr?.message, tenantId);
      return { status: 502, body: { ok: false, error: deliveryErr?.message || 'sms_send_failed' } };
    }
  });
}

export async function previewRemind(ctx, tenantId, body) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
  const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
  const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
  const freqDays = ctx.freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  const q = ctx.buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
  const r = await ctx.tenantContext.run(tenantId, () => ctx.pool.query(q.sql, q.params));
  return {
    status: 200,
    body: {
      ok: true,
      target_count: r.rows.length,
      sample: r.rows.slice(0, 5).map((x) => ({
        name: x.member_name || '',
        balance_yuan: Math.round((x.balance_fen || 0) / 100),
      })),
    },
  };
}

export async function launchRemind(ctx, tenantId, body) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
  const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
  const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
  const freqDays = ctx.freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
  const templateCode =
    cleanText(b.sms_template_code, 64) || ctx.pickBalanceTemplateByStore(storeId);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  if (!templateCode) {
    return { status: 503, body: { ok: false, error: 'balance_template_not_configured' } };
  }
  const q = ctx.buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
  const launchResult = await ctx.tenantContext.run(tenantId, async () => {
    const r = await ctx.pool.query(q.sql, q.params);
    const targets = r.rows.map((x) => ({
      phone: x.phone,
      name: x.member_name || '',
      card_no: x.card_no,
      balance_yuan: Math.round((x.balance_fen || 0) / 100),
    }));
    if (!targets.length) {
      return {
        job_id: null,
        target_count: 0,
        message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)',
      };
    }
    const campaignId =
      cleanText(b.campaign_id, 128) || 'svremind_' + storeId + '_' + Date.now();
    const ins = await ctx.pool.query(
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
           VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb,$9) RETURNING id`,
      [
        campaignId,
        storeId,
        dormantDays,
        minBalanceFen,
        JSON.stringify(targets),
        targets.length,
        cleanText(b.operator, 128) || 'hrms_admin',
        JSON.stringify({ template_code: templateCode }),
        ctx.resolveTenantIdDefault(),
      ]
    );
    return { job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length };
  });
  return { status: 200, body: { ok: true, ...launchResult } };
}

export async function campaignFunnel(ctx, tenantId, campaignIdRaw) {
  const campaignId = cleanText(campaignIdRaw, 128);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM growth_events
       WHERE campaign_id = $1
       GROUP BY event_type
       ORDER BY event_type`,
      [campaignId]
    )
  );
  return { status: 200, body: { ok: true, campaign_id: campaignId, counts: r.rows } };
}
