/**
 * Talent Engine — Learning Loop L1：弱项 → 推荐课程(KB/topic) → 再陪练
 * L2/L3 KPI 关训：仅保留 kpi_metric_key 字段读取，不做自动关训。
 */

import { listActiveCompetencies } from './competency.js';

/**
 * @returns {{ ok: true, weakest: string|null, courses: Array, kpi_hooks: Array }}
 */
export async function recommendLearningLoop(pool, {
  jobProfileKey,
  skills = {},
  weakestCompetency = null,
}) {
  const comps = await listActiveCompetencies(pool, jobProfileKey);
  if (!comps.length) {
    return { ok: true, weakest: weakestCompetency, courses: [], kpi_hooks: [] };
  }

  let weakest = weakestCompetency;
  if (!weakest) {
    let bestScore = 101;
    for (const c of comps) {
      const v = Number(skills[c.competency_key]);
      if (!Number.isNaN(v) && v < bestScore) {
        bestScore = v;
        weakest = c.competency_key;
      }
    }
  }
  if (!weakest) weakest = comps[0].competency_key;

  const target = comps.find((c) => c.competency_key === weakest) || comps[0];
  const topicIds = asArray(target.recommended_topic_ids);
  const kbIds = asArray(target.recommended_kb_ids);

  const courses = [];
  for (const id of topicIds) {
    courses.push({ type: 'training_topic', id: String(id), competency_key: target.competency_key });
  }
  for (const id of kbIds) {
    courses.push({ type: 'knowledge_base', id: String(id), competency_key: target.competency_key });
  }

  // 若尚未配置课程链接，给出可配置占位（前端可提示管理员补链）
  if (!courses.length) {
    courses.push({
      type: 'configure_hint',
      competency_key: target.competency_key,
      label: target.label,
      message: `请为能力「${target.label}」配置 recommended_topic_ids 或 recommended_kb_ids`,
    });
  }

  const kpi_hooks = comps
    .filter((c) => c.kpi_metric_key)
    .map((c) => ({
      competency_key: c.competency_key,
      kpi_metric_key: c.kpi_metric_key,
      status: 'adapter_pending',
    }));

  return {
    ok: true,
    weakest,
    competency_label: target.label,
    ability_key: target.ability_key,
    version: target.version,
    courses,
    kpi_hooks,
  };
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}
