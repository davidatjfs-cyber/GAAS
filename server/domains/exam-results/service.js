/**
 * 考试成绩域：exam_results 为权威，hrms_state.examResults 仅为镜像。
 * GET /api/state / getSharedState 通过 hydrateExamResultsFromTable 覆盖；写入仅 INSERT 表，不写 blob。
 */

import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'exam-results', handler: 'service' });


const TABLE = SHARED_TABLES.EXAM_RESULTS;

export function examResultRowToStateShape(row) {
  if (!row) return null;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    assignmentId: row.assignment_id == null ? null : String(row.assignment_id),
    user: String(row.user_key || '').trim(),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    timeUsedSeconds: row.time_used_seconds == null ? null : Number(row.time_used_seconds),
    autoSubmitted: !!row.auto_submitted,
    setIndex: row.set_index == null ? null : Number(row.set_index),
    total: row.total == null ? null : Number(row.total),
    correct: row.correct == null ? null : Number(row.correct),
    score: row.score == null ? null : Number(row.score),
    answers: Array.isArray(row.answers) ? row.answers : (row.answers && typeof row.answers === 'object' ? row.answers : []),
  };
}

export async function loadExamResultsFromTable(pool, tenantId, limit = 500) {
  const tid = String(tenantId || 'default');
  const lim = Math.min(1000, Math.max(1, Number(limit) || 500));
  let r;
  try {
    r = await pool.query(
      `SELECT id, assignment_id, user_key, created_at, started_at, submitted_at,
              time_used_seconds, auto_submitted, set_index, total, correct, score, answers
         FROM ${TABLE}
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [tid, lim]
    );
  } catch (e) {
    if (!/tenant_id|column/i.test(String(e?.message || ''))) throw e;
    r = await pool.query(
      `SELECT id, assignment_id, user_key, created_at, started_at, submitted_at,
              time_used_seconds, auto_submitted, set_index, total, correct, score, answers
         FROM ${TABLE}
        ORDER BY created_at DESC
        LIMIT $1`,
      [lim]
    );
  }
  return (r.rows || []).map(examResultRowToStateShape).filter(Boolean);
}

export async function hydrateExamResultsFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const fromTable = await loadExamResultsFromTable(pool, tenantId);
    if (fromTable.length > 0) {
      base.examResults = fromTable;
    }
  } catch (e) {
    log.error({ msg: 'exam_results_domain_hydrate_failed', err: e?.message || e });
  }
  return base;
}
