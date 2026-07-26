/**
 * 自动营销规则候选集 / 周期键 / 人群过滤（从 growth-api.js 外提）。
 */
import { cleanText } from '../growth-actions/helpers.js';
import { cleanPhone } from '../growth-stored-value/helpers.js';
import { phoneAbBucket } from '../growth-campaigns/helpers.js';

export function fmtYmd(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

export function fmtYm(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 7);
}

export function deriveBirthdayMonth(meta = {}) {
  const monthRaw = cleanText(meta?.birthday_month, 2);
  if (/^(0?[1-9]|1[0-2])$/.test(monthRaw)) return monthRaw.padStart(2, '0');
  const birthday = cleanText(meta?.birthday, 32);
  const m = birthday.match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!m) return '';
  return String(m[1]).padStart(2, '0');
}

export function buildRuleActionKey(ruleKey, customerId, periodKey) {
  return `rule:${cleanText(ruleKey, 128)}:${Number(customerId) || 0}:${cleanText(periodKey, 40)}`;
}

export function resolveRuleStoreId(rule) {
  const criteria = rule?.criteria || {};
  const payload = rule?.action_payload || {};
  return cleanText(criteria.store_id || payload.store_id || '', 128);
}

export function buildRulePeriodKey(ruleKey, row) {
  if (ruleKey === 'loyal_birthday_month') return fmtYm(new Date());
  return fmtYmd(row.last_visit_at || row.pos_last_order_at || row.last_seen_at);
}

/** Filter loyal_birthday_month candidates in memory (same口径 as loadRuleCandidates). */
export function filterLoyalBirthdayMonthCandidates(rows, now = new Date()) {
  const currentMonth = fmtYm(now).slice(5, 7);
  return rows.filter((row) => {
    const visits = Math.max(0, Math.floor(Number(row.pos_order_count) || 0));
    const interval = Number(row.visit_interval_days);
    return (
      deriveBirthdayMonth(row.customer_meta || {}) === currentMonth &&
      visits >= 3 &&
      Number.isFinite(interval) &&
      interval <= 10
    );
  });
}

export function filterGenericRuleCandidates(rows, rule, segmentSet, storeFilterOverride = '') {
  const criteria = rule.criteria || {};
  const ruleStoreId = resolveRuleStoreId(rule);
  const effectiveStoreId = cleanText(storeFilterOverride || ruleStoreId || '', 128);
  return rows.filter((row) => {
    const days = Math.max(0, Math.floor(Number(row.days_since_last_visit) || 0));
    const visits = Math.max(0, Math.floor(Number(row.pos_order_count) || 0));
    if (rule.rule_key === 'new_dish_launch_notify') return visits >= 4 && days >= 5 && days <= 20;
    const stage = row.lifecycle_stage || '';
    const tier = row.value_tier || 'low';
    if (effectiveStoreId && String(row.store_id || '') !== String(effectiveStoreId)) return false;
    if (criteria.lifecycle_stage && stage !== criteria.lifecycle_stage) return false;
    if (criteria.lifecycle_stage_not && stage === criteria.lifecycle_stage_not) return false;
    if (criteria.value_tier && tier !== criteria.value_tier) return false;
    if (criteria.value_tier_not && tier === criteria.value_tier_not) return false;
    if (Number.isFinite(Number(criteria.max_days_since_last_visit)) && days > Number(criteria.max_days_since_last_visit))
      return false;
    if (Number.isFinite(Number(criteria.min_days_since_last_visit)) && days < Number(criteria.min_days_since_last_visit))
      return false;
    if (Number.isFinite(Number(criteria.min_visit_count)) && visits < Number(criteria.min_visit_count)) return false;
    if (Number.isFinite(Number(criteria.max_visit_count)) && visits > Number(criteria.max_visit_count)) return false;
    if (Number.isFinite(Number(criteria.interval_overdue_multiplier))) {
      const interval = Number(row.visit_interval_days);
      if (!Number.isFinite(interval) || interval <= 0) return false;
      if (days < interval * Number(criteria.interval_overdue_multiplier)) return false;
    }
    if (criteria.segment_key) {
      if (!segmentSet || !segmentSet.has(String(row.phone || ''))) return false;
    }
    if (criteria.ab_bucket === 0 || criteria.ab_bucket === 1) {
      if (phoneAbBucket(cleanPhone(row.phone), 2) !== criteria.ab_bucket) return false;
    }
    const hasAudienceFilter = !!(
      criteria.lifecycle_stage ||
      criteria.lifecycle_stage_not ||
      criteria.value_tier ||
      criteria.value_tier_not ||
      criteria.segment_key ||
      Number.isFinite(Number(criteria.max_days_since_last_visit)) ||
      Number.isFinite(Number(criteria.min_days_since_last_visit)) ||
      Number.isFinite(Number(criteria.min_visit_count)) ||
      Number.isFinite(Number(criteria.max_visit_count)) ||
      Number.isFinite(Number(criteria.interval_overdue_multiplier))
    );
    return hasAudienceFilter;
  });
}

