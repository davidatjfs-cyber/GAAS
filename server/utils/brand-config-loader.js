/**
 * 品牌配置数据库化加载器。
 *
 * 设计取舍：现有数十处硬编码调用点(agents.js等)绝大多数是同步对象查找
 * (BRAND_CONFIG[brand]这种)，散布在同步/异步函数都有，部分还在很深的调用链里
 * (如agents.js的handleAgentMessage聊天处理入口、index.js的考勤/预测工具函数)，
 * 把tenantId参数一路传到底要改的文件和函数太多，风险远超收益。因此采用
 * "周期性后台刷新+同步读缓存，tenantId可选"：
 * - 进程启动时拉一次全部租户的数据，之后每5分钟自动刷新；
 * - 每个查找函数最后一个参数是可选的tenantId：传了就精确按该租户查找；
 *   不传则在全部租户里找——只有一个租户在用(今天就是这种情况)时结果完全不变，
 *   真出现多个租户都有同名门店/品牌key这种"裸查找"撞车的情况，会打印告警日志
 *   (而不是默默把数据归到错误的租户上)，方便在出真实事故前发现。
 * - 已确认有tenantId上下文的调用点(cron任务循环、HTTP路由)，本次会传入；
 *   深层工具函数暂时靠上面的"裸查找+告警"兜底，是已知的、刻意保留的折中。
 *
 * 启动后第一次DB查询完成前的极短窗口里，用与原硬编码完全一致的值兜底，
 * 确保"数据库还没就绪"不会导致和现在不一样的结果。
 *
 * 存储位置：数据存在已有的通用 tenant_config 表(tenant_key/config_key/config_value)里，
 * 不用专门的品牌表——config_key='store_brands'存门店清单，
 * config_key='brand_config_<brand_key>'存该品牌的config_json。
 * 不再像之前那样只读tenant_key='default'一个租户，而是读全部租户的这两类
 * config_key，每行数据打上其来源tenant_key，供按租户查找用。
 */
import { pool } from './database.js';

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_TENANT = 'default';

// 兜底值：与重构前agents.js/brands-config.js等文件里的硬编码原值保持一致，
// 仅在进程刚启动、尚未完成第一次DB读取时使用。全部标记为default租户。
const BOOTSTRAP_STORE_BRANDS = [
  { tenant_id: DEFAULT_TENANT, store_id: '51866138', store_name: '马己仙上海音乐广场店', brand_key: 'majixian', brand_name: '马己仙', sms_suffix: 'MAJIXIAN', has_takeaway: true, punch_start_minutes: 540, punch_end_minutes: 1320 },
  { tenant_id: DEFAULT_TENANT, store_id: '64822111', store_name: '洪潮大宁久光店', brand_key: 'hongchao', brand_name: '洪潮', sms_suffix: 'HONGCHAO', has_takeaway: false, punch_start_minutes: 555, punch_end_minutes: 1260 }
];
const BOOTSTRAP_BRAND_CONFIGS = [
  { tenant_id: DEFAULT_TENANT, brand_key: 'hongchao', brand_name: '洪潮', config_json: {} },
  { tenant_id: DEFAULT_TENANT, brand_key: 'majixian', brand_name: '马己仙', config_json: {} }
];

let _storeBrands = BOOTSTRAP_STORE_BRANDS;
let _brandConfigs = BOOTSTRAP_BRAND_CONFIGS;
let _lastLoadAt = 0;
let _loadingPromise = null;

// 裸查找(不传tenantId)撞到多个不同租户的同名门店/品牌key时，限频告警，避免刷屏。
const _ambiguityWarnedAt = new Map();
function warnAmbiguous(kind, key, tenantIds) {
  const mapKey = `${kind}:${key}`;
  const now = Date.now();
  const last = _ambiguityWarnedAt.get(mapKey) || 0;
  if (now - last < 10 * 60 * 1000) return;
  _ambiguityWarnedAt.set(mapKey, now);
  console.warn(
    `[brand-config-loader] 裸查找(未传tenantId)"${key}"在多个租户下都有匹配(${kind})：${tenantIds.join(',')}——已按第一个匹配返回，调用方应尽快补上明确的tenantId参数，避免数据被错误归到其它租户。`
  );
}

async function refresh() {
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      const res = await pool().query(
        "SELECT tenant_key, config_key, config_value FROM tenant_config WHERE config_key = 'store_brands' OR config_key LIKE 'brand_config_%'"
      );
      const storeBrandsRows = res.rows.filter((r) => r.config_key === 'store_brands');
      const brandConfigRows = res.rows.filter((r) => r.config_key.startsWith('brand_config_'));

      const nextStoreBrands = [];
      for (const row of storeBrandsRows) {
        if (Array.isArray(row.config_value)) {
          for (const sb of row.config_value) {
            nextStoreBrands.push({ ...sb, tenant_id: row.tenant_key });
          }
        }
      }
      if (nextStoreBrands.length) _storeBrands = nextStoreBrands;

      if (brandConfigRows.length) {
        _brandConfigs = brandConfigRows.map((r) => {
          const brandKey = r.config_key.slice('brand_config_'.length);
          const { brandName, ...configJson } = r.config_value || {};
          return { tenant_id: r.tenant_key, brand_key: brandKey, brand_name: brandName, config_json: configJson };
        });
      }
      _lastLoadAt = Date.now();
    } catch (e) {
      console.error('[brand-config-loader] refresh failed, keep using previous cache:', e?.message || e);
    } finally {
      _loadingPromise = null;
    }
  })();
  return _loadingPromise;
}

