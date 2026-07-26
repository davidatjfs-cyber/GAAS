export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { sendAliyunSms, isAliyunSmsAutoSendEnabled } from './sms.js';
import { STORES as _ALL_STORES } from './brands-config.js';
import {
  buildActionMessage,
  pickSmsTemplateByStore,
  freqDaysEnv,
  globalSmsCapped,
  inSmsQuietHours,
  isPhoneSuppressed,
  handleSmsFailure,
  pickBalanceTemplateByStore,
} from './domains/growth-campaigns/helpers.js';
import { buildSmsTemplateParam } from './domains/growth-campaigns/sms-params.js';
import { applyGrowthActionTypeEffects } from './domains/growth-actions/execute-type-effects.js';
import { deliverGrowthActionChannels } from './domains/growth-actions/deliver-channels.js';
export {
  pickCampaignSmsSign,
  pickWinbackTemplateByStore,
  pickBalanceTemplateByStore,
  CAMPAIGN_TYPES,
  pickCampaignTemplate,
  freqDaysEnv,
  globalSmsCapped,
  inSmsQuietHours,
  isPhoneSuppressed,
  handleSmsFailure,
  campaignTouchCapped,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  pickAbcTemplate,
  deriveAbcStep,
  countCampaignSent,
  marketingFatigueCapped,
  buildCampaignTargetQuery,
  mapStoreNameToId,
} from './domains/growth-campaigns/helpers.js';
export { formatSmsValidDate } from './domains/growth-campaigns/sms-params.js';
import { recomputeCustomerProfiles } from './domains/growth-profiles/recompute.js';
export { recomputeCustomerProfiles } from './domains/growth-profiles/recompute.js';
import { runTouchRuleEngine as runTouchRuleEngineImpl } from './domains/growth-touch-rules/engine.js';
import { seedDefaultTouchRules } from './domains/growth-touch-rules/seed-default-rules.js';
import { upsertCustomer as upsertCustomerImpl } from './domains/growth-customers/upsert.js';
import { autoBackfillSmsActions as autoBackfillSmsActionsImpl } from './domains/growth-customers/sms-backfill.js';
import { backfillRedemptionAmounts as backfillRedemptionAmountsImpl } from './domains/growth-customers/redemption-backfill.js';
import { createGrowthWecom } from './domains/growth-wecom/service.js';
import {
  loadSegmentPhoneSet,
  fetchGenericRuleCandidates,
} from './domains/growth-touch-rules/helpers.js';
export {
  fmtYmd,
  loadRuleCandidates,
  filterGenericRuleCandidates,
  fetchGenericRuleCandidates,
  loadSegmentPhoneSet,
} from './domains/growth-touch-rules/helpers.js';
import { buildGrowthDailyReport } from './domains/growth-ops/daily-report.js';
import { startGrowthRemindWorkers } from './domains/growth-ops/background-remind.js';
import { startGrowthAudienceWorkers } from './domains/growth-ops/background-audience.js';
import { startGrowthMiscTimers } from './domains/growth-ops/background-timers.js';
export { buildGrowthDailyReport } from './domains/growth-ops/daily-report.js';
import { buildRemindTargetsQuery } from './domains/growth-stored-value/helpers.js';
export { buildRemindTargetsQuery } from './domains/growth-stored-value/helpers.js';
import { runForActiveTenants, tenantContext, resolveTenantIdDefault } from './utils/database.js';
import { initSmsTemplatesCache } from './sms-templates.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'growth-api' });
const _storeId = (brandName) => _ALL_STORES.find(s => s.brandName === brandName)?.storeId || '';

