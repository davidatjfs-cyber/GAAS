/**
 * 品牌配置数据库化加载器。
 *
 * 设计取舍：现有~75处硬编码调用点(agents.js等)绝大多数是同步对象查找
 * (BRAND_CONFIG[brand]这种)，散布在同步/异步函数都有。把它们全部改成
 * await数据库查询会让改动范围从"替换查找逻辑"扩大成"给上百个函数链路
 * 加async"，风险远超本次重构目标。因此采用"周期性后台刷新+同步读缓存"：
 * 进程启动时拉一次，之后每5分钟自动刷新；消费方仍是同步函数调用，
 * 行为和原来的硬编码对象字面量一致，只是数据来源换成了数据库。
 *
 * 启动后第一次DB查询完成前的极短窗口里，用与原硬编码完全一致的值兜底，
 * 确保"数据库还没就绪"不会导致和现在不一样的结果。
 */
import { pool } from './database.js';

const REFRESH_MS = 5 * 60 * 1000;

// 兜底值：与重构前agents.js/brands-config.js等文件里的硬编码原值保持一致，
// 仅在进程刚启动、尚未完成第一次DB读取时使用。
const BOOTSTRAP_STORE_BRANDS = [
  { store_id: '51866138', store_name: '马己仙上海音乐广场店', brand_key: 'majixian', brand_name: '马己仙', sms_suffix: 'MAJIXIAN', has_takeaway: true, punch_start_minutes: 540, punch_end_minutes: 1320 },
  { store_id: '64822111', store_name: '洪潮大宁久光店', brand_key: 'hongchao', brand_name: '洪潮', sms_suffix: 'HONGCHAO', has_takeaway: false, punch_start_minutes: 555, punch_end_minutes: 1260 }
];
const BOOTSTRAP_BRAND_CONFIGS = [
  { brand_key: 'hongchao', brand_name: '洪潮', config_json: {} },
  { brand_key: 'majixian', brand_name: '马己仙', config_json: {} }
];

let _storeBrands = BOOTSTRAP_STORE_BRANDS;
let _brandConfigs = BOOTSTRAP_BRAND_CONFIGS;
let _lastLoadAt = 0;
let _loadingPromise = null;

async function refresh() {
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      const [storesRes, configsRes] = await Promise.all([
        pool().query('SELECT store_id, store_name, brand_key, brand_name, sms_suffix, has_takeaway, punch_start_minutes, punch_end_minutes FROM store_brands'),
        pool().query('SELECT brand_key, brand_name, config_json FROM brand_configs')
      ]);
      if (storesRes.rows?.length) _storeBrands = storesRes.rows;
      if (configsRes.rows?.length) _brandConfigs = configsRes.rows;
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

/** 按门店ID或任意含品牌名的文本(店名/对话文本等)反查品牌。查不到返回null。 */
export function getBrandForStoreSync(storeIdOrText) {
  maybeBackgroundRefresh();
  const s = String(storeIdOrText || '').trim();
  if (!s) return null;
  let row = _storeBrands.find((r) => r.store_id === s || r.store_name === s);
  if (!row) row = _storeBrands.find((r) => s.includes(r.brand_name));
  if (!row) return null;
  return {
    brandKey: row.brand_key, brandName: row.brand_name, storeId: row.store_id, storeName: row.store_name, smsSuffix: row.sms_suffix,
    hasTakeaway: row.has_takeaway !== false,
    punchStartMinutes: Number.isFinite(row.punch_start_minutes) ? row.punch_start_minutes : null,
    punchEndMinutes: Number.isFinite(row.punch_end_minutes) ? row.punch_end_minutes : null
  };
}

/** 按brand_key或品牌中文名取该品牌的config_json(已展开)。查不到返回null——调用方需自行决定安全默认值，不要静默归并到某个具体品牌。 */
export function getBrandConfigSync(brandKeyOrName) {
  maybeBackgroundRefresh();
  const k = String(brandKeyOrName || '').trim();
  if (!k) return null;
  const row = _brandConfigs.find((r) => r.brand_key === k || r.brand_name === k);
  if (!row) return null;
  return { brandKey: row.brand_key, brandName: row.brand_name, ...(row.config_json || {}) };
}

/** 仅做精确门店名/ID匹配(不做品牌名子串兜底)；查不到返回null，调用方应自行决定默认值。 */
export function getStoreHasTakeawaySync(storeNameOrId) {
  maybeBackgroundRefresh();
  const s = String(storeNameOrId || '').trim();
  if (!s) return null;
  const row = _storeBrands.find((r) => r.store_id === s || r.store_name === s);
  return row ? row.has_takeaway !== false : null;
}

export function getAllBrandKeysSync() {
  maybeBackgroundRefresh();
  return _brandConfigs.map((r) => r.brand_key);
}

/** 仅供测试/迁移脚本使用：强制下一次访问立刻重新拉取。 */
export function clearBrandConfigCache() {
  _lastLoadAt = 0;
}
