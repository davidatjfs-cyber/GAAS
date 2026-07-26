/**
 * Cached agent-config DB loaders (P4 peel from agent-config-manager.js).
 */
import {
  DEFAULT_BI_AGENT_CONFIG,
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  DEFAULT_OPS_AGENT_CONFIG,
} from './defaults.js';
import {
  normalizeBiAgentConfig,
  normalizeEmployeeRatingConfig,
  normalizeOpsAgentConfig,
} from './normalize.js';

export const CACHE_TTL = 60 * 1000;

export function toJson(v, fallback = {}) {
  try {
    return typeof v === 'string' ? JSON.parse(v) : (v || fallback);
  } catch (_) {
    return fallback;
  }
}

export function createLoaderCacheState() {
  return {
    cachedRules: null,
    rulesLastFetched: 0,
    cachedConfigs: null,
    configsLastFetched: 0,
    opsAgentConfigCache: null,
    opsAgentConfigLastFetch: 0,
    biAgentConfigCache: null,
    biAgentConfigLastFetch: 0,
    cachedEmployeeRatingConfig: null,
    employeeRatingLastFetched: 0,
  };
}

export function clearAgentRuleCacheState(cache) {
  cache.cachedRules = null;
  cache.rulesLastFetched = 0;
}

export function clearAgentConfigCacheState(cache) {
  cache.cachedConfigs = null;
  cache.configsLastFetched = 0;
}

export function clearOpsAgentConfigCacheState(cache) {
  cache.opsAgentConfigCache = null;
  cache.opsAgentConfigLastFetch = 0;
}

export function clearBiAgentConfigCacheState(cache) {
  cache.biAgentConfigCache = null;
  cache.biAgentConfigLastFetch = 0;
}

export function clearEmployeeRatingConfigCacheState(cache) {
  cache.cachedEmployeeRatingConfig = null;
  cache.employeeRatingLastFetched = 0;
}

export async function loadAgentRules(deps, cache) {
  const now = Date.now();
  if (cache.cachedRules && (now - cache.rulesLastFetched < CACHE_TTL)) {
    return cache.cachedRules;
  }
  try {
    const r = await deps.pool().query('select * from agent_rules where enabled = true');
    cache.cachedRules = r.rows;
    cache.rulesLastFetched = now;
    return cache.cachedRules;
  } catch (e) {
    deps.log.error({ msg: 'getagentrules_error', err: e?.message || String(e) });
    return [];
  }
}

export async function loadCategoryAssigneeRoleMap(deps, cache) {
  const rules = await loadAgentRules(deps, cache);
  const map = {};
  for (const rule of rules) {
    map[rule.category] = rule.assignee_role;
  }
  return map;
}

export async function loadIssueScoreRulesMap(deps, cache) {
  const rules = await loadAgentRules(deps, cache);
  const map = {};
  for (const rule of rules) {
    map[rule.category] = {
      normal: rule.normal_deduction,
      major: rule.major_deduction,
    };
  }
  return map;
}

export async function loadOpsAgentConfig(deps, cache) {
  const now = Date.now();
  if (cache.opsAgentConfigCache && (now - cache.opsAgentConfigLastFetch < CACHE_TTL)) {
    return cache.opsAgentConfigCache;
  }
  try {
    const r = await deps.pool().query(
      `select config from hr_rating_configs where config_key = 'ops_agent' and enabled = true limit 1`
    );
    if (r.rows?.length > 0 && r.rows[0].config) {
      cache.opsAgentConfigCache = normalizeOpsAgentConfig(
        toJson(r.rows[0].config, DEFAULT_OPS_AGENT_CONFIG)
      );
    } else {
      cache.opsAgentConfigCache = normalizeOpsAgentConfig(DEFAULT_OPS_AGENT_CONFIG);
    }
  } catch (e) {
    deps.log.error({ msg: 'agentconfig_getopsagentconfig_error', err: e?.message || String(e) });
    cache.opsAgentConfigCache = normalizeOpsAgentConfig(DEFAULT_OPS_AGENT_CONFIG);
  }
  cache.opsAgentConfigLastFetch = now;
  return cache.opsAgentConfigCache;
}

export async function loadBiAgentConfig(deps, cache) {
  const now = Date.now();
  if (cache.biAgentConfigCache && (now - cache.biAgentConfigLastFetch < CACHE_TTL)) {
    return cache.biAgentConfigCache;
  }
  try {
    const r = await deps.pool().query(
      `select config from hr_rating_configs where config_key = 'bi_agent' and enabled = true limit 1`
    );
    if (r.rows?.length > 0 && r.rows[0].config) {
      cache.biAgentConfigCache = normalizeBiAgentConfig(
        toJson(r.rows[0].config, DEFAULT_BI_AGENT_CONFIG)
      );
    } else {
      cache.biAgentConfigCache = normalizeBiAgentConfig(DEFAULT_BI_AGENT_CONFIG);
    }
  } catch (e) {
    deps.log.error({ msg: 'agentconfig_getbiagentconfig_error', err: e?.message || String(e) });
    cache.biAgentConfigCache = normalizeBiAgentConfig(DEFAULT_BI_AGENT_CONFIG);
  }
  cache.biAgentConfigLastFetch = now;
  return cache.biAgentConfigCache;
}

export async function loadAgentConfigs(deps, cache) {
  const now = Date.now();
  if (cache.cachedConfigs && (now - cache.configsLastFetched < CACHE_TTL)) {
    return cache.cachedConfigs;
  }
  try {
    const r = await deps.pool().query('select * from agent_configs');
    const map = {};
    for (const row of r.rows) {
      map[row.agent_id] = row;
    }
    cache.cachedConfigs = map;
    cache.configsLastFetched = now;
    return cache.cachedConfigs;
  } catch (e) {
    deps.log.error({ msg: 'getagentconfigs_error', err: e?.message || String(e) });
    return {};
  }
}

export async function loadAgentConfig(deps, cache, agentId) {
  const configs = await loadAgentConfigs(deps, cache);
  return configs[agentId] || null;
}

export async function loadEmployeeRatingConfig(deps, cache) {
  const now = Date.now();
  if (cache.cachedEmployeeRatingConfig && (now - cache.employeeRatingLastFetched < CACHE_TTL)) {
    return cache.cachedEmployeeRatingConfig;
  }
  try {
    const r = await deps.pool().query(`
      select config
      from hr_rating_configs
      where config_key = 'employee_rating' and enabled = true
      limit 1
    `);
    cache.cachedEmployeeRatingConfig = r.rows?.[0]?.config
      ? normalizeEmployeeRatingConfig(toJson(r.rows[0].config, DEFAULT_EMPLOYEE_RATING_CONFIG))
      : DEFAULT_EMPLOYEE_RATING_CONFIG;
    cache.employeeRatingLastFetched = now;
    return cache.cachedEmployeeRatingConfig;
  } catch (e) {
    deps.log.error({ msg: 'getemployeeratingconfig_error', err: e?.message || String(e) });
    return DEFAULT_EMPLOYEE_RATING_CONFIG;
  }
}