// 订阅消息推送网关（方案B）：HRMS 自己没有小程序 access_token，发不了订阅消息，
// 改为 POST 到云函数 growthSubscribePush（云开发 HTTP 访问服务暴露的 URL），
// 由小程序侧复用 sendSubscribeMessage 真正下发。URL 配在 env HRMS_SUBSCRIBE_PUSH_URL。
function subscribePushUrl() {
  return cleanText(process.env.HRMS_SUBSCRIBE_PUSH_URL || '', 500);
}
function isSubscribePushConfigured() {
  return !!subscribePushUrl() && !!cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
}
// 与召回短信回调同一套密钥口径，云函数侧用 X-Miniprogram-Sync-Secret 校验。
async function postSubscribePush(body) {
  const url = subscribePushUrl();
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': secret },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    let json = {};
    try { json = await resp.json(); } catch (e) { json = {}; }
    return { httpStatus: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

// 小程序站内推券网关：HRMS 策略 → 调云函数 growthMemberCoupon → 给会员发券进卡包。
// URL 配在 env HRMS_MEMBER_COUPON_PUSH_URL，密钥与订阅推送同口径。
function memberCouponPushUrl() {
  return cleanText(process.env.HRMS_MEMBER_COUPON_PUSH_URL || '', 500);
}
function isMemberCouponPushConfigured() {
  return !!memberCouponPushUrl() && !!cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
}
async function postMemberCouponPush(body) {
  const url = memberCouponPushUrl();
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': secret },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    let json = {};
    try { json = await resp.json(); } catch (e) { json = {}; }
    return { httpStatus: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

function authMiniProgramSync(req) {
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || '', 500);
  if (!secret) return { ok: false, status: 503, error: 'miniprogram_sync_disabled' };
  const headerSecret = cleanText(req.headers['x-miniprogram-sync-secret'] || '', 500);
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const signature = cleanText(req.headers['x-signature'] || '', 128);
  const timestamp = cleanText(req.headers['x-timestamp'] || '', 32);
  const requestId = cleanText(req.headers['x-request-id'] || '', 128);
  const tenantId = cleanText(req.headers['x-tenant-id'] || '', 128);
  const storeId = cleanText(req.headers['x-store-id'] || '', 128);
  if (signature || timestamp || requestId) {
    const age = Math.abs(Date.now() - Number(timestamp));
    const bodyText = JSON.stringify(req.body && typeof req.body === 'object' ? req.body : {});
    const bodyHash = crypto.createHash('sha256').update(bodyText).digest('hex');
    const material = [timestamp, requestId, tenantId, storeId, bodyHash].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(material).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (!timestamp || !requestId || sigBuf.length !== expectedBuf.length || !Number.isFinite(age) || age > 5 * 60 * 1000 || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return { ok: false, status: 401, error: 'invalid_miniprogram_signature' };
    const allowed = String(process.env.HRMS_ALLOWED_TENANT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length && (!tenantId || !allowed.includes(tenantId))) return { ok: false, status: 403, error: 'tenant_not_assigned_to_server' };
    return { ok: true };
  }
  if (String(process.env.MINIPROGRAM_SIGNATURE_REQUIRED || 'false').toLowerCase() === 'true') return { ok: false, status: 401, error: 'miniprogram_signature_required' };
  if (headerSecret === secret || bearer === secret) return { ok: true };
  if (bearer && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
      if (decoded && decoded.username) return { ok: true };
    } catch (e) { /* ignore */ }
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

let _growthTablesDeprecationLogged = false;

export async function ensureGrowthTables(pool) {
  if (!_growthTablesDeprecationLogged) {
    log.warn({ msg: 'ensure_growth_tables_deprecated' });
    _growthTablesDeprecationLogged = true;
  }
  await seedDefaultTouchRules(pool);
}

export async function upsertCustomer(pool, payload, tenantId = 'default') {
  return upsertCustomerImpl(pool, payload, tenantId, { cleanText, cleanPhone });
}

async function backfillRedemptionAmounts(pool) {
  return backfillRedemptionAmountsImpl(pool);
}

// T+7 SMS自动回填：找已发送7天以上且无outcome_summary的短信AI建议，
// 按customer_id+store_id+7天窗口匹配核销数据，自动打分写回并沉淀经验库(is_verified=true)。
async function autoBackfillSmsActions(pool) {
  return autoBackfillSmsActionsImpl(pool, { cleanText, resolveTenantIdDefault, log });
}

export async function appendExecutionLog(pool, payload) {
  await pool.query(
    `INSERT INTO growth_execution_logs (
      action_key, strategy_key, store_id, action_type, decision,
      operator_username, operator_role, before_payload, after_payload,
      decision_reason, result_summary, tenant_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
    [
      cleanText(payload.action_key, 255),
      cleanText(payload.strategy_key, 255),
      cleanText(payload.store_id, 128),
      cleanText(payload.action_type, 80),
      cleanText(payload.decision, 80),
      cleanText(payload.operator_username, 128),
      cleanText(payload.operator_role, 80),
      JSON.stringify(payload.before_payload || {}),
      JSON.stringify(payload.after_payload || {}),
      cleanText(payload.decision_reason, 2000),
      cleanText(payload.result_summary, 2000),
      resolveTenantIdDefault()
    ]
  );
}

export async function insertGrowthEvent(pool, payload, tenantId = 'default') {
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  await pool.query(
    `INSERT INTO growth_events (
       event_type, customer_id, phone, openid, external_userid, store_id, campaign_id, channel,
       coupon_id, order_id, amount_fen, idempotency_key, metadata, occurred_at, tenant_id
     ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,NULLIF($12,''),$13::jsonb,$14,$15)
     ON CONFLICT (idempotency_key, tenant_id) DO NOTHING`,
    [
      cleanText(payload.event_type, 80),
      payload.customer_id ? Number(payload.customer_id) : null,
      cleanPhone(payload.phone),
      cleanText(payload.openid, 128),
      cleanText(payload.external_userid, 128),
      cleanText(payload.store_id, 128),
      cleanText(payload.campaign_id, 128),
      cleanText(payload.channel, 80),
      cleanText(payload.coupon_id, 128),
      cleanText(payload.order_id, 128),
      Math.max(0, Math.floor(Number(payload.amount_fen) || 0)),
      cleanText(payload.idempotency_key, 255),
      JSON.stringify(metadata),
      parseOccurredAt(payload.occurred_at),
      tenantId
    ]
  );
}

export async function upsertDeliveryLog(pool, payload, tenantId = 'default') {
  const r = await pool.query(
    `INSERT INTO growth_delivery_logs (
       delivery_key, action_key, rule_key, campaign_id, customer_id, store_id, channel,
       external_userid, provider_msg_id, status, payload, result, error_message, updated_at, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,NOW(),$14)
     ON CONFLICT (delivery_key, tenant_id) DO UPDATE SET
       provider_msg_id = COALESCE(NULLIF(EXCLUDED.provider_msg_id,''), growth_delivery_logs.provider_msg_id),
       status = EXCLUDED.status,
       result = EXCLUDED.result,
       error_message = EXCLUDED.error_message,
       updated_at = NOW()
     RETURNING *`,
    [
      cleanText(payload.delivery_key, 255),
      cleanText(payload.action_key, 255),
      cleanText(payload.rule_key, 128),
      cleanText(payload.campaign_id, 128) || cleanText(payload.rule_key, 128),
      payload.customer_id ? Number(payload.customer_id) : null,
      cleanText(payload.store_id, 128),
      cleanText(payload.channel || 'wecom', 40),
      cleanText(payload.external_userid, 128),
      cleanText(payload.provider_msg_id, 255),
      cleanText(payload.status || 'pending', 40),
      JSON.stringify(payload.payload || {}),
      JSON.stringify(payload.result || {}),
      cleanText(payload.error_message, 2000),
      tenantId
    ]
  );
  return r.rows[0] || null;
}

const {
  getWecomConfig,
  getStoreWecomConfig,
  getAllStoreWecomConfigs,
  getWecomAccessToken,
  sendWecomExternalMessage,
  resolveTenantIdForStore,
  resetGrowthWecomTokenCache,
  clearStoreWecomTokenCache,
} = createGrowthWecom({ cleanText });

export {
  getWecomConfig,
  getStoreWecomConfig,
  getAllStoreWecomConfigs,
  getWecomAccessToken,
  resolveTenantIdForStore,
  resetGrowthWecomTokenCache,
  clearStoreWecomTokenCache,
};

// 飞书多维表字段值解析(文本/数字/日期/电话)
export function bitText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text || x.name)) || x).join(',');
  if (typeof v === 'object') return String(v.text || v.name || '');
  return String(v);
}
export function bitNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.text != null) return Number(v.text) || 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
export function bitDateMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!isNaN(n) && n > 1e10) return n; // epoch ms
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
export function bitPhone(v) { return bitText(v).replace(/[^0-9]/g, ''); }

// 用 BITABLE_TASK_RESP 飞书应用获取 tenant_access_token(该应用对储值客户表有读权限)
async function getBitableTenantToken() {
  const id = process.env.BITABLE_TASK_RESP_APP_ID;
  const secret = process.env.BITABLE_TASK_RESP_APP_SECRET;
  if (!id || !secret) throw new Error('bitable_app_not_configured');
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: id, app_secret: secret })
  });
  const d = await r.json();
  if (!d.tenant_access_token) throw new Error('bitable_token_failed:' + (d.code || '') + ' ' + (d.msg || ''));
  return d.tenant_access_token;
}
// 分页读「储值客户」多维表全部记录
export async function readStoredValueBitableRecords() {
  const appToken = process.env.STORED_VALUE_BITABLE_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe';
  const tableId = process.env.STORED_VALUE_BITABLE_TABLE_ID || 'tblvAcEjXHmEYQGZ';
  const token = await getBitableTenantToken();
  let all = [];
  let pageToken = '';
  for (let i = 0; i < 500; i++) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500` + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const d = await (await fetch(url, { headers: { Authorization: 'Bearer ' + token } })).json();
    if (d.code !== 0) throw new Error('bitable_read_failed:' + d.code + ' ' + d.msg);
    all = all.concat((d.data && d.data.items) || []);
    if (d.data && d.data.has_more && d.data.page_token) pageToken = d.data.page_token; else break;
  }
  return all;
}

export async function executeGrowthActionRecord(pool, before, operator, extraPayload = {}, reason = '') {
  const tenantId = String(before.tenant_id || 'default').trim() || 'default';
  const basePayload = before.payload && typeof before.payload === 'object' ? before.payload : {};
  const payload = Object.assign({}, basePayload, extraPayload || {});
  const storeId = cleanText(before.store_id || payload.store_id, 128);
  const campaignId = cleanText(before.campaign_id || payload.campaign_id, 128);
  const actionType = cleanText(before.action_type, 80);
  const actionKey = cleanText(before.action_key, 255);
  let executionResults = { action_type: actionType, real_executions: [] };

  const ctx = {
    pool, before, payload, storeId, campaignId, actionType, actionKey, tenantId, operator, executionResults,
    cleanText, cleanPhone, buildActionMessage, sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam, pickSmsTemplateByStore,
    globalSmsCapped, isPhoneSuppressed, sendAliyunSms, handleSmsFailure,
    isSubscribePushConfigured, postSubscribePush,
    isMemberCouponPushConfigured, postMemberCouponPush,
  };

  try {
    await applyGrowthActionTypeEffects(ctx);
    await deliverGrowthActionChannels(ctx);
  } catch (execErr) {
    executionResults.error = execErr?.message;
  }

  const result = await pool.query(
    `UPDATE growth_actions
     SET status = 'executed',
         payload = CASE WHEN $2::jsonb = '{}'::jsonb THEN payload ELSE COALESCE(payload,'{}'::jsonb) || $2::jsonb END,
         updated_at = NOW(),
         executed_at = NOW()
     WHERE action_key = $1
     RETURNING *`,
    [actionKey, JSON.stringify(Object.assign({}, payload, executionResults))]
  );
  await appendExecutionLog(pool, {
    action_key: actionKey,
    strategy_key: cleanText(basePayload.strategy_key || payload.strategy_key || '', 255),
    store_id: storeId,
    action_type: actionType,
    decision: 'executed',
    operator_username: operator.username,
    operator_role: operator.role,
    before_payload: basePayload,
    after_payload: result.rows[0]?.payload || {},
    decision_reason: cleanText(reason, 2000),
    result_summary: `真实执行: ${executionResults.real_executions.map((e) => `${e.type}=${Object.values(e).slice(1).join(',')}`).join('; ') || 'none'}`
  });
  return { action: result.rows[0], execution: executionResults };
}

export async function recomputeDiningSegments(pool, tenantId = 'default') {
  const BJ = "AT TIME ZONE 'Asia/Shanghai'";
  const hj = `LEFT JOIN cn_holiday_calendar h ON h.day=(order_time ${BJ})::date AND h.day_type='holiday'
              LEFT JOIN cn_holiday_calendar w ON w.day=(order_time ${BJ})::date AND w.day_type='workday'`;
  const eff = `((extract(dow from order_time ${BJ}) BETWEEN 1 AND 5 AND h.day IS NULL) OR w.day IS NOT NULL)`;
  const mjSid = _storeId('马己仙');
  const hcSid = _storeId('洪潮');
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='mj_dinner_weekend_repeat' AND tenant_id=$1`, [tenantId]);
  const mj = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id,tenant_id)
    SELECT phone,'mj_dinner_weekend_repeat','${mjSid}',$1 FROM (
      SELECT phone,
        count(*) FILTER (WHERE extract(hour from order_time ${BJ})>=16) dinner,
        count(*) FILTER (WHERE extract(dow from order_time ${BJ}) IN (0,6)) weekend
      FROM pos_orders WHERE store_id='${mjSid}' AND order_time IS NOT NULL AND phone<>'' AND tenant_id=$1 GROUP BY phone
    ) t WHERE dinner>=2 OR weekend>=2 ON CONFLICT DO NOTHING`, [tenantId]);
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='hc_weekday_lunch' AND tenant_id=$1`, [tenantId]);
  const hc = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id,tenant_id)
    SELECT DISTINCT phone,'hc_weekday_lunch','${hcSid}',$1 FROM (
      SELECT phone FROM pos_orders ${hj} WHERE store_id='${hcSid}' AND order_time IS NOT NULL AND phone<>'' AND pos_orders.tenant_id=$1
        AND ${eff} AND extract(hour from order_time ${BJ}) BETWEEN 10 AND 15
    ) t ON CONFLICT DO NOTHING`, [tenantId]);
  return { mj_dinner_weekend_repeat: mj.rowCount, hc_weekday_lunch: hc.rowCount };
}

const touchRuleEngineDeps = {
  executeGrowthActionRecord,
  isMemberCouponPushConfigured,
  isSubscribePushConfigured,
  log,
};

export async function runTouchRuleEngine(pool, options = {}) {
  return runTouchRuleEngineImpl(pool, options, touchRuleEngineDeps);
}

let _sendGrowthAlert = null;
export function setSendGrowthAlert(fn) { _sendGrowthAlert = fn; }
export function getSendGrowthAlert() { return _sendGrowthAlert; }

export function requireGrowthAuth(req, res) {
  const auth = authMiniProgramSync(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error });
    return false;
  }
  return true;
}

// 一些写操作(审批营销实验/删除共享素材)之前只检查"是否登录"，没检查角色——
// 任何门店角色(如收银员)登录后都能做。'system' 覆盖共享密钥的机器对机器调用
// (getGrowthOperator 在没有真实用户JWT时会给这个角色)。
const GROWTH_ADMIN_WRITE_ROLES = ['admin', 'hq_manager', 'system'];
export function requireGrowthAdminRole(req, res) {
  const role = String(getGrowthOperator(req).role || '').trim();
  if (!GROWTH_ADMIN_WRITE_ROLES.includes(role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: '仅管理员/总部可执行此操作' });
    return false;
  }
  return true;
}

