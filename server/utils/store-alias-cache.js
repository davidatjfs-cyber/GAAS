/**
 * 门店别名归一化数据库化加载器。
 *
 * 背景：门店名归一化此前分散硬编码在两个仓库共4处(knowledge-graph.js#STORE_NAME_ALIASES、
 * agents-service-v2/store-mapping.js的STORE_TO_FEISHU/GROWTH_STORE_ID_TO_NAME)，新租户
 * 上线要在多处手动加映射，容易漏、漏了也不报错只是数据默默算错。这里改为从
 * store_name_aliases表(migration 096)读取，参照brand-config-loader.js同款"周期性
 * 后台刷新+同步读缓存"设计——现有调用点绝大多数是同步查找，把tenantId一路传到底
 * 改动风险远超收益，所以维持同步接口，tenantId可选(不传则全租户裸查找，单租户场景
 * 行为不变，多租户撞车时打印告警而不是静默用错租户的数据)。
 *
 * 启动后第一次DB查询完成前的极短窗口，用与原硬编码完全一致的兜底值，确保
 * "数据库还没就绪"不会导致和现在不一样的结果。
 */
import { pool, runWithSystemTenantContext } from './database.js';
import { childLogger } from './logger.js';

const log = childLogger({ domain: 'store-alias-cache' });

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_TENANT = 'default';

// 兜底值：与重构前knowledge-graph.js/store-mapping.js里的硬编码原值保持一致。
const BOOTSTRAP_ALIASES = [
  { tenant_id: DEFAULT_TENANT, canonical_name: '洪潮大宁久光店', alias_name: '洪潮大宁久光店', source: 'canonical' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '洪潮大宁久光店', alias_name: '洪潮久光店', source: 'feishu' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '洪潮大宁久光店', alias_name: '洪潮', source: 'brand' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '洪潮大宁久光店', alias_name: '64822111', source: 'growth_id' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '洪潮大宁久光店', alias_name: '大宁久光', source: 'fuzzy' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '马己仙上海音乐广场店', alias_name: '马己仙上海音乐广场店', source: 'canonical' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '马己仙上海音乐广场店', alias_name: '马己仙大宁店', source: 'feishu' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '马己仙上海音乐广场店', alias_name: '马己仙', source: 'brand' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '马己仙上海音乐广场店', alias_name: '51866138', source: 'growth_id' },
  { tenant_id: DEFAULT_TENANT, canonical_name: '马己仙上海音乐广场店', alias_name: '音乐广场', source: 'fuzzy' },
];

let _aliases = BOOTSTRAP_ALIASES;
let _lastLoadAt = 0;
let _loadingPromise = null;

function normKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

const _ambiguityWarnedAt = new Map();
function warnAmbiguous(key, tenantIds) {
  const now = Date.now();
  const last = _ambiguityWarnedAt.get(key) || 0;
  if (now - last < 10 * 60 * 1000) return;
  _ambiguityWarnedAt.set(key, now);
  log.warn({ msg: 'ambiguous_alias_without_tenant', key, tenant_ids: tenantIds });
}

async function refresh() {
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      const res = await runWithSystemTenantContext(() =>
        pool().query(
          `SELECT tenant_id, canonical_name, alias_name, source FROM store_name_aliases WHERE enabled = TRUE`
        )
      );
      if (res.rows?.length) _aliases = res.rows;
      _lastLoadAt = Date.now();
    } catch (e) {
      log.error({ msg: 'refresh_failed', err: e?.message || String(e) });
    } finally {
      _loadingPromise = null;
    }
  })();
  return _loadingPromise;
}

/** 启动时调用一次，尽量在第一批请求到来前完成首次加载；失败不阻塞启动(走兜底值)。 */
export async function initStoreAliasCache() {
  await refresh();
  setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
}

function maybeBackgroundRefresh() {
  if (Date.now() - _lastLoadAt > REFRESH_MS) refresh().catch(() => {});
}

function scopeToTenant(rows, tenantId) {
  if (!tenantId) return rows;
  return rows.filter((r) => r.tenant_id === tenantId);
}

/** 输入任意别名/规范名，返回规范门店名；查不到原样返回输入(与此前硬编码兜底行为一致)。
 *  传tenantId精确查找该租户；不传则全租户裸查找(单租户场景下行为不变)。 */
export function resolveCanonicalStoreNameSync(rawName, tenantId) {
  maybeBackgroundRefresh();
  const s = String(rawName || '').trim();
  if (!s) return s;
  const k = normKey(s);
  const candidates = scopeToTenant(_aliases, tenantId).filter((r) => normKey(r.alias_name) === k);
  if (!candidates.length) return s;
  if (!tenantId) {
    const distinctTenants = [...new Set(candidates.map((r) => r.tenant_id))];
    if (distinctTenants.length > 1) warnAmbiguous(s, distinctTenants);
  }
  return candidates[0].canonical_name;
}

/** 给定规范店名，返回该门店指定来源(如'feishu')的别名；查不到返回规范名本身。 */
export function resolveAliasBySourceSync(canonicalName, source, tenantId) {
  maybeBackgroundRefresh();
  const rows = scopeToTenant(_aliases, tenantId).filter(
    (r) => r.canonical_name === canonicalName && r.source === source
  );
  return rows.length ? rows[0].alias_name : canonicalName;
}

/** 子串包含式匹配：用于自由文本(聊天输入)反查门店，比精确匹配更宽松——
 *  按别名长度降序尝试，避免短别名(如"洪潮")抢先命中导致精度下降。
 *  查不到时原样返回输入。 */
export function resolveCanonicalStoreNameFuzzySync(rawText, tenantId) {
  maybeBackgroundRefresh();
  const s = String(rawText || '').trim();
  if (!s) return s;
  const rows = [...scopeToTenant(_aliases, tenantId)].sort((a, b) => b.alias_name.length - a.alias_name.length);
  for (const r of rows) {
    if (s.includes(r.alias_name)) return r.canonical_name;
  }
  return s;
}

/** 返回{规范名: 该来源别名}整表映射(如source='feishu'得到规范名→飞书简称)。 */
export function getAllCanonicalToSourceMapSync(source, tenantId) {
  maybeBackgroundRefresh();
  const map = {};
  for (const r of scopeToTenant(_aliases, tenantId)) {
    if (r.source === source) map[r.canonical_name] = r.alias_name;
  }
  return map;
}

/** 输入规范名/任意别名，返回该门店下所有已知别名(小写去空格，供LIKE匹配)；
 *  查不到时返回[归一化后的原样输入](与此前硬编码兜底行为一致)。 */
export function getStoreAliasSetSync(rawName, tenantId) {
  maybeBackgroundRefresh();
  const s = String(rawName || '').trim();
  if (!s) return [];
  const canonical = resolveCanonicalStoreNameSync(s, tenantId);
  const rows = scopeToTenant(_aliases, tenantId).filter((r) => r.canonical_name === canonical);
  if (!rows.length) return [normKey(s)];
  return rows.map((r) => normKey(r.alias_name));
}

/** 仅供测试/迁移脚本使用：强制下一次访问立刻重新拉取。 */
export function clearStoreAliasCache() {
  _lastLoadAt = 0;
}
