/**
 * Talent Engine P0 seed 编排
 */

import { ensureAbilitySeed } from './ability.js';
import { ensureProfileSeed, ensureCompetencySeed } from './competency.js';
import { ensureCoachPersonaSeed } from './coach-persona.js';
import { ensureStoreScenarioSeed } from './store-tracks.js';
import { ensureIncidentSeed } from './incident-cards.js';
import { ensureTrainingPackSeed } from './training-pack.js';

let _seeded = false;

export async function ensureTalentEngineSeed(pool) {
  if (_seeded) return { ok: true, skipped: true };
  try {
    await ensureAbilitySeed(pool);
    await ensureCoachPersonaSeed(pool);
    await ensureProfileSeed(pool);
    await ensureCompetencySeed(pool);
    try {
      await ensureStoreScenarioSeed(pool);
    } catch (e) {
      if (!/job_coach_scenarios|does not exist/i.test(e?.message || '')) throw e;
    }
    try {
      await ensureTrainingPackSeed(pool);
    } catch (e) {
      if (!/knowledge_base|does not exist/i.test(e?.message || '')) throw e;
    }
    try {
      await ensureIncidentSeed(pool);
    } catch (e) {
      if (!/job_coach_incident|job_coach_scenario_categories|does not exist/i.test(e?.message || '')) throw e;
    }
    _seeded = true;
    return { ok: true };
  } catch (e) {
    // migration 未跑时不阻断 sales-sim 主路径
    const msg = e?.message || String(e);
    if (/talent_abilities|job_coach_|does not exist/i.test(msg)) {
      return { ok: false, error: 'migration_pending', message: msg };
    }
    throw e;
  }
}

/** 测试用：允许重置内存闸门 */
export function resetTalentSeedGate() {
  _seeded = false;
}
