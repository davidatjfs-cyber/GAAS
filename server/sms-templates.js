// 短信模板/签名配置的运行时解析层。
//
// 背景（2026-07 事故复盘）：模板code/签名以前只放在 .env 里，Node 进程只在启动时读一次
// process.env——运营改完 .env 不重启进程，老进程会继续用内存里的旧值，不报错、也没有
// 任何提示，曾导致改完配置后还继续发了几天旧模板/超70字短信。
// 现在改为：配置存 sms_templates 表，本模块维护一份内存缓存，每 60 秒自动从库刷新一次，
// 管理端写入后立即调 invalidateSmsTemplatesCache() 强制刷新——配置变更最多 60 秒、
// 或写入后立即生效，永远不需要重启进程。
// 找不到DB配置时（表还没灌数据/新slot还没建）回退读 env，兼容过渡期。
import { getStoreSmsEnvSuffix } from './brands-config.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'sms-templates' });

let _pool = null;
let _cache = new Map(); // key: `${tenant_id}:${brand_suffix}:${slot}` -> row
let _timer = null;
const REFRESH_MS = 60 * 1000;

export async function refreshSmsTemplatesCache() {
  if (!_pool) return;
  const r = await _pool.query(
    `SELECT tenant_id, brand_suffix, slot, template_code, sign_name, content, vars, char_len
       FROM sms_templates WHERE is_active`
  );
  const next = new Map();
  for (const row of r.rows || []) {
    next.set(`${row.tenant_id}:${row.brand_suffix}:${row.slot}`, row);
  }
  _cache = next;
}

export function initSmsTemplatesCache(pool) {
  _pool = pool;
  refreshSmsTemplatesCache().catch((e) => log.warn({ msg: 'initial_cache_load_failed', err: e?.message }));
  if (!_timer) {
    _timer = setInterval(() => {
      refreshSmsTemplatesCache().catch((e) => log.warn({ msg: 'cache_refresh_failed', err: e?.message }));
    }, REFRESH_MS);
  }
}

// 管理端写入后调用，让改动立即生效（不等下一次60s轮询）。
export function invalidateSmsTemplatesCache() {
  return refreshSmsTemplatesCache();
}

function envFallback(slot, suffix) {
  if (slot === 'SIGN') {
    if (suffix === 'MAJIXIAN') return { template_code: '', sign_name: String(process.env.ALIYUN_SMS_SIGN_MAJIXIAN || '马己仙').trim(), content: '' };
    if (suffix === 'HONGCHAO') return { template_code: '', sign_name: String(process.env.ALIYUN_SMS_SIGN_HONGCHAO || '上海连年由喜餐饮管理').trim(), content: '' };
    return { template_code: '', sign_name: String(process.env.ALIYUN_SMS_SIGN_NAME || '').trim(), content: '' };
  }
  const def = String(process.env[`ALIYUN_SMS_${slot}_DEFAULT`] || '').trim();
  const code = String(process.env[`ALIYUN_SMS_${slot}_${suffix}`] || '').trim() || def;
  return { template_code: code, sign_name: '', content: '' };
}

// 按门店(内部按品牌后缀)+slot 解析模板/签名。tenantId 默认 'default'（本仓库单租户，
// 多租户由 GAAS-demo 负责；表结构已留 tenant_id 列，未来接入时上层只需传真实 tenantId）。
export function getSmsSlot({ tenantId = 'default', storeId = '', slot }) {
  const suffix = getStoreSmsEnvSuffix(storeId);
  const row =
    _cache.get(`${tenantId}:${suffix}:${slot}`) ||
    _cache.get(`${tenantId}:DEFAULT:${slot}`);
  if (row) {
    return {
      template_code: row.template_code || '',
      sign_name: row.sign_name || '',
      content: row.content || '',
      vars: row.vars || [],
      source: 'db'
    };
  }
  return { ...envFallback(slot, suffix), vars: [], source: 'env' };
}

// 阿里云单条短信上限70字（含签名），超过会被拆成多条计费/部分平台直接拒收。
// 注意：现网已报备在用的多条真实模板长度就卡在68~70字（如洪潮ABC系列），
// 阈值只能设成70本身，不能再收紧——收紧会把已经通过阿里云审核、正在用的合法模板挡在外面。
export const SMS_CHAR_LIMIT = 70;

// 签名+正文按示例值替换变量后的可读字数（管理端保存模板时用来拦截超字数模板）。
export function computeSmsCharLen(content, signName, sampleValues = {}) {
  let s = `【${signName || ''}】${content || ''}`;
  s = s.replace(/\$\{(\w+)\}/g, (m, k) => (sampleValues[k] !== undefined ? String(sampleValues[k]) : m));
  return s.length;
}

export async function listSmsTemplates(pool, { tenantId = 'default' } = {}) {
  const r = await pool.query(
    `SELECT id, tenant_id, brand_suffix, slot, template_code, sign_name, content, vars, sample_values,
            char_len, is_active, updated_by, updated_at
       FROM sms_templates WHERE tenant_id = $1 ORDER BY slot, brand_suffix`,
    [tenantId]
  );
  return r.rows || [];
}

export async function upsertSmsTemplate(pool, payload = {}) {
  const tenantId = String(payload.tenant_id || 'default').trim() || 'default';
  const brandSuffix = String(payload.brand_suffix || '').trim().toUpperCase();
  const slot = String(payload.slot || '').trim().toUpperCase();
  if (!brandSuffix || !slot) throw new Error('missing_brand_suffix_or_slot');
  const templateCode = String(payload.template_code || '').trim();
  const signName = String(payload.sign_name || '').trim();
  const content = String(payload.content || '');
  const vars = Array.isArray(payload.vars) ? payload.vars : [];
  const sampleValues = payload.sample_values && typeof payload.sample_values === 'object' ? payload.sample_values : {};
  const charLen = computeSmsCharLen(content, signName, sampleValues);
  if (content && charLen > SMS_CHAR_LIMIT) {
    const err = new Error('sms_template_too_long');
    err.char_len = charLen;
    err.limit = SMS_CHAR_LIMIT;
    throw err;
  }
  const r = await pool.query(
    `INSERT INTO sms_templates (tenant_id, brand_suffix, slot, template_code, sign_name, content, vars, sample_values, char_len, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,now())
     ON CONFLICT (tenant_id, brand_suffix, slot) DO UPDATE SET
       template_code = EXCLUDED.template_code, sign_name = EXCLUDED.sign_name, content = EXCLUDED.content,
       vars = EXCLUDED.vars, sample_values = EXCLUDED.sample_values, char_len = EXCLUDED.char_len,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [tenantId, brandSuffix, slot, templateCode, signName, content, JSON.stringify(vars), JSON.stringify(sampleValues), charLen, String(payload.updated_by || '').trim()]
  );
  await invalidateSmsTemplatesCache();
  return r.rows[0];
}
