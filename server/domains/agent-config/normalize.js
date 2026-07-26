import {
  DEFAULT_BI_AGENT_CONFIG,
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  DEFAULT_OPS_AGENT_CONFIG,
  DEFAULT_RULES,
} from './defaults.js';
import {
  normalizeFrequency,
  normalizeModelName,
  normalizeOpsStore,
  normalizeOpsType,
  toFinite,
} from './normalize-helpers.js';

export function normalizeBiAnomalyDictionary(v) {
  const list = Array.isArray(v) ? v : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const key = String(item?.key || '').trim();
    const category = String(item?.category || item?.label || '').trim();
    if (!key || !category || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      category,
      label: String(item?.label || category).trim() || category,
      enabled: item?.enabled !== false
    });
  }
  if (out.length) return out;
  return DEFAULT_RULES.map((r) => ({
    key: `rule_${String(r.category).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '_')}`,
    category: r.category,
    label: r.category,
    enabled: true
  }));
}

export function normalizeOpsAgentConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const normalizedDaily = (Array.isArray(c?.scheduledTasks?.dailyInspections)
    ? c.scheduledTasks.dailyInspections
    : []
  ).map((x) => ({
    store: normalizeOpsStore(x?.store),
    brand: String(x?.brand || '').trim(),
    type: normalizeOpsType(x?.type),
    time: String(x?.time || '').trim() || '10:00',
    frequency: normalizeFrequency(x?.frequency),
    customIntervalDays: Math.max(1, Math.floor(Number(x?.customIntervalDays) || 1)),
    timeWindow: Math.max(5, Math.floor(Number(x?.timeWindow) || 60)),
    formUrl: String(x?.formUrl || '').trim(),
    checklist: Array.isArray(x?.checklist) ? x.checklist.map((v) => String(v || '').trim()).filter(Boolean) : []
  }));
  const normalizedRandom = (Array.isArray(c?.scheduledTasks?.randomInspections)
    ? c.scheduledTasks.randomInspections
    : []
  ).map((x) => {
    const store = normalizeOpsStore(x?.store);
    const brand = String(x?.brand || '').trim();
    const minH = Math.max(1, Math.floor(Number(x?.intervalMinHours) || Number(x?.interval?.[0]) || 2));
    const maxH = Math.max(minH, Math.floor(Number(x?.intervalMaxHours) || Number(x?.interval?.[1]) || 4));
    const roles = Array.isArray(x?.assigneeRoles)
      ? x.assigneeRoles.map((r) => String(r || '').trim()).filter(Boolean)
      : [];
    return {
      type: String(x?.type || '').trim() || '食安抽检',
      description: String(x?.description || '').trim() || '食安抽检',
      timeWindow: Math.max(1, Math.floor(Number(x?.timeWindow) || 15)),
      store,
      brand,
      assigneeRoles: roles.length ? roles : ['store_manager', 'store_production_manager'],
      intervalMinHours: minH,
      intervalMaxHours: maxH
    };
  });

  const dtDefault = DEFAULT_OPS_AGENT_CONFIG.scheduledTasks?.dataTriggers || {};
  const dtUser = c?.scheduledTasks?.dataTriggers && typeof c.scheduledTasks.dataTriggers === 'object'
    ? c.scheduledTasks.dataTriggers
    : {};

  return {
    ...DEFAULT_OPS_AGENT_CONFIG,
    ...c,
    llmModels: {
      reasoningModel: normalizeModelName(c?.llmModels?.reasoningModel, DEFAULT_OPS_AGENT_CONFIG.llmModels.reasoningModel),
      visionModel: String(c?.llmModels?.visionModel || '').startsWith('doubao-') || String(c?.llmModels?.visionModel || '').startsWith('ep-')
        ? String(c.llmModels.visionModel)
        : DEFAULT_OPS_AGENT_CONFIG.llmModels.visionModel
    },
    scheduledTasks: {
      dataTriggers: { ...dtDefault, ...dtUser },
      dailyInspections: normalizedDaily,
      randomInspections: normalizedRandom
    }
  };
}

