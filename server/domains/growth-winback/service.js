/**
 * Winback + touch-rules business logic. Does not touch req/res.
 * DI via ctx: pool + injectable sms / growth-api helpers.
 */
import { resolveTenantIdDefault } from '../../utils/database.js';
import { cleanPhone, cleanText } from './helpers.js';

/**
 * @param {object} ctx
 * @param {object} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function sendWinbackSms(ctx, body = {}) {
  const {
    pool,
    sendAliyunSms,
    resolveTenantIdForStore,
    pickWinbackTemplateByStore,
    freqDaysEnv,
    globalSmsCapped,
    isPhoneSuppressed,
    upsertCustomer,
    upsertDeliveryLog,
    insertGrowthEvent,
    handleSmsFailure,
    tenantContext,
  } = ctx;

  const b = body && typeof body === 'object' ? body : {};
  const phone = cleanPhone(b.phone);
  const storeId = cleanText(b.store_id, 128);
  const code = cleanText(b.coupon_code || b.code, 64);
  const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
  const validUntil = cleanText(b.valid_until || b.date, 40);
  const campaignId = cleanText(b.campaign_id || b.scene, 128);
  const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `winback_sms:${code}` : '');
  const tenantId = await resolveTenantIdForStore(pool, storeId);

  if (!phone) return { status: 400, body: { ok: false, error: 'missing_phone' } };
  if (!code) return { status: 400, body: { ok: false, error: 'missing_coupon_code' } };
  if (valueYuan <= 0) return { status: 400, body: { ok: false, error: 'missing_value' } };
  if (!validUntil) return { status: 400, body: { ok: false, error: 'missing_valid_until' } };

  const templateCode = pickWinbackTemplateByStore(storeId);
  if (!templateCode) return { status: 503, body: { ok: false, error: 'winback_template_not_configured' } };

  return tenantContext.run(tenantId, async () => {
    if (idempotencyKey) {
      const dup = await pool.query(
        `SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`,
        [idempotencyKey]
      );
      if (dup.rows.length && dup.rows[0].status === 'sent') {
        return { status: 200, body: { ok: true, deduped: true } };
      }
    }
    const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
    if (freqDays > 0) {
      const recent = await pool.query(
        `SELECT 1 FROM growth_delivery_logs
          WHERE channel = 'sms' AND rule_key = 'winback_sms' AND status = 'sent'
            AND payload->>'phone' = $1 AND created_at > now() - ($2 || ' days')::interval
          LIMIT 1`,
        [phone, String(freqDays)]
      );
      if (recent.rows.length) {
        return {
          status: 200,
          body: { ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays },
        };
      }
    }
    const gCap = await globalSmsCapped(pool, phone, tenantId);
    if (gCap) {
      return {
        status: 200,
        body: { ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap },
      };
    }
    if (await isPhoneSuppressed(pool, phone, tenantId)) {
      return { status: 200, body: { ok: true, skipped: true, reason: 'suppressed' } };
    }
    const deliveryKey = idempotencyKey || `winback_sms:${phone}:${Date.now()}`;
    const templateParam = { value: String(valueYuan), date: validUntil, code };

    try {
      const sent = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
      const winbackCustomer = await upsertCustomer(pool, { phone, store_id: storeId }, tenantId).catch(() => null);
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
        customer_id: winbackCustomer?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
        provider_msg_id: sent.provider_msg_id, status: 'sent',
        payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
        result: sent.raw || {},
      }, tenantId);
      await insertGrowthEvent(pool, {
        event_type: 'marketing_triggered',
        customer_id: winbackCustomer?.id || null,
        phone,
        external_userid: null,
        store_id: storeId,
        campaign_id: campaignId,
        channel: 'sms',
        coupon_id: code,
        idempotency_key: `marketing_triggered:winback_sms:${code}`,
        metadata: {
          rule_key: 'winback_sms',
          delivery_key: deliveryKey,
          provider_msg_id: sent.provider_msg_id,
          short_code: code,
          coupon_value_fen: valueYuan * 100,
          template_code: templateCode,
        },
      }, tenantId);
      return { status: 200, body: { ok: true, provider_msg_id: sent.provider_msg_id } };
    } catch (deliveryErr) {
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
        customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
        payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
        result: {}, error_message: deliveryErr?.message || 'sms_send_failed',
      }, tenantId);
      await handleSmsFailure(pool, phone, deliveryErr?.message, tenantId);
      return { status: 502, body: { ok: false, error: deliveryErr?.message || 'sms_send_failed' } };
    }
  });
}

/**
 * @param {object} ctx
 * @param {{ store_id?: string, dormant_days?: *, min_balance_yuan?: *, freq_days?: *, tenantId: string }} opts
 */
