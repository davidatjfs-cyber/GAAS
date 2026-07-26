/**
 * 自动营销触达规则引擎（从 growth-api.js 外提）。
 */
import { isAliyunSmsAutoSendEnabled, isAliyunSmsConfigured } from '../../sms.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { cleanText } from '../growth-actions/helpers.js';
import {
  CAMPAIGN_TYPES,
  interpolateTemplate,
} from '../growth-campaigns/helpers.js';
import { cleanPhone } from '../growth-stored-value/helpers.js';
import { enqueueCampaignJobsForRule } from './campaign-enqueue.js';
import {
  buildRuleActionKey,
  buildRulePeriodKey,
  fmtYmd,
  loadRuleCandidates,
} from './helpers.js';

export const POS_STALE_DAYS = 3;

async function createChurnAlert(pool, rule, row) {
  const days = Math.max(0, Math.floor(Number(row.days_since_last_visit) || 0));
  const alertKey = `churn:${cleanText(rule.rule_key, 128)}:${Number(row.customer_id) || 0}:${fmtYmd(row.last_visit_at)}`;
  await pool.query(
    `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics, tenant_id)
     VALUES ($1,'churn','medium',$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (alert_key, tenant_id) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
    [
      alertKey,
      cleanText(row.store_id, 128),
      `${days}天未到店流失预警`,
      `${cleanText(row.customer_name || row.phone || `客户#${row.customer_id}`, 120)} 已${days}天未到店，系统已自动触发回流触达。`,
      '已由规则引擎自动发送回流触达',
      JSON.stringify({ customer_id: row.customer_id, days_since_last_visit: days, rule_key: rule.rule_key }),
      resolveTenantIdDefault(),
    ]
  );
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {object} deps
 * @param {Function} deps.executeGrowthActionRecord
 * @param {Function} deps.isMemberCouponPushConfigured
 * @param {Function} deps.isSubscribePushConfigured
 * @param {Function} [deps.isAliyunSmsConfigured]
 * @param {Function} [deps.isAliyunSmsAutoSendEnabled]
 * @param {import('pino').Logger} [deps.log]
 */
export async function runTouchRuleEngine(pool, options = {}, deps) {
  const {
    executeGrowthActionRecord,
    isMemberCouponPushConfigured,
    isSubscribePushConfigured,
    isAliyunSmsConfigured: smsConfigured = isAliyunSmsConfigured,
    isAliyunSmsAutoSendEnabled: smsAutoSend = isAliyunSmsAutoSendEnabled,
    log = childLogger({ domain: 'growth-touch-rules' }),
  } = deps;

  const ruleEngineTenantId = String(options.tenantId || 'default').trim() || 'default';
  const freshRes = await pool.query(`SELECT MAX(biz_date) AS latest, (CURRENT_DATE - MAX(biz_date))::int AS lag_days FROM pos_orders`);
  const lagDays = Number(freshRes.rows?.[0]?.lag_days);
  if (!Number.isFinite(lagDays) || lagDays > POS_STALE_DAYS) {
    const latest = freshRes.rows?.[0]?.latest || null;
    const alertKey = `pos_stale_guard:${new Date().toISOString().slice(0, 10)}`;
    await pool.query(
      `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics, tenant_id)
       VALUES ($1,'data_freshness','high','',$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (alert_key, tenant_id) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
      [
        alertKey,
        'POS数据滞后，已暂停自动营销触达',
        `POS最新数据为 ${latest || '无'}，滞后 ${Number.isFinite(lagDays) ? lagDays : '未知'} 天（阈值${POS_STALE_DAYS}天）。为避免基于过期数据误发券，规则引擎本次跳过。请尽快上传最新POS数据到飞书。`,
        '上传最新POS数据到飞书并触发 POST /api/growth/pos-feishu-sync',
        JSON.stringify({ latest_biz_date: latest, lag_days: Number.isFinite(lagDays) ? lagDays : null, threshold_days: POS_STALE_DAYS }),
        ruleEngineTenantId,
      ]
    );
    return { created: 0, skipped: true, reason: 'pos_data_stale', lag_days: Number.isFinite(lagDays) ? lagDays : null };
  }
  const limitPerRule = Math.min(Math.max(Number(options.limit_per_rule) || 100, 1), 5000);
  const rulesResult = await pool.query(`SELECT * FROM growth_touch_rules WHERE enabled = TRUE AND tenant_id = $1 ORDER BY priority ASC, rule_key ASC LIMIT 20`, [ruleEngineTenantId]);
  const createdActions = [];
  const claimedPhones = new Set();
  for (const rule of (rulesResult.rows || [])) {
    if (String((rule.action_payload || {}).channel || '') === 'balance') continue;
    const candidates = (await loadRuleCandidates(pool, rule, ruleEngineTenantId)).slice(0, limitPerRule);
    const ruleCampaignKey = cleanText((rule.action_payload || {}).campaign_key || '', 64);
    if (ruleCampaignKey && CAMPAIGN_TYPES[ruleCampaignKey]) {
      await enqueueCampaignJobsForRule(pool, rule, candidates, ruleCampaignKey, claimedPhones).catch((e) => log.warn({ msg: 'enqueue_campaign_job_failed', rule_key: rule.rule_key, err: e?.message }));
      await pool.query(`UPDATE growth_touch_rules SET last_run_at = NOW() WHERE rule_key = $1`, [rule.rule_key]).catch(() => {});
      continue;
    }
    for (const row of candidates) {
      const rowPhone = cleanPhone(row.phone);
      const ruleChannel = cleanText((rule.action_payload && rule.action_payload.channel) || '', 40);
      let channel = null;
      if (ruleChannel === 'member') {
        if ((rowPhone || cleanText(row.openid || '', 128)) && isMemberCouponPushConfigured()) channel = 'member';
      } else if (ruleChannel === 'subscribe') {
        if ((rowPhone || cleanText(row.openid || '', 128)) && isSubscribePushConfigured()) channel = 'subscribe';
      } else if (row.external_userid) {
        channel = 'wecom';
      } else if (rowPhone && smsConfigured()) {
        channel = 'sms';
      }
      if (!channel) continue;

      const GLOBAL_GAP = Math.max(0, Math.floor(Number(process.env.GROWTH_GLOBAL_MIN_GAP_DAYS) || 7));
      const COUPON_GAP = Math.max(0, Math.floor(Number(process.env.GROWTH_COUPON_MIN_GAP_DAYS) || 14));
      const reachedStatuses = `('sent','delivered','read','clicked','redeemed')`;
      if (GLOBAL_GAP > 0) {
        const g = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
           WHERE customer_id = $1 AND status IN ${reachedStatuses}
             AND updated_at > NOW() - ($2::int || ' days')::interval
           LIMIT 1`,
          [row.customer_id, GLOBAL_GAP]
        );
        if (g.rows.length) continue;
      }
      const isVoucherRule = cleanText(rule.action_type || '', 80) === 'send_voucher';
      if (isVoucherRule && COUPON_GAP > 0) {
        const c = await pool.query(
          `SELECT 1 FROM growth_delivery_logs dl
           JOIN growth_actions ga ON ga.action_key = dl.action_key
           WHERE dl.customer_id = $1 AND dl.status IN ${reachedStatuses}
             AND ga.action_type = 'send_voucher'
             AND dl.updated_at > NOW() - ($2::int || ' days')::interval
           LIMIT 1`,
          [row.customer_id, COUPON_GAP]
        );
        if (c.rows.length) continue;
      }

      const freqDays = Math.max(0, Math.floor(Number(rule.action_payload?.frequency_days) || 0));
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
           WHERE rule_key = $1 AND customer_id = $2 AND status = 'sent'
             AND updated_at > NOW() - ($3::int || ' days')::interval
           LIMIT 1`,
          [rule.rule_key, row.customer_id, freqDays]
        );
        if (recent.rows.length) continue;
      }
      const actionPayload = Object.assign({}, rule.action_payload || {}, {
        rule_key: rule.rule_key,
        customer_id: row.customer_id,
        store_id: row.store_id,
        phone: row.phone,
        openid: row.openid || '',
        external_userid: row.external_userid,
        channel,
        customer_name: row.customer_name || row.phone || `客户#${row.customer_id}`,
        days_since_last_visit: row.days_since_last_visit,
        visit_count: row.pos_order_count,
        visit_interval_days: row.visit_interval_days,
        price_sensitivity: row.price_sensitivity,
        response_to_discount: row.response_to_discount,
        pos_total_spend: row.pos_total_spend,
        favorite_dishes_text: Array.isArray(row.favorite_dishes) && row.favorite_dishes.length ? row.favorite_dishes.slice(0, 3).join('、') : '店内推荐菜',
        strategy_key: `rule_engine:${rule.rule_key}`,
      });
      const actionKey = buildRuleActionKey(rule.rule_key, row.customer_id, buildRulePeriodKey(rule.rule_key, row));
      const insert = await pool.query(
        `INSERT INTO growth_actions (action_key, action_type, status, store_id, title, detail, payload, created_by, tenant_id)
         VALUES ($1,$2,'proposed',NULLIF($3,''),$4,$5,$6::jsonb,'rule_engine',$7)
         ON CONFLICT (action_key, tenant_id) DO NOTHING
         RETURNING *`,
        [
          actionKey,
          cleanText(rule.action_type || 'send_message', 80),
          cleanText(row.store_id, 128),
          interpolateTemplate(cleanText(actionPayload.title_template || rule.name, 500), actionPayload),
          interpolateTemplate(cleanText(actionPayload.content_template || rule.name, 2000), actionPayload),
          JSON.stringify(actionPayload),
          ruleEngineTenantId,
        ]
      );
      if (!insert.rows.length) continue;
      if (rule.rule_key === 'dormant_vip_winback' || rule.rule_key === 'dormant_normal_winback') await createChurnAlert(pool, rule, row);
      const actionRow = insert.rows[0];
      const smsAutoBlocked = channel === 'sms' && !smsAutoSend();
      const ruleApproved = !!rule.approved_at;
      if (rule.auto_execute !== false && !smsAutoBlocked && ruleApproved) {
        await executeGrowthActionRecord(pool, actionRow, { username: 'rule_engine', role: rule.owner ? `owner:${rule.owner}` : 'system' }, {}, `规则引擎自动执行:${rule.rule_key}（审核人:${rule.approved_by || '?'}）`);
      }
      createdActions.push(actionKey);
    }
    await pool.query(`UPDATE growth_touch_rules SET last_run_at = NOW() WHERE rule_key = $1`, [rule.rule_key]).catch(() => {});
  }
  return { created: createdActions.length, action_keys: createdActions };
}
