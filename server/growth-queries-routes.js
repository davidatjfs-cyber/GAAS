/**
 * Growth read-only queries + callback/semantic-parse routes (extracted from growth-api.js — monolith split).
 * registerGrowthQueriesRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext, getActiveTenantIds } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  appendExecutionLog,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function registerGrowthQueriesRoutes(app, pool) {
  app.get('/api/growth/customers', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const phone = cleanText(req.query.phone || '', 32);
    const openid = cleanText(req.query.openid || '', 128);
    const store_id = cleanText(req.query.store_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (phone) { conditions.push(`phone = $${idx++}`); params.push(phone); }
    if (openid) { conditions.push(`openid = $${idx++}`); params.push(openid); }
    if (store_id) { conditions.push(`(first_store_id = $${idx} OR last_store_id = $${idx})`); params.push(store_id); idx++; }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await tenantContext.run(getGrowthTenantId(req), () =>
      pool.query(`SELECT id, phone, openid, external_userid, first_store_id, last_store_id, first_seen_at, last_seen_at, meta, created_at FROM growth_customers ${where} ORDER BY last_seen_at DESC NULLS LAST LIMIT $${idx++} OFFSET $${idx}`, [...params, limit, offset])
    );
    return res.json({ ok: true, customers: r.rows });
  });

  app.get('/api/growth/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const event_type = cleanText(req.query.event_type || '', 80);
    const store_id = cleanText(req.query.store_id || '', 128);
    const campaign_id = cleanText(req.query.campaign_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (event_type) { conditions.push(`event_type = $${idx++}`); params.push(event_type); }
    if (store_id) { conditions.push(`store_id = $${idx++}`); params.push(store_id); }
    if (campaign_id) { conditions.push(`campaign_id = $${idx++}`); params.push(campaign_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await tenantContext.run(getGrowthTenantId(req), () =>
      pool.query(`SELECT id, event_type, customer_id, phone, openid, store_id, campaign_id, channel, coupon_id, order_id, amount_fen, occurred_at FROM growth_events ${where} ORDER BY occurred_at DESC LIMIT $${idx++} OFFSET $${idx}`, [...params, limit, offset])
    );
    return res.json({ ok: true, events: r.rows });
  });

  app.get('/api/growth/campaigns', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const store_id = cleanText(req.query.store_id || '', 128);
    const status = cleanText(req.query.status || '', 40);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (store_id) { conditions.push(`store_id = $${idx++}`); params.push(store_id); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await tenantContext.run(getGrowthTenantId(req), () =>
      pool.query(`SELECT * FROM growth_campaigns ${where} ORDER BY created_at DESC`, params)
    );
    return res.json({ ok: true, campaigns: r.rows });
  });

  app.get('/api/growth/redemptions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaign_id = cleanText(req.query.campaign_id || '', 128);
    const store_id = cleanText(req.query.store_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (campaign_id) { conditions.push(`r.campaign_id = $${idx++}`); params.push(campaign_id); }
    if (store_id) { conditions.push(`r.store_id = $${idx++}`); params.push(store_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    // 关联活动中文名（campaign_id → growth_campaigns.name），并回传 metadata 供前台兜底取活动/规则名
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT r.id, r.customer_id, r.coupon_id, r.campaign_id, r.store_id, r.amount_fen, r.redeemed_at, r.metadata,
              c.name AS campaign_name
       FROM growth_redemptions r
       LEFT JOIN growth_campaigns c ON c.campaign_id = r.campaign_id
       ${where} ORDER BY r.redeemed_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    ));
    return res.json({ ok: true, redemptions: r.rows });
  });

  // ── Phase 3: Feishu callback for alert cards ──
  const FEISHU_CALLBACK_SECRET = cleanText(process.env.FEISHU_CALLBACK_SECRET || process.env.MINIPROGRAM_SYNC_SECRET || '', 500);
  app.post('/api/growth/feishu-callback', async (req, res) => {
    if (!FEISHU_CALLBACK_SECRET) {
      return res.status(503).json({ ok: false, error: 'callback_secret_not_configured' });
    }
    const b = req.body || {};
    const reqSecret = cleanText(b.secret || b.token || req.headers['x-callback-secret'] || '', 500);
    if (reqSecret !== FEISHU_CALLBACK_SECRET) return res.status(403).json({ ok: false, error: 'unauthorized' });
    const actionKey = cleanText(b.action_key || '', 255);
    const decision = cleanText(b.decision || '', 80);
    if (!actionKey || !decision) return res.status(400).json({ ok: false, error: 'missing_action_key_or_decision' });
    try {
      for (const tenantId of await getActiveTenantIds(pool)) {
        const handled = await tenantContext.run(tenantId, async () => {
          const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
          if (!current.rows.length) return null;
          const before = current.rows[0];
          if (decision === 'execute') {
            await pool.query(`UPDATE growth_actions SET status='executed', executed_at=NOW(), updated_at=NOW() WHERE action_key=$1`, [actionKey]);
            await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'executed', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: b.reason || '飞书卡片执行', result_summary: '从飞书卡片执行' });
            return { ok: true, action: 'executed', tenantId };
          }
          if (decision === 'ignore') {
            await pool.query(`UPDATE growth_actions SET status='ignored', updated_at=NOW() WHERE action_key=$1`, [actionKey]);
            await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'ignored', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: b.reason || '飞书卡片忽略', result_summary: '从飞书卡片忽略' });
            return { ok: true, action: 'ignored', tenantId };
          }
          if (decision === 'feedback') {
            const note = cleanText(b.reason || b.note || '', 2000);
            await pool.query(
              `UPDATE growth_actions
               SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = COALESCE(executed_at, NOW())
               WHERE action_key = $1`,
              [actionKey, JSON.stringify({ feishu_feedback_note: note, feedback_source: 'feishu_card' })]
            );
            await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'feedback', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: note || '飞书卡片执行回填', result_summary: note || '从飞书卡片回填' });
            return { ok: true, action: 'feedback_submitted', tenantId };
          }
          return { ok: false, error: 'invalid_decision' };
        });
        if (handled?.ok) return res.json(handled);
        if (handled?.error === 'invalid_decision') {
          return res.status(400).json({ ok: false, error: 'invalid_decision' });
        }
      }
      return res.status(404).json({ ok: false, error: 'action_not_found' });
    } catch (e) { return res.status(500).json({ ok: false, error: e?.message || 'callback_error' }); }
  });

  // ── Phase 5: Semantic write-back to profiles ──
  app.post('/api/growth/semantic-parse', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const text = cleanText(req.body.text, 4000);
    if (!text) return res.status(400).json({ ok: false, error: 'missing_text' });
    try {
      const { default: jwt } = await import('jsonwebtoken');
      const admToken = jwt.sign({ username: 'growth_semantic', role: 'admin' }, (() => { const s = String(process.env.JWT_SECRET || '').trim(); if (!s || s === 'dev') throw new Error('JWT_SECRET_missing'); return s; })(), { expiresIn: '30s' });
      const agentResp = await fetch((process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') + '/api/growth/semantic-parse', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + admToken, 'Content-Type': 'application/json', 'X-Internal-Secret': String(process.env.AGENTS_INTERNAL_SECRET || process.env.MINIPROGRAM_SYNC_SECRET || process.env.JWT_SECRET || '').trim() },
        body: JSON.stringify({ text })
      });
      const result = agentResp.ok ? await agentResp.json() : { ok: false };
      if (result.ok && result.taste_tags) {
        return res.json(result);
      }
    } catch (e) { /* fallback below */ }
    // Fallback keyword parsing
    const tags = [];
    if (/辣|麻辣/.test(text)) tags.push('麻辣');
    if (/清淡|少油/.test(text)) tags.push('清淡');
    if (/甜|甜品/.test(text)) tags.push('甜品');
    if (/肉|牛|羊|猪/.test(text)) tags.push('肉食');
    if (/汤|煲/.test(text)) tags.push('汤品');
    return res.json({
      ok: true, taste_tags: tags, price_sensitivity: null,
      emotion: /差|不好|失望/.test(text) ? '负面' : /好|好吃|满意/.test(text) ? '正面' : '中性',
      return_intent: /再来|下次|还会/.test(text),
      key_insight: '关键词解析（LLM不可用）', source: 'keyword_fallback'
    });
  });

  // ── Phase 5: Semantic write-back to profiles ──
  app.post('/api/growth/semantic-writeback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const customerId = Number(b.customer_id) || 0;
    if (!customerId) return res.status(400).json({ ok: false, error: 'missing_customer_id' });
    const tags = Array.isArray(b.tags) ? b.tags.map(t => cleanText(String(t), 80)).filter(Boolean) : [];
    const tasteTags = Array.isArray(b.taste_tags) ? b.taste_tags.map(t => cleanText(String(t), 80)).filter(Boolean) : [];
    const priceHint = b.price_sensitivity_hint == null ? null : Number(b.price_sensitivity_hint);
    const returnIntent = !!b.return_intent;
    const tenantId = getGrowthTenantId(req);
    await tenantContext.run(tenantId, async () => {
      await pool.query(
        `UPDATE growth_customer_profiles
         SET semantic_tags = COALESCE(semantic_tags,'[]'::jsonb) || $2::jsonb,
             favorite_dishes = CASE WHEN $3::jsonb <> '[]'::jsonb THEN COALESCE(favorite_dishes,'[]'::jsonb) || $3::jsonb ELSE favorite_dishes END,
             price_sensitivity = COALESCE($4, price_sensitivity),
             updated_at = NOW()
         WHERE customer_id = $1 AND tenant_id = $5`,
        [customerId, JSON.stringify(tags), JSON.stringify(tasteTags), priceHint, tenantId]
      );
      await pool.query(
        `INSERT INTO growth_profile_signals (customer_id, signal_type, signal_key, signal_value, signal_score, source, tenant_id)
         VALUES ($1,'semantic_tag','semantic_parse',NULLIF($2,''),NULL,$3,$4)`,
        [customerId, tags.slice(0, 5).join(','), 'agent_parse', tenantId]
      );
    });
    return res.json({ ok: true, customer_id: customerId, tags_written: tags.concat(tasteTags), return_intent: returnIntent });
  });
}