export async function fetchGenericRuleCandidates(pool, tenantId = 'default') {
  const r = await pool.query(
    `SELECT cp.customer_id, cp.store_id, cp.phone, cp.price_sensitivity, cp.response_to_discount,
            cp.lifecycle_stage, cp.value_tier, cp.price_sensitive,
            cp.pos_order_count, cp.pos_total_spend, cp.pos_last_order_at, cp.visit_interval_days, cp.favorite_dishes, gc.last_seen_at, gc.openid,
            COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date) AS last_visit_at,
            (CURRENT_DATE - COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date))::int AS days_since_last_visit,
            gc.meta AS customer_meta,
            COALESCE(ww.external_userid, gc.external_userid) AS external_userid,
            COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(ww.name,''), NULLIF(gc.meta->>'name',''), cp.phone, '') AS customer_name
     FROM growth_customer_profiles cp
     JOIN growth_customers gc ON gc.id = cp.customer_id
     LEFT JOIN wechat_work_customers ww ON ww.bind_customer_id = cp.customer_id
     WHERE cp.tenant_id = $1 AND gc.tenant_id = $1
       AND (COALESCE(ww.external_userid, gc.external_userid) IS NOT NULL
        OR (cp.phone IS NOT NULL AND cp.phone <> ''))
     LIMIT 50000`,
    [tenantId]
  );
  return r.rows;
}

export async function loadSegmentPhoneSet(pool, segmentKey, tenantId = 'default') {
  if (!segmentKey) return null;
  const r = await pool.query(
    `SELECT phone FROM growth_segment_members WHERE segment_key = $1 AND tenant_id = $2`,
    [segmentKey, tenantId]
  );
  return new Set((r.rows || []).map((x) => String(x.phone || '')));
}

export async function loadRuleCandidates(pool, rule, tenantId = 'default') {
  if (rule.rule_key === 'loyal_birthday_month') {
    const r = await pool.query(
      `SELECT cp.customer_id, cp.store_id, cp.phone, cp.pos_order_count, cp.pos_last_order_at, cp.visit_interval_days,
              gc.meta AS customer_meta, gc.last_seen_at, gc.openid, gc.external_userid AS customer_external_userid,
              COALESCE(ww.external_userid, gc.external_userid) AS external_userid,
              COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(ww.name,''), NULLIF(gc.meta->>'name',''), cp.phone, '') AS customer_name
       FROM growth_customer_profiles cp
       JOIN growth_customers gc ON gc.id = cp.customer_id
       LEFT JOIN wechat_work_customers ww ON ww.bind_customer_id = cp.customer_id
       WHERE cp.tenant_id = $1 AND gc.tenant_id = $1
         AND (COALESCE(ww.external_userid, gc.external_userid) IS NOT NULL
          OR (cp.phone IS NOT NULL AND cp.phone <> ''))
       LIMIT 500`,
      [tenantId]
    );
    return filterLoyalBirthdayMonthCandidates(r.rows);
  }
  const rows = await fetchGenericRuleCandidates(pool, tenantId);
  const segmentSet = await loadSegmentPhoneSet(pool, (rule.criteria || {}).segment_key, tenantId);
  return filterGenericRuleCandidates(rows, rule, segmentSet);
}
