/**
 * Payment-after-coupon rules — pure logic (no req/res).
 */
import {
  cleanText,
  normalizePaymentTags,
  paymentRuleToSync,
  parseOptionalNonNegInt,
} from './helpers.js';

export async function listPaymentRules(ctx, tenantId) {
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT * FROM marketing_payment_rules ORDER BY store_id ASC, priority ASC, rule_key ASC LIMIT 200`
    )
  );
  return { status: 200, body: { ok: true, rules: r.rows } };
}

export async function upsertPaymentRule(ctx, tenantId, body, operator) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 64);
  const name = cleanText(b.name, 255);
  const memberTemplateId = cleanText(b.member_template_id || b.template_id || '', 128);
  if (!storeId) return { status: 400, body: { ok: false, error: 'missing_store_id' } };
  if (!name) return { status: 400, body: { ok: false, error: 'missing_name' } };
  if (!memberTemplateId) {
    return { status: 400, body: { ok: false, error: 'missing_member_template_id' } };
  }

  const ruleKey = cleanText(b.rule_key, 128) || `pay_${storeId}_${Date.now().toString(36)}`;
  const priority = Math.max(0, Math.floor(Number(b.priority) || 0));
  const triggerValue = String(b.trigger_value == null ? '' : b.trigger_value).trim();
  const tags = normalizePaymentTags(b.target_tags);
  const dailyUserLimit = parseOptionalNonNegInt(b.daily_user_limit);
  const globalDailyLimit = parseOptionalNonNegInt(b.global_daily_limit);

  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
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
      [
        ruleKey,
        storeId,
        name,
        b.active !== false,
        priority,
        JSON.stringify(tags),
        triggerValue,
        memberTemplateId,
        dailyUserLimit,
        globalDailyLimit,
        operator?.username || '',
        tenantId,
      ]
    )
  );
  return { status: 200, body: { ok: true, rule: r.rows[0] } };
}

export async function deletePaymentRule(ctx, ruleKeyRaw) {
  const ruleKey = cleanText(ruleKeyRaw, 128);
  const r = await ctx.pool.query(
    `DELETE FROM marketing_payment_rules WHERE rule_key = $1 RETURNING rule_key`,
    [ruleKey]
  );
  if (!r.rows.length) return { status: 404, body: { ok: false, error: 'rule_not_found' } };
  return { status: 200, body: { ok: true, deleted: ruleKey } };
}

export async function syncPaymentRules(ctx, tenantId) {
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `SELECT * FROM marketing_payment_rules ORDER BY priority ASC, rule_key ASC LIMIT 500`
    )
  );
  const allKeys = r.rows.map((x) => x.rule_key);
  const rules = r.rows.filter((x) => x.active).map(paymentRuleToSync);
  return { status: 200, body: { ok: true, rules, all_rule_keys: allKeys } };
}