export function getGrowthOperator(req) {
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !process.env.JWT_SECRET) return { username: 'system', role: 'system' };
  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    return {
      username: cleanText(decoded.username || 'system', 128),
      role: cleanText(decoded.role || 'system', 80)
    };
  } catch (_) {
    return { username: 'system', role: 'system' };
  }
}

// 增长接口走小程序同步密钥鉴权(authMiniProgramSync)，不经过用户JWT中间件，
// 故req.tenantId不会自动有值。这里复用Bearer token(若管理端带了)解出tenant_id，
// 取不到则归default——与现网单租户行为一致，零风险。
export function getGrowthTenantId(req) {
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !process.env.JWT_SECRET) return 'default';
  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    return cleanText(decoded.tenant_id || 'default', 80) || 'default';
  } catch (_) {
    return 'default';
  }
}

// 供跨模块(如拆分出的 touch-rules/winback 路由)读取"涉及会员数"缓存：由 registerGrowthRoutes
// 内部的 computeTouchRulesAudience/refreshTouchRulesAudienceCache 通过 setTouchRulesAudienceGetter
// 注入实现，避免重复维护同一份缓存 Map(与 setSendGrowthAlert 同一模式)。
let _getTouchRulesAudience = null;
export function setTouchRulesAudienceGetter(fn) { _getTouchRulesAudience = fn; }
export async function getTouchRulesAudience(tenantId, storeId, forceRefresh) {
  if (!_getTouchRulesAudience) throw new Error('touch_rules_audience_not_ready');
  return _getTouchRulesAudience(tenantId, storeId, forceRefresh);
}

