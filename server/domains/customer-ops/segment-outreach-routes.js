/**
 * Customer-ops segments / reachability / offer / copy routes (P5.4).
 */
import { cleanText } from './ops-helpers.js';
export function registerCustomerOpsSegmentOutreachRoutes(app, deps) {
  const {
    pool, authRequired, callLLM, basePath, getTenantId, ensureCustomerOpsTables,
    applySegmentCriteria: _applySegmentCriteria, suggestOfferStrategy, generateOutreachCopy
  } = deps;
  app.get(`${basePath}/segments`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_segments WHERE tenant_id=$1 ORDER BY created_at DESC`, [getTenantId(req)]);
      res.json({ ok: true, segments: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post(`${basePath}/segments`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const name = cleanText(req.body?.name || '', 80);
      const criteria = req.body?.criteria || {};
      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      const r = await pool.query(`INSERT INTO customer_segments (tenant_id, name, criteria_json, created_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING *`, [getTenantId(req), name, JSON.stringify(criteria), req.user?.username || '']);
      res.json({ ok: true, segment: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete(`${basePath}/segments/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM customer_segments WHERE id=$1 AND tenant_id=$2`, [req.params.id, getTenantId(req)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 可触达/不可触达客户池：短信是当前唯一稳定的自动化触达渠道（企微因域名主体限制在租赁场景
  // 下无法自动发送），所以“可触达”按有效手机号判断，不再按企微绑定(external_userid)判断。
  // 同时把 value_tier=vip 的客户单独摘出来，对应“高价值客户人工跟进名单”。
  app.get(`${basePath}/reachability-pools`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const limit = Math.min(2000, Number(req.query.limit || 500));
      const [reachableR, unreachableR, vipR, summaryR] = await Promise.all([
        pool.query(
          `SELECT phone, store_id, lifecycle_stage, value_tier, pos_order_count, pos_total_spend, pos_last_order_at
             FROM growth_customer_profiles
            WHERE tenant_id=$1 AND COALESCE(phone,'') ~ '^1[0-9]{10}$'
            ORDER BY updated_at DESC LIMIT $2`,
          [tenantId, limit]
        ),
        pool.query(
          `SELECT customer_id, store_id, lifecycle_stage, value_tier, pos_order_count, pos_total_spend, pos_last_order_at
             FROM growth_customer_profiles
            WHERE tenant_id=$1 AND NOT (COALESCE(phone,'') ~ '^1[0-9]{10}$')
            ORDER BY updated_at DESC LIMIT $2`,
          [tenantId, limit]
        ),
        pool.query(
          `SELECT phone, store_id, lifecycle_stage, pos_order_count, pos_total_spend, pos_last_order_at
             FROM growth_customer_profiles
            WHERE tenant_id=$1 AND value_tier='vip' AND COALESCE(phone,'') <> ''
            ORDER BY pos_total_spend DESC NULLS LAST LIMIT $2`,
          [tenantId, limit]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE COALESCE(phone,'') ~ '^1[0-9]{10}$')::int AS reachable,
                  COUNT(*) FILTER (WHERE value_tier='vip')::int AS vip
             FROM growth_customer_profiles WHERE tenant_id=$1`,
          [tenantId]
        ),
      ]);
      const summary = summaryR.rows?.[0] || {};
      res.json({
        ok: true,
        summary: {
          total: Number(summary.total || 0),
          reachable: Number(summary.reachable || 0),
          unreachable: Math.max(0, Number(summary.total || 0) - Number(summary.reachable || 0)),
          vip: Number(summary.vip || 0),
        },
        reachable_pool: reachableR.rows,
        unreachable_pool: unreachableR.rows,
        vip_manual_followup: vipR.rows,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 优惠策略生成：按客群（lifecycle_stage x value_tier）汇总现有客户，给出规则化的优惠/权益建议。
  app.get(`${basePath}/offer-strategy`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const r = await pool.query(
        `SELECT lifecycle_stage, value_tier, COUNT(*)::int AS customer_count,
                COALESCE(SUM(pos_total_spend), 0)::numeric AS total_spend
           FROM growth_customer_profiles
          WHERE tenant_id=$1
          GROUP BY lifecycle_stage, value_tier
          ORDER BY total_spend DESC`,
        [tenantId]
      );
      const strategies = r.rows.map((row) => ({
        lifecycle_stage: row.lifecycle_stage,
        value_tier: row.value_tier,
        customer_count: Number(row.customer_count || 0),
        total_spend: Number(row.total_spend || 0),
        ...suggestOfferStrategy(row),
      }));
      res.json({ ok: true, strategies });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 触达文案生成：给定客群标签和本次权益，用 LLM 生成短信合规文案候选。
  app.post(`${basePath}/copy/generate`, authRequired, async (req, res) => {
    try {
      if (!callLLM) return res.status(503).json({ ok: false, error: 'llm_unavailable' });
      const segmentLabel = cleanText(req.body?.segment_label || req.body?.lifecycle_stage || '', 80);
      const offerText = cleanText(req.body?.offer_text || '', 120);
      const storeName = cleanText(req.body?.store_name || '', 80);
      const signName = cleanText(req.body?.sign_name || '', 20);
      const result = await generateOutreachCopy({ segmentLabel, storeName, offerText, signName }, callLLM);
      if (!result.ok) return res.status(502).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });
}