export function normalizeBiAnomalyTriggers(raw) {
  const defaults = DEFAULT_BI_AGENT_CONFIG.anomalyTriggers;
  if (!raw || typeof raw !== 'object') return { ...defaults };
  if (!raw.global && !raw.storeOverrides) {
    return { global: { ...defaults.global, ...raw }, storeOverrides: { ...(defaults.storeOverrides || {}) } };
  }
  const global = { ...defaults.global, ...(raw.global || {}) };
  const storeOverrides = {};
  const rawOverrides = raw.storeOverrides && typeof raw.storeOverrides === 'object' ? raw.storeOverrides : {};
  for (const [store, overrides] of Object.entries(rawOverrides)) {
    if (overrides && typeof overrides === 'object') {
      storeOverrides[store] = { ...overrides };
    }
  }
  return { global, storeOverrides };
}

export function normalizeBiAgentConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const sourceMap = new Map((Array.isArray(c?.dataSources) ? c.dataSources : []).map((x) => [String(x?.key || '').trim(), x]));
  return {
    ...DEFAULT_BI_AGENT_CONFIG,
    ...c,
    dataSources: DEFAULT_BI_AGENT_CONFIG.dataSources.map((base) => {
      const hit = sourceMap.get(base.key) || {};
      return {
        ...base,
        ...hit,
        key: base.key,
        label: String(hit.label || base.label),
        sourceType: String(hit.sourceType || base.sourceType),
        enabled: hit.enabled === undefined ? base.enabled : !!hit.enabled
      };
    }),
    anomalyTriggers: normalizeBiAnomalyTriggers(c?.anomalyTriggers),
    anomalyDictionary: normalizeBiAnomalyDictionary(c?.anomalyDictionary)
  };
}

export function normalizeEmployeeRatingConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const labels = c?.levelLabels && typeof c.levelLabels === 'object' ? c.levelLabels : {};
  const ex = c.execution || {};
  const at = c.attitude || {};
  const ab = c.ability || {};
  const ePm = ex.store_production_manager || {};
  const eMgrHz = ex.store_manager?.hongchao || {};
  const eMgrMjx = ex.store_manager?.majixian || {};
  const bPm = ab.store_production_manager || {};
  const bMgrHz = ab.store_manager?.hongchao || {};
  const bMgrMjx = ab.store_manager?.majixian || {};

  return {
    levelLabels: {
      A: String(labels.A || DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels.A || 'A').trim() || 'A',
      B: String(labels.B || DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels.B || 'B').trim() || 'B',
      C: String(labels.C || DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels.C || 'C').trim() || 'C',
      D: String(labels.D || DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels.D || 'D').trim() || 'D'
    },
    execution: {
      store_production_manager: {
        A_max_missing: toFinite(ePm.A_max_missing ?? ePm.threshold_A, 6),
        B_max_missing: toFinite(ePm.B_max_missing ?? ePm.threshold_B, 13),
        C_max_missing: toFinite(ePm.C_max_missing ?? ePm.threshold_C, 20),
        D_min_missing: toFinite(ePm.D_min_missing ?? ePm.threshold_D, 21)
      },
      store_manager: {
        hongchao: {
          A_min_new_members: toFinite(eMgrHz.A_min_new_members ?? eMgrHz.min_A, 300),
          B_min_new_members: toFinite(eMgrHz.B_min_new_members ?? eMgrHz.min_B, 249),
          C_min_new_members: toFinite(eMgrHz.C_min_new_members ?? eMgrHz.min_C, 200),
          D_max_new_members: toFinite(eMgrHz.D_max_new_members ?? eMgrHz.max_D, 199)
        },
        majixian: {
          low_score_threshold: toFinite(eMgrMjx.low_score_threshold, 7),
          A_max_missing: toFinite(eMgrMjx.A_max_missing ?? eMgrMjx.max_missing_A, 2),
          A_max_low_score: toFinite(eMgrMjx.A_max_low_score ?? eMgrMjx.max_low_A, 2),
          B_max_missing: toFinite(eMgrMjx.B_max_missing ?? eMgrMjx.max_missing_B, 4),
          B_max_low_score: toFinite(eMgrMjx.B_max_low_score ?? eMgrMjx.max_low_B, 4),
          C_max_missing: toFinite(eMgrMjx.C_max_missing ?? eMgrMjx.max_missing_C, 6),
          C_max_low_score: toFinite(eMgrMjx.C_max_low_score ?? eMgrMjx.max_low_C, 6),
          D_min_missing: toFinite(eMgrMjx.D_min_missing ?? eMgrMjx.min_missing_D, 7),
          D_min_low_score: toFinite(eMgrMjx.D_min_low_score ?? eMgrMjx.min_low_D, 7)
        }
      }
    },
    attitude: {
      A_max_incomplete: toFinite(at.A_max_incomplete ?? at.threshold_A, 2),
      B_max_incomplete: toFinite(at.B_max_incomplete ?? at.threshold_B, 4),
      C_max_incomplete: toFinite(at.C_max_incomplete ?? at.threshold_C, 8),
      D_min_incomplete: toFinite(at.D_min_incomplete ?? at.threshold_D, 9)
    },
    ability: {
      store_production_manager: {
        A_min_diff: toFinite(bPm.A_min_diff ?? bPm.min_A, 1.01),
        B_min_diff: toFinite(bPm.B_min_diff ?? bPm.min_B, -1),
        B_max_diff: toFinite(bPm.B_max_diff ?? bPm.max_B, 1),
        C_min_diff: toFinite(bPm.C_min_diff ?? bPm.min_C, -2),
        C_max_diff: toFinite(bPm.C_max_diff ?? bPm.max_C, -1.01),
        D_max_diff: toFinite(bPm.D_max_diff ?? bPm.max_D, -2)
      },
      store_manager: {
        hongchao: {
          A_min_rating: toFinite(bMgrHz.A_min_rating ?? bMgrHz.min_A, 4.6),
          B_min_rating: toFinite(bMgrHz.B_min_rating ?? bMgrHz.min_B, 4.5),
          C_min_rating: toFinite(bMgrHz.C_min_rating ?? bMgrHz.min_C, 4.3),
          D_max_rating: toFinite(bMgrHz.D_max_rating ?? bMgrHz.max_D, 4.2)
        },
        majixian: {
          A_min_rating: toFinite(bMgrMjx.A_min_rating ?? bMgrMjx.min_A, 4.5),
          B_min_rating: toFinite(bMgrMjx.B_min_rating ?? bMgrMjx.min_B, 4.4),
          C_min_rating: toFinite(bMgrMjx.C_min_rating ?? bMgrMjx.min_C, 4.0),
          D_max_rating: toFinite(bMgrMjx.D_max_rating ?? bMgrMjx.max_D, 3.9)
        }
      }
    }
  };
}