/** 启动时调用一次，尽量在第一批请求到来前完成首次加载；失败不阻塞启动(走兜底值)。 */
export async function initBrandConfigCache() {
  await refresh();
  setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
}

function maybeBackgroundRefresh() {
  if (Date.now() - _lastLoadAt > REFRESH_MS) refresh().catch(() => {});
}

/** 在候选行里按tenantId过滤；不传tenantId则原样返回全部候选(裸查找)。 */
function scopeToTenant(rows, tenantId) {
  if (!tenantId) return rows;
  return rows.filter((r) => r.tenant_id === tenantId);
}

/** 按门店ID或任意含品牌名的文本(店名/对话文本等)反查品牌。查不到返回null。
 *  传tenantId精确查找该租户；不传则全租户裸查找(单租户场景下行为不变)。 */
export function getBrandForStoreSync(storeIdOrText, tenantId) {
  maybeBackgroundRefresh();
  const s = String(storeIdOrText || '').trim();
  if (!s) return null;
  const pool_ = scopeToTenant(_storeBrands, tenantId);
  let candidates = pool_.filter((r) => r.store_id === s || r.store_name === s);
  if (!candidates.length) candidates = pool_.filter((r) => s.includes(r.brand_name));
  if (!candidates.length) return null;
  if (!tenantId) {
    const distinctTenants = [...new Set(candidates.map((r) => r.tenant_id))];
    if (distinctTenants.length > 1) warnAmbiguous('store', s, distinctTenants);
  }
  const row = candidates[0];
  return {
    tenantId: row.tenant_id,
    brandKey: row.brand_key, brandName: row.brand_name, storeId: row.store_id, storeName: row.store_name, smsSuffix: row.sms_suffix,
    hasTakeaway: row.has_takeaway !== false,
    punchStartMinutes: Number.isFinite(row.punch_start_minutes) ? row.punch_start_minutes : null,
    punchEndMinutes: Number.isFinite(row.punch_end_minutes) ? row.punch_end_minutes : null
  };
}

/** 按brand_key或品牌中文名取该品牌的config_json(已展开)。查不到返回null——调用方需自行决定安全默认值，不要静默归并到某个具体品牌。
 *  传tenantId精确查找该租户；不传则全租户裸查找(单租户场景下行为不变)。 */
export function getBrandConfigSync(brandKeyOrName, tenantId) {
  maybeBackgroundRefresh();
  const k = String(brandKeyOrName || '').trim();
  if (!k) return null;
  const candidates = scopeToTenant(_brandConfigs, tenantId).filter((r) => r.brand_key === k || r.brand_name === k);
  if (!candidates.length) return null;
  if (!tenantId) {
    const distinctTenants = [...new Set(candidates.map((r) => r.tenant_id))];
    if (distinctTenants.length > 1) warnAmbiguous('brand', k, distinctTenants);
  }
  const row = candidates[0];
  return { tenantId: row.tenant_id, brandKey: row.brand_key, brandName: row.brand_name, ...(row.config_json || {}) };
}

/** 仅做精确门店名/ID匹配(不做品牌名子串兜底)；查不到返回null，调用方应自行决定默认值。
 *  传tenantId精确查找该租户；不传则全租户裸查找(单租户场景下行为不变)。 */
export function getStoreHasTakeawaySync(storeNameOrId, tenantId) {
  maybeBackgroundRefresh();
  const s = String(storeNameOrId || '').trim();
  if (!s) return null;
  const candidates = scopeToTenant(_storeBrands, tenantId).filter((r) => r.store_id === s || r.store_name === s);
  if (!candidates.length) return null;
  if (!tenantId) {
    const distinctTenants = [...new Set(candidates.map((r) => r.tenant_id))];
    if (distinctTenants.length > 1) warnAmbiguous('store', s, distinctTenants);
  }
  return candidates[0].has_takeaway !== false;
}

/** 传tenantId只返回该租户的品牌key；不传则返回全部租户去重后的品牌key列表(单租户场景下行为不变)。 */
export function getAllBrandKeysSync(tenantId) {
  maybeBackgroundRefresh();
  const rows = scopeToTenant(_brandConfigs, tenantId);
  return [...new Set(rows.map((r) => r.brand_key))];
}

/** 传tenantId只返回该租户的品牌名；不传则返回全部租户去重后的品牌名列表(单租户场景下行为不变)。 */
export function getAllBrandNamesSync(tenantId) {
  maybeBackgroundRefresh();
  const rows = scopeToTenant(_brandConfigs, tenantId);
  return [...new Set(rows.map((r) => r.brand_name).filter(Boolean))];
}

/** 仅供测试/迁移脚本使用：强制下一次访问立刻重新拉取。 */
export function clearBrandConfigCache() {
  _lastLoadAt = 0;
}
