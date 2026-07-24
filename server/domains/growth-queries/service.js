/**
 * Growth read queries + feishu callback + semantic parse/writeback.
 */
import {
  cleanText,
  clampLimit,
  clampOffset,
  parseSemanticFallback,
  buildWhere,
} from './helpers.js';

export async function listCustomers(ctx, tenantId, query) {
  const phone = cleanText(query.phone || '', 32);
  const openid = cleanText(query.openid || '', 128);
  const store_id = cleanText(query.store_id || '', 128);
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const { where, params, nextIdx } = buildWhere([
    ['phone', phone],
    ['openid', openid],
    ['(first_store_id = $N OR last_store_id = $N)', store_id],
  ]);
  let idx = nextIdx;
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT id, phone, openid, external_userid, first_store_id, last_store_id, first_seen_at, last_seen_at, meta, created_at FROM growth_customers ${where} ORDER BY last_seen_at DESC NULLS LAST LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    )
  );
  return { status: 200, body: { ok: true, customers: r.rows } };
}

export async function listEvents(ctx, tenantId, query) {
  const event_type = cleanText(query.event_type || '', 80);
  const store_id = cleanText(query.store_id || '', 128);
  const campaign_id = cleanText(query.campaign_id || '', 128);
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const { where, params, nextIdx } = buildWhere([
    ['event_type', event_type],
    ['store_id', store_id],
    ['campaign_id', campaign_id],
  ]);
  let idx = nextIdx;
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT id, event_type, customer_id, phone, openid, store_id, campaign_id, channel, coupon_id, order_id, amount_fen, occurred_at FROM growth_events ${where} ORDER BY occurred_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    )
  );
  return { status: 200, body: { ok: true, events: r.rows } };
}

export async function listCampaigns(ctx, tenantId, query) {
  const store_id = cleanText(query.store_id || '', 128);
  const status = cleanText(query.status || '', 40);
  const { where, params } = buildWhere([
    ['store_id', store_id],
    ['status', status],
  ]);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(`SELECT * FROM growth_campaigns ${where} ORDER BY created_at DESC`, params)
  );
  return { status: 200, body: { ok: true, campaigns: r.rows } };
}

export async function listRedemptions(ctx, tenantId, query) {
  const campaign_id = cleanText(query.campaign_id || '', 128);
  const store_id = cleanText(query.store_id || '', 128);
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const { where, params, nextIdx } = buildWhere([
    ['r.campaign_id', campaign_id],
    ['r.store_id', store_id],
  ]);
  let idx = nextIdx;
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT r.id, r.customer_id, r.coupon_id, r.campaign_id, r.store_id, r.amount_fen, r.redeemed_at, r.metadata,
              c.name AS campaign_name
       FROM growth_redemptions r
       LEFT JOIN growth_campaigns c ON c.campaign_id = r.campaign_id
       ${where} ORDER BY r.redeemed_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    )
  );
  return { status: 200, body: { ok: true, redemptions: r.rows } };
}

export async function handleFeishuCallback(ctx, body, headers) {
  const secret = cleanText(
    process.env.FEISHU_CALLBACK_SECRET || process.env.MINIPROGRAM_SYNC_SECRET || '',
    500
  );
  if (!secret) {
    return { status: 503, body: { ok: false, error: 'callback_secret_not_configured' } };
  }
  const b = body || {};
  const reqSecret = cleanText(b.secret || b.token || headers['x-callback-secret'] || '', 500);
  if (reqSecret !== secret) return { status: 403, body: { ok: false, error: 'unauthorized' } };
  const actionKey = cleanText(b.action_key || '', 255);
  const decision = cleanText(b.decision || '', 80);
  if (!actionKey || !decision) {
    return { status: 400, body: { ok: false, error: 'missing_action_key_or_decision' } };
  }
  try {
    for (const tenantId of await ctx.getActiveTenantIds(ctx.pool)) {
      const handled = await ctx.tenantContext.run(tenantId, async () => {
        const current = await ctx.pool.query(
          `SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`,
          [actionKey]
        );
        if (!current.rows.length) return null;
        const before = current.rows[0];
        if (decision === 'execute') {
          await ctx.pool.query(
            `UPDATE growth_actions SET status='executed', executed_at=NOW(), updated_at=NOW() WHERE action_key=$1`,
            [actionKey]
          );
          await ctx.appendExecutionLog(ctx.pool, {
            action_key: actionKey,
            store_id: before.store_id,
            action_type: before.action_type,
            decision: 'executed',
            operator_username: 'feishu_callback',
            operator_role: 'admin',
            decision_reason: b.reason || '飞书卡片执行',
            result_summary: '从飞书卡片执行',
          });
          return { ok: true, action: 'executed', tenantId };
        }
        if (decision === 'ignore') {
          await ctx.pool.query(
            `UPDATE growth_actions SET status='ignored', updated_at=NOW() WHERE action_key=$1`,
            [actionKey]
          );
          await ctx.appendExecutionLog(ctx.pool, {
            action_key: actionKey,
            store_id: before.store_id,
            action_type: before.action_type,
            decision: 'ignored',
            operator_username: 'feishu_callback',
            operator_role: 'admin',
            decision_reason: b.reason || '飞书卡片忽略',
            result_summary: '从飞书卡片忽略',
          });
          return { ok: true, action: 'ignored', tenantId };
        }
        if (decision === 'feedback') {
          const note = cleanText(b.reason || b.note || '', 2000);
          await ctx.pool.query(
            `UPDATE growth_actions
               SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = COALESCE(executed_at, NOW())
               WHERE action_key = $1`,
            [
              actionKey,
              JSON.stringify({ feishu_feedback_note: note, feedback_source: 'feishu_card' }),
            ]
          );
          await ctx.appendExecutionLog(ctx.pool, {
            action_key: actionKey,
            store_id: before.store_id,
            action_type: before.action_type,
            decision: 'feedback',
            operator_username: 'feishu_callback',
            operator_role: 'admin',
            decision_reason: note || '飞书卡片执行回填',
            result_summary: note || '从飞书卡片回填',
          });
          return { ok: true, action: 'feedback_submitted', tenantId };
        }
        return { ok: false, error: 'invalid_decision' };
      });
      if (handled?.ok) return { status: 200, body: handled };
      if (handled?.error === 'invalid_decision') {
        return { status: 400, body: { ok: false, error: 'invalid_decision' } };
      }
    }
    return { status: 404, body: { ok: false, error: 'action_not_found' } };
  } catch (e) {
    return { status: 500, body: { ok: false, error: e?.message || 'callback_error' } };
  }
}