// 供本文件内的企微联系人定时同步任务调用：实现已搬到 growth-wecom-feishu-routes.js，
// 通过 setSyncWecomContactsForStore 注入，避免与该文件的 import.growth-api.js 形成循环依赖。
let _syncWecomContactsForStore = null;
export function setSyncWecomContactsForStore(fn) { _syncWecomContactsForStore = fn; }
async function syncWecomContactsForStore(pool, storeConfig) {
  if (!_syncWecomContactsForStore) throw new Error('sync_wecom_contacts_not_ready');
  return _syncWecomContactsForStore(pool, storeConfig);
}

export function registerGrowthRoutes(app, pool) {
  initSmsTemplatesCache(pool);
  const deps = {
    pool,
    log,
    runForActiveTenants,
    tenantContext,
    resolveTenantIdDefault,
    cleanText,
    cleanPhone,
    inSmsQuietHours,
    isPhoneSuppressed,
    globalSmsCapped,
    upsertDeliveryLog,
    insertGrowthEvent,
    sendAliyunSms,
    handleSmsFailure,
    upsertCustomer,
    resolveTenantIdForStore,
    pickBalanceTemplateByStore,
    isAliyunSmsAutoSendEnabled,
    freqDaysEnv,
    buildRemindTargetsQuery,
    autoBackfillSmsActions,
    recomputeCustomerProfiles,
    backfillRedemptionAmounts,
    runTouchRuleEngine,
    getAllStoreWecomConfigs,
    syncWecomContactsForStore,
    buildGrowthDailyReport,
    setTouchRulesAudienceGetter,
    sendGrowthAlert: (...args) => (_sendGrowthAlert ? _sendGrowthAlert(...args) : null),
    hasSendGrowthAlert: () => !!_sendGrowthAlert,
    loadSegmentPhoneSet,
    fetchGenericRuleCandidates,
  };
  startGrowthRemindWorkers(deps);
  startGrowthAudienceWorkers(deps);
  startGrowthMiscTimers(deps);
}

