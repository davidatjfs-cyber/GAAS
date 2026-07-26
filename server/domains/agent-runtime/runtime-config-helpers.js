/**
 * BI/Ops 运行时配置 — 纯 helpers（读当前 config 快照）。
 */

export function getStoreThresholdFromConfig(biConfig, storeName, key, fallback) {
  const triggers = biConfig?.anomalyTriggers || {};
  const overrides = triggers.storeOverrides && typeof triggers.storeOverrides === 'object'
    ? triggers.storeOverrides
    : {};
  const storeConfig = overrides[storeName];
  if (storeConfig && storeConfig[key] !== undefined && storeConfig[key] !== null) {
    return Number(storeConfig[key]);
  }
  const globalConfig = triggers.global && typeof triggers.global === 'object' ? triggers.global : {};
  if (globalConfig[key] !== undefined && globalConfig[key] !== null) {
    return Number(globalConfig[key]);
  }
  return fallback;
}

export function isBiSourceEnabledFromConfig(biConfig, key) {
  const list = Array.isArray(biConfig?.dataSources) ? biConfig.dataSources : [];
  const hit = list.find((x) => String(x?.key || '').trim() === String(key || '').trim());
  return hit ? hit.enabled !== false : true;
}

export function getOpsReasoningModelFromConfig(opsConfig, deepseekModel) {
  const model = String(opsConfig?.llmModels?.reasoningModel || '').trim();
  return model || deepseekModel;
}

export function getOpsVisionModelFromConfig(opsConfig, deepseekVisionModel) {
  const model = String(opsConfig?.llmModels?.visionModel || '').trim();
  if (model.startsWith('doubao-') || model.startsWith('ep-')) return model;
  return String(deepseekVisionModel || '').startsWith('doubao-')
    || String(deepseekVisionModel || '').startsWith('ep-')
    ? deepseekVisionModel
    : 'ep-20260424183833-7lr9g';
}

export function getBiReasoningModelFromConfig(biConfig, deepseekModel) {
  const model = String(biConfig?.llmModels?.reasoningModel || '').trim();
  return model || deepseekModel;
}

export function mergeBiRuntimeConfig(local, remote) {
  const remoteT = remote.anomalyTriggers || {};
  const localT = local?.anomalyTriggers || {};
  return {
    ...local,
    ...remote,
    anomalyTriggers: {
      global: { ...(localT.global || {}), ...(remoteT.global || {}) },
      storeOverrides: { ...(localT.storeOverrides || {}), ...(remoteT.storeOverrides || {}) },
    },
  };
}

export function mergeOpsRuntimeConfig(local, remote) {
  return {
    ...local,
    ...remote,
    scheduledTasks: {
      ...(local?.scheduledTasks || {}),
      ...(remote?.scheduledTasks || {}),
    },
  };
}