export async function previewWinback(ctx, opts = {}) {
  const { pool, tenantContext } = ctx;
  const storeId = cleanText(opts.store_id, 128);
  const dormantDays = Math.max(1, Math.floor(Number(opts.dormant_days) || 14));
  const minBalanceFen = Math.max(0, Math.floor((Number(opts.min_balance_yuan) || 1) * 100));
  const freqDays = Math.max(
    0,
    Math.floor(
      Number(
        opts.freq_days != null
          ? opts.freq_days
          : process.env.ALIYUN_SMS_WINBACK_FREQUENCY_DAYS || 30
      )
    )
  );
  const params = [String(freqDays)];
  const clauses = [
    "m.phone IS NOT NULL AND m.phone <> ''",
    `m.balance_fen >= ${minBalanceFen}`,
    `(m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))`,
  ];
  if (storeId) {
    params.push(storeId);
    clauses.push(`m.store_id = $${params.length}`);
  }
  const r = await tenantContext.run(opts.tenantId, () =>
    pool.query(
      `SELECT m.card_no, m.member_name, m.phone, m.balance_fen, m.last_consume_date,
              (NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
                 WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
                   AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)) AS sendable
         FROM growth_stored_value_members m
        WHERE ${clauses.join(' AND ')}
        ORDER BY m.balance_fen DESC LIMIT 5000`,
      params
    )
  );
  const matchCount = r.rows.length;
  const sendable = r.rows.filter((x) => x.sendable);
  const sample = sendable.slice(0, 10).map((x) => ({
    phone: x.phone ? String(x.phone).slice(0, 3) + '****' + String(x.phone).slice(-4) : '',
    balance_yuan: Math.round((x.balance_fen || 0) / 100),
    last_consume_date: x.last_consume_date,
  }));
  return {
    status: 200,
    body: {
      ok: true,
      dry_run: true,
      match_count: matchCount,
      capped_count: matchCount - sendable.length,
      sendable_count: sendable.length,
      frequency_days: freqDays,
      sample,
    },
  };
}

/**
 * @param {object} ctx
 * @param {object} body
 * @param {string} tenantId
 */
