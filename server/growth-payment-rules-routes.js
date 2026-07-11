/**
 * 支付后发券规则 (payment-rules) routes (extracted from growth-api.js — monolith split).
 * registerGrowthPaymentRulesRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function registerGrowthPaymentRulesRoutes(app, pool) {
  // ===== 支付后发券规则（配置集中在 HRMS，小程序定时拉取执行）=====
  const VALID_PAYMENT_TAGS = new Set(['prospect', 'new', 'active', 'at_risk', 'dormant', 'churned', 'vip', 'regular', 'low', 'general']);

  function normalizePaymentTags(input) {
    let arr = [];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string' && input) arr = [input];
    return arr.map(t => String(t).trim()).filter(t => VALID_PAYMENT_TAGS.has(t));
  }

  function paymentRuleToSync(row) {
    return {
      rule_key: row.rule_key,
      store_id: row.store_id,
      name: row.name,
      priority: row.priority,
      trigger_type: 'payment',
      action_type: 'send_voucher',
      action_config: { template_id: row.member_template_id || '' },
      target_tags: Array.isArray(row.target_tags) ? row.target_tags : [],
      trigger_value: row.trigger_value == null ? '' : String(row.trigger_value),
      daily_user_limit: row.daily_user_limit == null ? null : Number(row.daily_user_limit),
      global_daily_limit: row.global_daily_limit == null ? null : Number(row.global_daily_limit)
    };
  }

  app.get('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const r = await tenantContext.run(getGrowthTenantId(req), () =>
        pool.query(`SELECT * FROM marketing_payment_rules ORDER BY store_id ASC, priority ASC, rule_key ASC LIMIT 200`)
      );
      return res.json({ ok: true, rules: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 64);
      const name = cleanText(b.name, 255);
      const memberTemplateId = cleanText(b.member_template_id || b.template_id || '', 128);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
      if (!memberTemplateId) return res.status(400).json({ ok: false, error: 'missing_member_template_id' });

      const operator = getGrowthOperator(req);
      // rule_key 稳定标识：传入沿用，否则按门店生成。小程序以此为 join key。
      const ruleKey = cleanText(b.rule_key, 128) || `pay_${storeId}_${Date.now().toString(36)}`;
      const priority = Math.max(0, Math.floor(Number(b.priority) || 0));
      const triggerValue = String(b.trigger_value == null ? '' : b.trigger_value).trim();
      const tags = normalizePaymentTags(b.target_tags);
      const dailyUserLimit = b.daily_user_limit === '' || b.daily_user_limit == null ? null : Math.max(0, Math.floor(Number(b.daily_user_limit) || 0));
      const globalDailyLimit = b.global_daily_limit === '' || b.global_daily_limit == null ? null : Math.max(0, Math.floor(Number(b.global_daily_limit) || 0));

      const ruleTenantId = getGrowthTenantId(req);
      const r = await tenantContext.run(ruleTenantId, () =>
        pool.query(
          `INSERT INTO marketing_payment_rules
             (rule_key, store_id, name, active, priority, target_tags, trigger_value, member_template_id, daily_user_limit, global_daily_limit, created_by, tenant_id)
           VALUES ($1,$2,$3,COALESCE($4,TRUE),$5,$6::jsonb,$7,$8,$9,$10,NULLIF($11,''),$12)
           ON CONFLICT (rule_key, tenant_id) DO UPDATE SET
             store_id = EXCLUDED.store_id,
             name = EXCLUDED.name,
             active = EXCLUDED.active,
             priority = EXCLUDED.priority,
             target_tags = EXCLUDED.target_tags,
             trigger_value = EXCLUDED.trigger_value,
             member_template_id = EXCLUDED.member_template_id,
             daily_user_limit = EXCLUDED.daily_user_limit,
             global_daily_limit = EXCLUDED.global_daily_limit,
             updated_at = NOW()
           RETURNING *`,
          [ruleKey, storeId, name, b.active !== false, priority, JSON.stringify(tags), triggerValue,
           memberTemplateId, dailyUserLimit, globalDailyLimit, operator.username || '', ruleTenantId]
        )
      );
      return res.json({ ok: true, rule: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete('/api/growth/payment-rules/:ruleKey', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const ruleKey = cleanText(req.params.ruleKey, 128);
      const r = await pool.query(`DELETE FROM marketing_payment_rules WHERE rule_key = $1 RETURNING rule_key`, [ruleKey]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
      return res.json({ ok: true, deleted: ruleKey });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序定时拉取：返回全部有效规则 + 当前有效 rule_key 全集（用于小程序清理已删/停用规则）
  app.get('/api/growth/payment-rules/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const r = await tenantContext.run(getGrowthTenantId(req), () =>
        pool.query(`SELECT * FROM marketing_payment_rules ORDER BY priority ASC, rule_key ASC LIMIT 500`)
      );
      const allKeys = r.rows.map(x => x.rule_key);
      const rules = r.rows.filter(x => x.active).map(paymentRuleToSync);
      return res.json({ ok: true, rules, all_rule_keys: allKeys });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
