/**
 * questionSets 表读写 + hydrate（Tier 2）。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'remaining-state', handler: 'question-sets-service' });
const TABLE = 'hrms_question_sets';

export async function loadQuestionSetsFromTable(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const r = await pool.query(
    `SELECT set_index, questions, meta FROM ${TABLE}
      WHERE tenant_id = $1
      ORDER BY set_index ASC`,
    [tid]
  );
  return (r.rows || []).map((row) => {
    const qs = Array.isArray(row.questions) ? row.questions : [];
    return qs;
  });
}

export async function hydrateQuestionSetsFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const sets = await loadQuestionSetsFromTable(pool, tenantId);
    if (sets.length) base.questionSets = sets;
  } catch (e) {
    log.error({ msg: 'question_sets_hydrate_failed', err: e?.message || String(e) });
  }
  return base;
}

export async function saveQuestionSetsToTable(db, tenantId, questionSets) {
  const tid = String(tenantId || 'default');
  const sets = Array.isArray(questionSets) ? questionSets : [];
  await db.query(`DELETE FROM ${TABLE} WHERE tenant_id = $1`, [tid]);
  for (let i = 0; i < sets.length; i += 1) {
    const questions = Array.isArray(sets[i]) ? sets[i] : [];
    await db.query(
      `INSERT INTO ${TABLE} (tenant_id, set_index, questions, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [tid, i, JSON.stringify(questions)]
    );
  }
}