export async function launchWinback(ctx, body = {}, tenantId) {
  const { pool, tenantContext, freqDaysEnv } = ctx;
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
  const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
  const dormantDays = Math.max(1, Math.floor(Number(b.dormant_days) || 14));
  const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
  const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
  const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  if (valueYuan <= 0) return { status: 400, body: { ok: false, error: 'missing_value' } };

  const launchResult = await tenantContext.run(tenantId, async () => {
    const r = await pool.query(
      `SELECT card_no, member_name, phone FROM growth_stored_value_members m
        WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.store_id = $2 AND m.balance_fen >= $3
          AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))
          AND NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
            WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
              AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)
        ORDER BY m.balance_fen DESC LIMIT ${maxTargets}`,
      [String(freqDays), storeId, minBalanceFen]
    );
    const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no }));
    if (!targets.length) {
      return { job_id: null, target_count: 0, message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)' };
    }
    const campaignId = cleanText(b.campaign_id, 128) || ('winback_' + storeId + '_' + Date.now());
    const ins = await pool.query(
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$10) RETURNING id`,
      [
        campaignId,
        storeId,
        valueYuan,
        validDays,
        dormantDays,
        minBalanceFen,
        JSON.stringify(targets),
        targets.length,
        cleanText(b.operator, 128) || 'hrms_admin',
        resolveTenantIdDefault(),
      ]
    );
    return { job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length };
  });
  return { status: 200, body: { ok: true, ...launchResult } };
}

/**
 * @param {object} ctx
 * @param {string} tenantId
 */
export async function listPendingJobs(ctx, tenantId) {
  const { pool, tenantContext, inSmsQuietHours } = ctx;
  if (inSmsQuietHours()) {
    return { status: 200, body: { ok: true, job: null, quiet_hours: true } };
  }
  await tenantContext.run(tenantId, () =>
    pool.query(
      `UPDATE growth_campaign_jobs SET status='failed', updated_at=now(),
         result = result || '{"error":"auto_failed_stuck_after_retries"}'::jsonb
        WHERE kind <> 'stored_value_remind' AND status='running'
          AND updated_at < now() - interval '3 minutes' AND retry_count >= 3`
    )
  );
  const r = await tenantContext.run(tenantId, () =>
    pool.query(
      `UPDATE growth_campaign_jobs SET status='running', updated_at=now(),
         retry_count = CASE WHEN status = 'running' THEN retry_count + 1 ELSE retry_count END
        WHERE id = (SELECT id FROM growth_campaign_jobs
                     WHERE kind <> 'stored_value_remind'
                       AND (status='pending' OR status='partial' OR (status='running' AND updated_at < now() - interval '3 minutes'))
                     ORDER BY created_at ASC LIMIT 1)
        RETURNING id, campaign_id, store_id, kind, value_yuan, valid_days, targets, result`
    )
  );
  return { status: 200, body: { ok: true, job: r.rows[0] || null } };
}

/**
 * @param {object} ctx
 * @param {object} body
 * @param {string} tenantId
 */
export async function reportJobResult(ctx, body = {}, tenantId) {
  const { pool, tenantContext } = ctx;
  const b = body || {};
  const jobId = Math.floor(Number(b.job_id) || 0);
  if (!jobId) return { status: 400, body: { ok: false, error: 'missing_job_id' } };
  const sentN = Math.max(0, Math.floor(Number(b.sent) || 0));
  const failedN = Math.max(0, Math.floor(Number(b.failed) || 0));
  const miniStatus = cleanText(b.status || '', 20);
  const computedStatus =
    miniStatus === 'done'
      ? 'done'
      : miniStatus === 'pending'
        ? 'pending'
        : sentN === 0 && failedN > 0
          ? 'failed'
          : sentN > 0 && failedN > 0
            ? 'partial'
            : 'done';
  await tenantContext.run(tenantId, () =>
    pool.query(
      `UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status=$4, result=$5::jsonb, updated_at=now() WHERE id=$1`,
      [jobId, sentN, failedN, computedStatus, JSON.stringify(b.result || {})]
    )
  );
  return { status: 200, body: { ok: true } };
}

/**
 * @param {object} ctx
 * @param {{ limit?: *, tenantId: string }} opts
 */
export async function listJobs(ctx, opts = {}) {
  const { pool, tenantContext } = ctx;
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const r = await tenantContext.run(opts.tenantId, () =>
    pool.query(
      `SELECT id, campaign_id, store_id, kind, value_yuan, valid_days, dormant_days, total, sent, failed, status, created_by, created_at, updated_at
         FROM growth_campaign_jobs ORDER BY created_at DESC LIMIT ${limit}`
    )
  );
  return { status: 200, body: { ok: true, jobs: r.rows } };
}

/**
 * @param {object} ctx
 * @param {string} tenantId
 */
export async function listTouchRules(ctx, tenantId) {
  const { pool, tenantContext } = ctx;
  const r = await tenantContext.run(tenantId, () =>
    pool.query(`SELECT * FROM growth_touch_rules ORDER BY priority ASC, rule_key ASC LIMIT 100`)
  );
  return { status: 200, body: { ok: true, rules: r.rows } };
}

/**
 * @param {object} ctx
 * @param {object} body
 * @param {string} tenantId
 */
export async function upsertTouchRule(ctx, body = {}, tenantId) {
  const { pool, tenantContext } = ctx;
  const b = body || {};
  const ruleKey = cleanText(b.rule_key, 128);
  if (!ruleKey) return { status: 400, body: { ok: false, error: 'missing_rule_key' } };
  const criteriaStr = JSON.stringify(b.criteria || {});
  const payloadStr = JSON.stringify(b.action_payload || {});
  const actionType = cleanText(b.action_type || 'send_message', 80);
  const { r, criteriaChanged } = await tenantContext.run(tenantId, async () => {
    const existing = await pool.query(
      `SELECT criteria, action_payload, action_type FROM growth_touch_rules WHERE rule_key = $1 LIMIT 1`,
      [ruleKey]
    );
    let keepApproval = false;
    let criteriaChangedInner = true;
    if (existing.rows.length) {
      const ex = existing.rows[0];
      criteriaChangedInner = JSON.stringify(ex.criteria || {}) !== criteriaStr;
      keepApproval =
        !criteriaChangedInner &&
        JSON.stringify(ex.action_payload || {}) === payloadStr &&
        (ex.action_type || '') === actionType;
    }
    const rRes = await pool.query(
      `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload, owner, note, tenant_id)
       VALUES ($1,$2,COALESCE($3,TRUE),$4,COALESCE($5,TRUE),$6::jsonb,$7,$8::jsonb,NULLIF($9,''),NULLIF($10,''),$12)
       ON CONFLICT (rule_key, tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         enabled = EXCLUDED.enabled,
         priority = EXCLUDED.priority,
         auto_execute = EXCLUDED.auto_execute,
         criteria = EXCLUDED.criteria,
         action_type = EXCLUDED.action_type,
         action_payload = EXCLUDED.action_payload,
         owner = COALESCE(EXCLUDED.owner, growth_touch_rules.owner),
         note = COALESCE(EXCLUDED.note, growth_touch_rules.note),
         approved_by = CASE WHEN $11 THEN growth_touch_rules.approved_by ELSE NULL END,
         approved_at = CASE WHEN $11 THEN growth_touch_rules.approved_at ELSE NULL END,
         updated_at = NOW()
       RETURNING *`,
      [
        ruleKey,
        cleanText(b.name || ruleKey, 255),
        b.enabled !== false,
        Math.max(1, Math.floor(Number(b.priority) || 100)),
        b.auto_execute !== false,
        criteriaStr,
        actionType,
        payloadStr,
        cleanText(b.owner || '', 128),
        cleanText(b.note || '', 1000),
        keepApproval,
        tenantId,
      ]
    );
    return { r: rRes, criteriaChanged: criteriaChangedInner };
  });
  if (criteriaChanged && typeof globalThis.__refreshGrowthAudience === 'function') {
    globalThis.__refreshGrowthAudience();
  }
  return { status: 200, body: { ok: true, rule: r.rows[0] } };
}

/**
 * @param {object} ctx
 * @param {{ ruleKey: string, operatorUsername?: string, owner?: string, tenantId: string }} opts
 */
export async function approveTouchRule(ctx, opts = {}) {
  const { pool, tenantContext } = ctx;
  const ruleKey = cleanText(opts.ruleKey, 128);
  const owner = cleanText(opts.owner || '', 128);
  const r = await tenantContext.run(opts.tenantId, () =>
    pool.query(
      `UPDATE growth_touch_rules
         SET approved_by = $2, approved_at = NOW(),
             owner = COALESCE(NULLIF($3,''), owner),
             updated_at = NOW()
       WHERE rule_key = $1
       RETURNING *`,
      [ruleKey, opts.operatorUsername || 'system', owner]
    )
  );
  if (!r.rows.length) return { status: 404, body: { ok: false, error: 'rule_not_found' } };
  return { status: 200, body: { ok: true, rule: r.rows[0] } };
}

/**
 * @param {object} ctx
 * @param {{ ruleKey: string, tenantId: string }} opts
 */
export async function unapproveTouchRule(ctx, opts = {}) {
  const { pool, tenantContext } = ctx;
  const ruleKey = cleanText(opts.ruleKey, 128);
  const r = await tenantContext.run(opts.tenantId, () =>
    pool.query(
      `UPDATE growth_touch_rules SET approved_by = NULL, approved_at = NULL, updated_at = NOW() WHERE rule_key = $1 RETURNING *`,
      [ruleKey]
    )
  );
  if (!r.rows.length) return { status: 404, body: { ok: false, error: 'rule_not_found' } };
  return { status: 200, body: { ok: true, rule: r.rows[0] } };
}

/**
 * @param {object} ctx
 * @param {{ days?: *, tenantId: string }} opts
 */
export async function touchRulesStats(ctx, opts = {}) {
  const { pool, tenantContext, CAMPAIGN_TYPES } = ctx;
  const rawDays = String(opts.days ?? '0').trim().toLowerCase();
  const days =
    rawDays === '0' || rawDays === 'all' || rawDays === 'lifetime'
      ? 0
      : Math.min(Math.max(Number(opts.days) || 0, 1), 365);
  const r = await tenantContext.run(opts.tenantId, () =>
    pool.query(
      `WITH sent AS (
         SELECT rule_key AS akey,
                COUNT(*)::int AS sent_count,
                COUNT(*) FILTER (WHERE channel = 'sms')::int AS sms_sent_count
         FROM growth_delivery_logs
         WHERE status IN ('sent','delivered','read','clicked','redeemed')
           AND ($1::int <= 0 OR created_at >= NOW() - ($1::int || ' days')::interval)
         GROUP BY rule_key
       ),
       redeemed AS (
         SELECT COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) AS akey,
                COUNT(*)::int AS redeemed_count,
                COALESCE(SUM(amount_fen), 0)::bigint AS revenue_fen
         FROM growth_events
         WHERE event_type = 'coupon_redeemed'
           AND ($1::int <= 0 OR created_at >= NOW() - ($1::int || ' days')::interval)
           AND COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) IS NOT NULL
         GROUP BY 1
       )
       SELECT tr.rule_key,
              tr.action_payload->>'campaign_key' AS campaign_key,
              COALESCE(s.sent_count, 0) AS sent_count,
              COALESCE(s.sms_sent_count, 0) AS sms_sent_count,
              COALESCE(rd.redeemed_count, 0) AS redeemed_count,
              COALESCE(rd.revenue_fen, 0) AS revenue_fen
       FROM growth_touch_rules tr
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(s.sent_count), 0)::int AS sent_count,
                COALESCE(SUM(s.sms_sent_count), 0)::int AS sms_sent_count
         FROM sent s
         WHERE s.akey = tr.rule_key
            OR s.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(rd.redeemed_count), 0)::int AS redeemed_count,
                COALESCE(SUM(rd.revenue_fen), 0)::bigint AS revenue_fen
         FROM redeemed rd
         WHERE rd.akey = tr.rule_key
            OR rd.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)
       ) rd ON true`,
      [days]
    )
  );
  const SMS_COST_FEN = 5;
  const stats = r.rows.map((row) => {
    const sent = Number(row.sent_count) || 0;
    const smsSent = Number(row.sms_sent_count) || 0;
    const redeemed = Number(row.redeemed_count) || 0;
    const revenueFen = Number(row.revenue_fen) || 0;
    const costFen = smsSent * SMS_COST_FEN;
    const redeemRate = sent > 0 ? redeemed / sent : null;
    const roi = costFen > 0 ? revenueFen / costFen : null;
    const revenueMissing = redeemed > 0 && revenueFen === 0;

    let score = null;
    if (sent > 0) {
      const rateScore = Math.min(100, Math.round((redeemRate || 0) * 100 * 5));
      if (costFen > 0) {
        const roiScore = Math.min(100, Math.round(((roi || 0) / 5) * 100));
        score = Math.round(rateScore * 0.6 + roiScore * 0.4);
      } else {
        score = rateScore;
      }
    }

    let suggestion;
    if (sent === 0) {
      suggestion = '尚未发送，审核启用后可观察效果';
    } else if (redeemed === 0) {
      suggestion = '已发送但暂无核销，建议优化文案/券面额或更换目标人群';
    } else if (redeemRate < 0.05) {
      suggestion = '核销率偏低（<5%），建议收窄人群定向或提高券吸引力';
    } else if (redeemRate >= 0.15) {
      suggestion = '核销率优秀，建议保持并可适度加大投放';
    } else {
      suggestion = '核销率中等，可小幅优化文案或做面额 A/B 测试';
    }
    if (costFen > 0 && revenueFen > 0) {
      if (roi >= 3) suggestion += '；ROI 高，投入产出优';
      else if (roi < 1) suggestion += '；ROI<1 尚未回本，注意控制成本';
    }
    if (revenueMissing) {
      suggestion += '；注：本期实收金额未录入，ROI 暂按 0 计，建议核销时录入实收金额以精确核算';
    }

    const cfg = CAMPAIGN_TYPES[row.campaign_key];
    const couponKind = cfg
      ? Array.isArray(cfg.vars) && cfg.vars.includes('value')
        ? 'cash'
        : 'gift'
      : 'unknown';
    return Object.assign({}, row, {
      sent_count: sent,
      sms_sent_count: smsSent,
      redeemed_count: redeemed,
      revenue_fen: revenueFen,
      cost_fen: costFen,
      roi: roi == null ? null : Math.round(roi * 100) / 100,
      coupon_kind: couponKind,
      score,
      suggestion,
    });
  });
  const byKind = {};
  for (const s of stats) {
    const k = s.coupon_kind;
    if (k !== 'cash' && k !== 'gift') continue;
    const bucket = byKind[k] || (byKind[k] = { sent: 0, redeemed: 0 });
    bucket.sent += s.sent_count;
    bucket.redeemed += s.redeemed_count;
  }
  for (const k of Object.keys(byKind)) {
    byKind[k].redeem_rate =
      byKind[k].sent > 0
        ? Math.round((byKind[k].redeemed / byKind[k].sent) * 10000) / 100
        : null;
  }
  return {
    status: 200,
    body: { ok: true, days, cumulative: days <= 0, stats, coupon_kind_summary: byKind },
  };
}

/**
 * @param {object} ctx
 * @param {{ store_id?: string, refresh?: string|boolean, tenantId: string }} opts
 */
export async function touchRulesAudience(ctx, opts = {}) {
  const { getTouchRulesAudience } = ctx;
  const storeId = cleanText(opts.store_id || '', 128);
  const forceRefresh = String(opts.refresh || '') === '1';
  try {
    const result = await getTouchRulesAudience(opts.tenantId, storeId, forceRefresh);
    return { status: 200, body: { ok: true, ...result, store_id: storeId || null } };
  } catch (e) {
    return { status: 500, body: { ok: false, error: e?.message || 'audience_failed' } };
  }
}