export function validateEmployeeRatingConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const normalized = normalizeEmployeeRatingConfig(cfg);
  const ex = normalized.execution || {};
  const at = normalized.attitude || {};
  const ab = normalized.ability || {};
  const ePm = ex.store_production_manager || {};
  const eMgrHz = ex.store_manager?.hongchao || {};
  const eMgrMjx = ex.store_manager?.majixian || {};
  const a = at || {};
  const bPm = ab.store_production_manager || {};
  const bMgrHz = ab.store_manager?.hongchao || {};
  const bMgrMjx = ab.store_manager?.majixian || {};
  const checks = [
    ePm.A_max_missing, ePm.B_max_missing, ePm.C_max_missing, ePm.D_min_missing,
    eMgrHz.A_min_new_members, eMgrHz.B_min_new_members, eMgrHz.C_min_new_members, eMgrHz.D_max_new_members,
    eMgrMjx.low_score_threshold, eMgrMjx.A_max_missing, eMgrMjx.A_max_low_score,
    eMgrMjx.B_max_missing, eMgrMjx.B_max_low_score, eMgrMjx.C_max_missing, eMgrMjx.C_max_low_score, eMgrMjx.D_min_missing, eMgrMjx.D_min_low_score,
    a.A_max_incomplete, a.B_max_incomplete, a.C_max_incomplete, a.D_min_incomplete,
    bPm.A_min_diff, bPm.B_min_diff, bPm.B_max_diff, bPm.C_min_diff, bPm.C_max_diff, bPm.D_max_diff,
    bMgrHz.A_min_rating, bMgrHz.B_min_rating, bMgrHz.C_min_rating, bMgrHz.D_max_rating,
    bMgrMjx.A_min_rating, bMgrMjx.B_min_rating, bMgrMjx.C_min_rating, bMgrMjx.D_max_rating
  ];
  return checks.every((v) => Number.isFinite(Number(v)));
}