export async function semanticParse(ctx, body) {
  const text = cleanText(body?.text, 4000);
  if (!text) return { status: 400, body: { ok: false, error: 'missing_text' } };
  try {
    const jwtMod = ctx.jwt || (await import('jsonwebtoken')).default;
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret || secret === 'dev') throw new Error('JWT_SECRET_missing');
    const admToken = jwtMod.sign({ username: 'growth_semantic', role: 'admin' }, secret, {
      expiresIn: '30s',
    });
    const fetchFn = ctx.fetch || fetch;
    const agentResp = await fetchFn(
      (process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') + '/api/growth/semantic-parse',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + admToken,
          'Content-Type': 'application/json',
          'X-Internal-Secret': String(
            process.env.AGENTS_INTERNAL_SECRET ||
              process.env.MINIPROGRAM_SYNC_SECRET ||
              process.env.JWT_SECRET ||
              ''
          ).trim(),
        },
        body: JSON.stringify({ text }),
      }
    );
    const result = agentResp.ok ? await agentResp.json() : { ok: false };
    if (result.ok && result.taste_tags) {
      return { status: 200, body: result };
    }
  } catch {
    /* fallback below */
  }
  return { status: 200, body: parseSemanticFallback(text) };
}

export async function semanticWriteback(ctx, tenantId, body) {
  const b = body || {};
  const customerId = Number(b.customer_id) || 0;
  if (!customerId) return { status: 400, body: { ok: false, error: 'missing_customer_id' } };
  const tags = Array.isArray(b.tags)
    ? b.tags.map((t) => cleanText(String(t), 80)).filter(Boolean)
    : [];
  const tasteTags = Array.isArray(b.taste_tags)
    ? b.taste_tags.map((t) => cleanText(String(t), 80)).filter(Boolean)
    : [];
  const priceHint = b.price_sensitivity_hint == null ? null : Number(b.price_sensitivity_hint);
  const returnIntent = !!b.return_intent;
  await ctx.tenantContext.run(tenantId, async () => {
    await ctx.pool.query(
      `UPDATE growth_customer_profiles
         SET semantic_tags = COALESCE(semantic_tags,'[]'::jsonb) || $2::jsonb,
             favorite_dishes = CASE WHEN $3::jsonb <> '[]'::jsonb THEN COALESCE(favorite_dishes,'[]'::jsonb) || $3::jsonb ELSE favorite_dishes END,
             price_sensitivity = COALESCE($4, price_sensitivity),
             updated_at = NOW()
         WHERE customer_id = $1 AND tenant_id = $5`,
      [customerId, JSON.stringify(tags), JSON.stringify(tasteTags), priceHint, tenantId]
    );
    await ctx.pool.query(
      `INSERT INTO growth_profile_signals (customer_id, signal_type, signal_key, signal_value, signal_score, source, tenant_id)
         VALUES ($1,'semantic_tag','semantic_parse',NULLIF($2,''),NULL,$3,$4)`,
      [customerId, tags.slice(0, 5).join(','), 'agent_parse', tenantId]
    );
  });
  return {
    status: 200,
    body: {
      ok: true,
      customer_id: customerId,
      tags_written: tags.concat(tasteTags),
      return_intent: returnIntent,
    },
  };
}
