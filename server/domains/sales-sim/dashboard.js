import {
  trackLabel, formatSkillsGradeLine, difficultyLabel, scoreGrade, skillsGrades,
} from './labels.js';
import { getRankStatus, rankLabel } from './rank.js';

/** 批量解析展示姓名：优先平台管理员 real_name，其次门店 users.real_name */
export async function resolveDisplayNames(pool, usernames = []) {
  const list = [...new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))];
  const map = new Map();
  if (!list.length) return map;

  const pa = await pool.query(
    `SELECT username, real_name FROM platform_admins
      WHERE lower(username) = ANY($1::text[])`,
    [list.map((u) => u.toLowerCase())]
  ).catch(() => ({ rows: [] }));
  for (const r of pa.rows || []) {
    const name = String(r.real_name || '').trim();
    if (name) map.set(String(r.username).toLowerCase(), name);
  }

  const missing = list.filter((u) => !map.has(u.toLowerCase()));
  if (missing.length) {
    const ur = await pool.query(
      `SELECT username, real_name FROM users
        WHERE lower(username) = ANY($1::text[])`,
      [missing.map((u) => u.toLowerCase())]
    ).catch(() => ({ rows: [] }));
    for (const r of ur.rows || []) {
      const name = String(r.real_name || '').trim();
      if (name) map.set(String(r.username).toLowerCase(), name);
    }
  }
  return map;
}

function displayNameOf(map, username) {
  const key = String(username || '').toLowerCase();
  return map.get(key) || String(username || '');
}

/** 管理员看板：按人 × 轨道汇总 */
export async function buildTrainingDashboard(pool, { track = null, limit = 100 } = {}) {
  const summary = await pool.query(
    `SELECT
        s.username,
        s.track,
        COUNT(*)::int AS sessions_total,
        COUNT(*) FILTER (WHERE s.status='finished')::int AS sessions_finished,
        ROUND(AVG(NULLIF((s.debrief->>'score')::numeric, 0)), 1) AS avg_score,
        MAX((s.debrief->>'score')::int) AS best_score,
        SUM(COALESCE(s.duration_sec,0))::int AS total_duration_sec,
        MAX(s.finished_at) AS last_finished_at,
        MAX(s.started_at) AS last_started_at
      FROM sales_sim_sessions s
     WHERE ($1::text IS NULL OR s.track=$1)
     GROUP BY s.username, s.track
     ORDER BY last_finished_at DESC NULLS LAST, sessions_finished DESC
     LIMIT $2`,
    [track, limit]
  );

  const recent = await pool.query(
    `SELECT id, username, track, persona_key, difficulty, status, outcome,
            (debrief->>'score')::int AS score, finished_at, duration_sec,
            meta->>'persona_title' AS persona_title
       FROM sales_sim_sessions
      WHERE status='finished' AND ($1::text IS NULL OR track=$1)
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 30`,
    [track]
  );

  const nameMap = await resolveDisplayNames(pool, [
    ...(summary.rows || []).map((r) => r.username),
    ...(recent.rows || []).map((r) => r.username),
  ]);

  const rows = [];
  for (const row of summary.rows || []) {
    const rank = await getRankStatus(pool, row.username, row.track).catch(() => null);
    const profile = await pool.query(
      `SELECT skills, sessions_count, effective_minutes FROM sales_sim_skill_profiles
        WHERE username=$1 AND track=$2`,
      [row.username, row.track]
    );
    const skills = profile.rows?.[0]?.skills || rank?.skills || {};
    const avg = row.avg_score != null ? Number(row.avg_score) : null;
    rows.push({
      username: row.username,
      display_name: displayNameOf(nameMap, row.username),
      track: row.track,
      track_label: trackLabel(row.track),
      sessions_total: row.sessions_total,
      sessions_finished: row.sessions_finished,
      avg_score: avg,
      avg_grade: scoreGrade(avg),
      best_score: row.best_score,
      best_grade: scoreGrade(row.best_score),
      total_minutes: Math.round(Number(row.total_duration_sec || 0) / 60),
      effective_minutes: Number(profile.rows?.[0]?.effective_minutes || rank?.effective_minutes || 0),
      last_finished_at: row.last_finished_at,
      rank_key: rank?.rank_key || null,
      rank_label: rank?.rank_label || rankLabel(row.track, `${row.track}_rookie`),
      skills,
      skills_grades: skillsGrades(skills),
      skills_line: formatSkillsGradeLine(skills),
    });
  }

  const byTrack = await pool.query(
    `SELECT track,
            COUNT(DISTINCT username)::int AS trainees,
            COUNT(*) FILTER (WHERE status='finished')::int AS finished_sessions,
            ROUND(AVG(NULLIF((debrief->>'score')::numeric, 0)), 1) AS avg_score
       FROM sales_sim_sessions
      WHERE ($1::text IS NULL OR track=$1)
      GROUP BY track`,
    [track]
  );

  return {
    ok: true,
    grade_scale: [
      { grade: '不合格', rule: '80分以下' },
      { grade: '合格', rule: '80–90分' },
      { grade: '优秀', rule: '91–95分' },
      { grade: '卓越', rule: '95分以上' },
    ],
    overview: (byTrack.rows || []).map((r) => {
      const avg = r.avg_score != null ? Number(r.avg_score) : null;
      return {
        track: r.track,
        track_label: trackLabel(r.track),
        trainees: r.trainees,
        finished_sessions: r.finished_sessions,
        avg_score: avg,
        avg_grade: scoreGrade(avg),
      };
    }),
    people: rows,
    recent: (recent.rows || []).map((r) => ({
      ...r,
      display_name: displayNameOf(nameMap, r.username),
      track_label: trackLabel(r.track),
      difficulty_label: difficultyLabel(r.difficulty),
      score_grade: scoreGrade(r.score),
    })),
  };
}
