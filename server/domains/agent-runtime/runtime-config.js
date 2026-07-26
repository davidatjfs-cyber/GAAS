/**
 * BI/Ops 运行时配置状态（P2 peel from agents.js）。
 * 可变配置唯一所有者：只通过 getter/refresh 暴露，不导出可写引用。
 */
import {
  INITIAL_BI_AGENT_CONFIG,
  INITIAL_OPS_AGENT_CONFIG,
} from './runtime-config-defaults.js';
import {
  getBiReasoningModelFromConfig,
  getOpsReasoningModelFromConfig,
  getOpsVisionModelFromConfig,
  getStoreThresholdFromConfig,
  isBiSourceEnabledFromConfig,
  mergeBiRuntimeConfig,
  mergeOpsRuntimeConfig,
} from './runtime-config-helpers.js';

function cloneConfig(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @param {object} deps
 * @param {Function} deps.getBiAgentConfig — remote loader from agent-config-manager
 * @param {Function} deps.getOpsAgentConfig — remote loader from agent-config-manager
 * @param {{ error: Function }} deps.log
 * @param {string} deps.deepseekModel
 * @param {string} deps.deepseekVisionModel
 */
export function createAgentRuntimeConfig(deps) {
  const {
    getBiAgentConfig: loadBiRemote,
    getOpsAgentConfig: loadOpsRemote,
    log,
    deepseekModel,
    deepseekVisionModel,
  } = deps;

  let biConfig = cloneConfig(INITIAL_BI_AGENT_CONFIG);
  let opsConfig = cloneConfig(INITIAL_OPS_AGENT_CONFIG);

  function getBiAgentConfig() {
    return biConfig;
  }

  function getOpsAgentConfig() {
    return opsConfig;
  }

  function getStoreThreshold(storeName, key, fallback) {
    return getStoreThresholdFromConfig(biConfig, storeName, key, fallback);
  }

  function isBiSourceEnabled(key) {
    return isBiSourceEnabledFromConfig(biConfig, key);
  }

  function getOpsReasoningModel() {
    return getOpsReasoningModelFromConfig(opsConfig, deepseekModel);
  }

  function getOpsVisionModel() {
    return getOpsVisionModelFromConfig(opsConfig, deepseekVisionModel);
  }

  function getBiReasoningModel() {
    return getBiReasoningModelFromConfig(biConfig, deepseekModel);
  }

  async function refreshBiAgentRuntimeConfig() {
    try {
      const remote = await loadBiRemote();
      if (remote && typeof remote === 'object') {
        biConfig = mergeBiRuntimeConfig(biConfig, remote);
      }
    } catch (e) {
      log.error('[bi] refresh runtime config failed:', e?.message || e);
    }
  }

  async function refreshOpsAgentRuntimeConfig() {
    try {
      const remote = await loadOpsRemote();
      if (remote && typeof remote === 'object') {
        opsConfig = mergeOpsRuntimeConfig(opsConfig, remote);
      }
    } catch (e) {
      log.error('[ops] refresh runtime config failed:', e?.message || e);
    }
  }

  return {
    refreshBiAgentRuntimeConfig,
    refreshOpsAgentRuntimeConfig,
    getStoreThreshold,
    isBiSourceEnabled,
    getBiReasoningModel,
    getOpsReasoningModel,
    getOpsVisionModel,
    getBiAgentConfig,
    getOpsAgentConfig,
  };
}
