/**
 * 每日评分校准：随机抽取已完成会话 → 管理员独立打分 → 对比一致率。
 */

import { COACH_DIMENSIONS } from './coach-scripts.js';

export async function pickDailyCalibration(pool, { adminUsername, limit = 2 } = {}) {
  const r = await pool.query(
    `SELECT c.id, c.session_no, c.skill_key, c.persona, c.transcript, c.ai_score
       FROM customer_twin_coach_sessions c
      WHERE c.status = 'finished'
        AND c.finished_at >= NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM customer_twin_calibration cal
           WHERE cal.session_id = c.id
        )
      ORDER BY random()
      LIMIT $1`,
    [Math.min(limit, 3)]
  );
  const tasks = (r.rows || []).map((row) => ({
    id: row.id,
    session_no: row.session_no,
    skill_key: row.skill_key,
    persona: row.persona || {},
    transcript: row.transcript || [],
    dimensions: COACH_DIMENSIONS.filter((d) => !d.skills || d.skills.includes(row.skill_key)).map((d) => d.key),
  }));
  return { ok: true, tasks, picked_by: adminUsername || '' };
}

export async function submitCalibration(pool, { sessionId, adminUsername, scores }) {
  const s = await pool.query(
    `SELECT id, skill_key, ai_score FROM customer_twin_coach_sessions WHERE id = $1 AND status = 'finished'`,
    [sessionId]
  );
  const session = s.rows?.[0];
  if (!session) return { ok: false, error: 'session_not_found' };
  const ai = session.ai_score || {};
  const agreement = {};
  let agreeCount = 0;
  let totalCount = 0;
  for (const [dim, v] of Object.entries(scores || {})) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const diff = Math.abs(n - Number(ai[dim] ?? 0));
    agreement[dim] = diff <= 10;
    if (diff <= 10) agreeCount += 1;
    totalCount += 1;
  }
  const rate = totalCount ? Math.round((agreeCount / totalCount) * 100) : 0;
  await pool.query(
    `INSERT INTO customer_twin_calibration
       (session_id, admin_username, scores, agreement, status, tenant_id)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,'done','default')`,
    [sessionId, adminUsername, JSON.stringify(scores || {}), JSON.stringify({ rate, dimensions: agreement })]
  );
  return { ok: true, rate, agreement, ai_scores: ai };
}

export async function calibrationStats(pool) {
  const r = await pool.query(
    `SELECT count(*)::int AS total,
            round(avg((agreement->>'rate')::numeric), 0) AS avg_rate,
            count(*) FILTER (WHERE (agreement->>'rate')::numeric >= 85) AS above_85
       FROM customer_twin_calibration`
  );
  return { ok: true, stats: r.rows?.[0] || { total: 0, avg_rate: 0, above_85: 0 } };
}
