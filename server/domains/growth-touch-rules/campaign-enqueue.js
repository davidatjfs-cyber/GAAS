/**
 * 活动制规则候选冻结为 growth_campaign_jobs（从 growth-api.js 外提）。
 */
import { isAliyunSmsAutoSendEnabled } from '../../sms.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { cleanPhone } from '../growth-stored-value/helpers.js';
import {
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  CAMPAIGN_TYPES,
  deriveAbcStep,
  freqDaysEnv,
  holdoutPct,
  marketingFatigueMax,
  marketingFatigueWindowDays,
  phoneHashPct,
  pickAbcTemplate,
  pickCampaignTemplate,
} from '../growth-campaigns/helpers.js';

export async function enqueueCampaignJobsForRule(pool, rule, candidates, campaignKey, claimedPhones = null) {
  const cfg = CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return { enqueued: 0, skipped: 'unknown_campaign' };
  const ap = rule.action_payload || {};
  const ok = rule.enabled && !!rule.approved_at && rule.auto_execute !== false && isAliyunSmsAutoSendEnabled();
  if (!ok) return { enqueued: 0, skipped: 'governance' };
  const valueYuan = Math.max(0, Math.floor(Number(ap.coupon_value_fen || ap.value_fen || 0) / 100));
  const validDays = Math.max(1, Math.floor(Number(ap.valid_days) || 14));
  const abcOrder = ABC_ROTATION_ORDER[campaignKey];
  const needsValue = Array.isArray(cfg.vars) && cfg.vars.includes('value');
  if (needsValue && valueYuan <= 0 && !abcOrder) return { enqueued: 0, skipped: 'missing_value' };
  const gDays = freqDaysEnv('ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS', 7);
  let recentSentSet = new Set();
  if (gDays > 0) {
    const rc = await pool.query(
      `SELECT DISTINCT payload->>'phone' AS phone FROM growth_delivery_logs
         WHERE channel='sms' AND status='sent' AND created_at > now() - ($1 || ' days')::interval`,
      [String(gDays)]
    );
    recentSentSet = new Set((rc.rows || []).map((r) => String(r.phone || '')).filter(Boolean));
  }
  const supRes = await pool.query(`SELECT phone FROM growth_sms_suppression`);
  const suppressedSet = new Set((supRes.rows || []).map((r) => String(r.phone || '')));
  const candPhones = [...new Set(candidates.map((c) => cleanPhone(c.phone)).filter(Boolean))];
  let fatigueSet = new Set();
  if (candPhones.length) {
    const fr = await pool.query(
      `WITH lastvisit AS (
         SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
          WHERE phone = ANY($1::text[]) GROUP BY phone
       )
       SELECT dl.payload->>'phone' AS phone FROM growth_delivery_logs dl
         LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
        WHERE dl.channel='sms' AND dl.status='sent'
          AND dl.payload->>'phone' = ANY($1::text[])
          AND dl.created_at > now() - ($2 || ' days')::interval
          AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
        GROUP BY 1 HAVING count(*) >= $3`,
      [candPhones, String(marketingFatigueWindowDays()), marketingFatigueMax()]
    );
    fatigueSet = new Set((fr.rows || []).map((r) => String(r.phone || '')).filter(Boolean));
  }
  let abcSentByPhone = new Map();
  if (abcOrder && candPhones.length) {
    const sc = await pool.query(
      `WITH lastvisit AS (
         SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
          WHERE phone = ANY($2::text[]) GROUP BY phone
       )
       SELECT dl.payload->>'phone' AS phone, count(*)::int n, MAX(dl.created_at) AS last_sent FROM growth_delivery_logs dl
         LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
        WHERE dl.channel='sms' AND dl.status='sent' AND dl.rule_key = $1
          AND dl.payload->>'phone' = ANY($2::text[])
          AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
        GROUP BY 1`,
      [campaignKey, candPhones]
    );
    abcSentByPhone = new Map(sc.rows.map((r) => [r.phone, { n: Number(r.n), last: r.last_sent ? new Date(r.last_sent).getTime() : null }]));
  }
  const abSplit = Array.isArray(ap.ab_value_split) && ap.ab_value_split.length === 2
    ? ap.ab_value_split.map((v) => Math.max(0, Math.floor(Number(v) || 0))) : null;
  const highFen = Math.max(0, Math.floor(Number(ap.coupon_value_fen_high) || 0));
  const highThresholdFen = Math.max(0, Math.floor(Number(ap.high_spend_threshold_fen) || 50000));
  const pickVariant = (row, phone) => {
    if (abSplit && abSplit[0] > 0 && abSplit[1] > 0) {
      return phoneHashPct(phone) % 2 === 0
        ? { suffix: '_a', valueYuan: Math.floor(abSplit[0] / 100) }
        : { suffix: '_b', valueYuan: Math.floor(abSplit[1] / 100) };
    }
    if (highFen > 0 && Math.round(Number(row.pos_total_spend || 0) * 100) >= highThresholdFen) {
      return { suffix: '_hi', valueYuan: Math.floor(highFen / 100) };
    }
    return { suffix: '', valueYuan };
  };
  const hPct = holdoutPct();
  const byGroup = new Map();
  let heldOut = 0;
  for (const row of candidates) {
    const phone = cleanPhone(row.phone);
    if (!phone) continue;
    if (recentSentSet.has(phone)) continue;
    if (suppressedSet.has(phone)) continue;
    if (fatigueSet.has(phone)) continue;
    if (claimedPhones && claimedPhones.has(phone)) continue;
    const sid = String(row.store_id || ap.store_id || '').trim();
    if (!sid) continue;
    let variant = null;
    let abcStep = null;
    if (abcOrder) {
      const rec = abcSentByPhone.get(phone) || { n: 0, last: null };
      const derived = deriveAbcStep(campaignKey, rec.n);
      if (derived.blacklisted) continue;
      if (rec.last && derived.freqDaysOverride > 0 &&
          (Date.now() - rec.last) < derived.freqDaysOverride * 86400000) continue;
      if (!pickAbcTemplate(derived.step, sid)) continue;
      abcStep = derived.step;
      variant = { suffix: `_${abcStep}`, valueYuan: Math.floor(ABC_STEP_DEFS[abcStep].coupon_value_fen / 100) };
    } else if (!pickCampaignTemplate(campaignKey, sid)) {
      continue;
    }
    if (hPct > 0 && phoneHashPct(phone) < hPct) {
      heldOut++;
      await pool.query(
        `INSERT INTO growth_holdout_members (phone, campaign_key, store_id, tenant_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone, campaign_key, tenant_id) DO NOTHING`,
        [phone, campaignKey, sid, resolveTenantIdDefault()]
      ).catch(() => {});
      continue;
    }
    if (!variant) variant = pickVariant(row, phone);
    const gKey = `${sid}${variant.suffix}`;
    if (!byGroup.has(gKey)) byGroup.set(gKey, { sid, variant, abcStep, targets: [] });
    byGroup.get(gKey).targets.push({ phone, name: row.customer_name || '' });
    if (claimedPhones) claimedPhones.add(phone);
  }
  const today = new Date().toISOString().slice(0, 10);
  let enqueued = 0;
  for (const [, g] of byGroup) {
    if (!g.targets.length) continue;
    const campaignId = `auto_${campaignKey}_${g.sid}_${today}${g.variant.suffix}`;
    const exist = await pool.query(`SELECT 1 FROM growth_campaign_jobs WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
    if (exist.rows.length) continue;
    const result = {
      campaign_key: campaignKey,
      coupon_count: g.abcStep ? ABC_STEP_DEFS[g.abcStep].coupon_count : cfg.coupon_count,
      rule_key: rule.rule_key,
    };
    if (g.variant.suffix) result.variant = g.variant.suffix.slice(1);
    if (g.abcStep) result.abc_step = g.abcStep;
    await pool.query(
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
       VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb,$10)`,
      [campaignId, g.sid, g.variant.valueYuan, validDays, JSON.stringify(g.targets), g.targets.length, campaignKey, `rule_engine:${rule.rule_key}`, JSON.stringify(result), resolveTenantIdDefault()]
    );
    enqueued += g.targets.length;
  }
  return { enqueued, held_out: heldOut };
}
