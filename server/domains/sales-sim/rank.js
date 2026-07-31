/**
 * 职级：有效时长 × 能力 × 难度通关（可配置阈值）
 */

export const SALES_RANKS = [
  { key: 'sales_rookie', label: '普通销售', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
  { key: 'sales_senior', label: '资深销售', minMinutes: 120, minAvg: 75, minDifficultyClear: 3 },
  { key: 'sales_ace', label: '销冠', minMinutes: 360, minAvg: 82, minDifficultyClear: 5 },
  { key: 'sales_mentor', label: '导师销售', minMinutes: 720, minAvg: 88, minDifficultyClear: 7, mentor: true },
];

export const CS_RANKS = [
  { key: 'cs_rookie', label: '普通客服', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
  { key: 'cs_senior', label: '资深客服', minMinutes: 120, minAvg: 75, minDifficultyClear: 2 },
  { key: 'cs_gold', label: '金牌客服', minMinutes: 360, minAvg: 82, minDifficultyClear: 4 },
  { key: 'cs_mentor', label: '导师客服', minMinutes: 720, minAvg: 88, minDifficultyClear: 6, mentor: true },
];

const STORE_RANK_TEMPLATES = {
  foh_server: [
    { key: 'foh_rookie', label: '实习服务员', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
    { key: 'foh_senior', label: '熟练服务员', minMinutes: 90, minAvg: 75, minDifficultyClear: 2 },
    { key: 'foh_star', label: '五星服务员', minMinutes: 240, minAvg: 82, minDifficultyClear: 4 },
    { key: 'foh_mentor', label: '服务导师', minMinutes: 480, minAvg: 88, minDifficultyClear: 6, mentor: true },
  ],
  cashier: [
    { key: 'cash_rookie', label: '实习收银', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
    { key: 'cash_senior', label: '熟练收银', minMinutes: 90, minAvg: 75, minDifficultyClear: 2 },
    { key: 'cash_star', label: '金牌收银', minMinutes: 240, minAvg: 82, minDifficultyClear: 3 },
    { key: 'cash_mentor', label: '收银导师', minMinutes: 420, minAvg: 88, minDifficultyClear: 5, mentor: true },
  ],
  store_manager: [
    { key: 'mgr_rookie', label: '见习店长', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
    { key: 'mgr_senior', label: '成熟店长', minMinutes: 120, minAvg: 75, minDifficultyClear: 2 },
    { key: 'mgr_ace', label: '标杆店长', minMinutes: 360, minAvg: 82, minDifficultyClear: 4 },
    { key: 'mgr_mentor', label: '督导型店长', minMinutes: 600, minAvg: 88, minDifficultyClear: 6, mentor: true },
  ],
  kitchen_staff: [
    { key: 'kit_rookie', label: '实习厨工', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
    { key: 'kit_senior', label: '熟练厨工', minMinutes: 90, minAvg: 75, minDifficultyClear: 2 },
    { key: 'kit_lead', label: '档口骨干', minMinutes: 240, minAvg: 82, minDifficultyClear: 3 },
    { key: 'kit_mentor', label: '后厨导师', minMinutes: 420, minAvg: 88, minDifficultyClear: 5, mentor: true },
  ],
  hq_ops: [
    { key: 'hq_rookie', label: '运营新人', minMinutes: 0, minAvg: 0, minDifficultyClear: 0 },
    { key: 'hq_senior', label: '资深运营', minMinutes: 120, minAvg: 75, minDifficultyClear: 2 },
    { key: 'hq_lead', label: '运营骨干', minMinutes: 300, minAvg: 82, minDifficultyClear: 4 },
    { key: 'hq_mentor', label: '运营导师', minMinutes: 540, minAvg: 88, minDifficultyClear: 5, mentor: true },
  ],
};

export function rankLadder(track) {
  if (track === 'cs') return CS_RANKS;
  if (STORE_RANK_TEMPLATES[track]) return STORE_RANK_TEMPLATES[track];
  return SALES_RANKS;
}

export function rankLabel(track, key) {
  return rankLadder(track).find((r) => r.key === key)?.label || key;
}

export async function getOrInitRank(pool, username, track) {
  const ladder = rankLadder(track);
  const r = await pool.query(
    `SELECT * FROM sales_sim_ranks WHERE username=$1 AND track=$2`,
    [username, track]
  );
  if (r.rows?.[0]) return r.rows[0];
  const inserted = await pool.query(
    `INSERT INTO sales_sim_ranks (username, track, rank_key, effective_minutes)
     VALUES ($1,$2,$3,0) RETURNING *`,
    [username, track, ladder[0].key]
  );
  return inserted.rows[0];
}

export async function applySessionToRank(pool, {
  username, track, durationSec, debrief, difficulty, dailyCap = 8,
}) {
  const minutes = Math.max(1, Math.round(Number(durationSec || 0) / 60));
  const todayCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sales_sim_sessions
      WHERE username=$1 AND track=$2 AND status='finished'
        AND finished_at::date = CURRENT_DATE`,
    [username, track]
  );
  const countedToday = Number(todayCount.rows?.[0]?.n || 0);
  const countsForRank = countedToday <= dailyCap;

  const skills = debrief?.skills || {};
  const vals = Object.values(skills).map(Number).filter((n) => !Number.isNaN(n));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const score = Number(debrief?.score || 0);
  const cleared = score >= 80 && Number(difficulty || 1) > 0;

  await pool.query(
    `INSERT INTO sales_sim_skill_profiles (username, track, skills, sessions_count, effective_minutes, updated_at)
     VALUES ($1,$2,$3::jsonb,1,$4,NOW())
     ON CONFLICT (username, track) DO UPDATE SET
       skills = EXCLUDED.skills,
       sessions_count = sales_sim_skill_profiles.sessions_count + 1,
       effective_minutes = sales_sim_skill_profiles.effective_minutes + EXCLUDED.effective_minutes,
       updated_at = NOW()`,
    [username, track, JSON.stringify(skills), countsForRank ? minutes : 0]
  );

  const rankRow = await getOrInitRank(pool, username, track);
  const newMinutes = Number(rankRow.effective_minutes || 0) + (countsForRank ? minutes : 0);

  const hist = await pool.query(
    `SELECT difficulty, (debrief->>'score')::int AS score
       FROM sales_sim_sessions
      WHERE username=$1 AND track=$2 AND status='finished'
      ORDER BY finished_at DESC LIMIT 20`,
    [username, track]
  );
  const maxClearDiff = Math.max(
    0,
    ...((hist.rows || []).filter((x) => Number(x.score) >= 80).map((x) => Number(x.difficulty) || 0)),
    cleared ? Number(difficulty || 0) : 0
  );

  const ladder = rankLadder(track);
  const currentIdx = Math.max(0, ladder.findIndex((r) => r.key === rankRow.rank_key));
  let targetIdx = currentIdx;
  for (let i = ladder.length - 1; i >= 0; i -= 1) {
    const req = ladder[i];
    if (req.mentor) continue; // 导师需人工标记，自动路径最高到销冠/金牌
    if (newMinutes >= req.minMinutes && avg >= req.minAvg && maxClearDiff >= req.minDifficultyClear) {
      targetIdx = i;
      break;
    }
  }
  // 不允许一次跳超过一级
  if (targetIdx > currentIdx + 1) targetIdx = currentIdx + 1;

  // 保级/降级：近 5 场均分过低则降一级（导师不自动降）
  let demoted = false;
  const recent = (hist.rows || []).slice(0, 5);
  const recentAvg = recent.length
    ? recent.reduce((a, x) => a + Number(x.score || 0), 0) / recent.length
    : avg;
  const currentIsMentor = !!ladder[currentIdx]?.mentor;
  if (!currentIsMentor && currentIdx > 0 && recent.length >= 5 && recentAvg < 55 && score < 50) {
    targetIdx = currentIdx - 1;
    demoted = true;
  } else if (targetIdx < currentIdx && !demoted) {
    targetIdx = currentIdx;
  }

  // 导师：达标 + mentor_eligible 才可自动升到导师档
  const mentorTier = ladder.find((r) => r.mentor);
  const mentorIdx = ladder.findIndex((r) => r.mentor);
  if (
    mentorTier && mentorIdx >= 0
    && rankRow.mentor_eligible
    && newMinutes >= mentorTier.minMinutes
    && avg >= mentorTier.minAvg
    && maxClearDiff >= mentorTier.minDifficultyClear
    && !demoted
  ) {
    targetIdx = mentorIdx;
  }

  const toRank = ladder[targetIdx].key;
  await pool.query(
    `UPDATE sales_sim_ranks SET effective_minutes=$3, rank_key=$4, promoted_at=CASE WHEN rank_key<>$4 THEN NOW() ELSE promoted_at END,
       meta = meta || $5::jsonb
     WHERE username=$1 AND track=$2`,
    [username, track, newMinutes, toRank, JSON.stringify({ last_avg: Math.round(avg), max_clear_diff: maxClearDiff, recent_avg: Math.round(recentAvg) })]
  );

  if (toRank !== rankRow.rank_key) {
    await pool.query(
      `INSERT INTO sales_sim_rank_events (username, track, from_rank, to_rank, reason, meta)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        username, track, rankRow.rank_key, toRank,
        demoted ? 'auto_demote' : 'auto_promote',
        JSON.stringify({ avg, minutes: newMinutes, maxClearDiff, recentAvg }),
      ]
    );
  }

  let nextRank = null;
  for (let i = targetIdx + 1; i < ladder.length; i += 1) {
    if (!ladder[i].mentor || rankRow.mentor_eligible) { nextRank = ladder[i]; break; }
  }

  return {
    rank_key: toRank,
    rank_label: rankLabel(track, toRank),
    effective_minutes: newMinutes,
    promoted: !demoted && toRank !== rankRow.rank_key,
    demoted,
    daily_counted: countsForRank,
    next: nextRank ? {
      rank_key: nextRank.key,
      rank_label: nextRank.label,
      need_minutes: Math.max(0, nextRank.minMinutes - newMinutes),
      need_avg: nextRank.minAvg,
      need_difficulty: nextRank.minDifficultyClear,
    } : null,
  };
}

/** 主管标记可带教 → 允许升导师档 */
export async function setMentorEligible(pool, { username, track, eligible = true, actor }) {
  await getOrInitRank(pool, username, track);
  await pool.query(
    `UPDATE sales_sim_ranks SET mentor_eligible=$3,
       meta = COALESCE(meta,'{}'::jsonb) || $4::jsonb
     WHERE username=$1 AND track=$2`,
    [username, track, !!eligible, JSON.stringify({ mentor_marked_by: actor || null, mentor_marked_at: new Date().toISOString() })]
  );
  return getRankStatus(pool, username, track);
}

export async function getRankStatus(pool, username, track) {
  const row = await getOrInitRank(pool, username, track);
  const profile = await pool.query(
    `SELECT * FROM sales_sim_skill_profiles WHERE username=$1 AND track=$2`,
    [username, track]
  );
  const ladder = rankLadder(track);
  const idx = ladder.findIndex((r) => r.key === row.rank_key);
  let nextRank = null;
  for (let i = idx + 1; i < ladder.length; i += 1) {
    if (!ladder[i].mentor) { nextRank = ladder[i]; break; }
  }
  return {
    track,
    rank_key: row.rank_key,
    rank_label: rankLabel(track, row.rank_key),
    effective_minutes: Number(row.effective_minutes || 0),
    mentor_eligible: !!row.mentor_eligible,
    skills: profile.rows?.[0]?.skills || {},
    sessions_count: Number(profile.rows?.[0]?.sessions_count || 0),
    ladder: ladder.map((r) => ({ key: r.key, label: r.label, mentor: !!r.mentor })),
    next: nextRank ? {
      rank_key: nextRank.key,
      rank_label: nextRank.label,
      need_minutes: Math.max(0, nextRank.minMinutes - Number(row.effective_minutes || 0)),
      need_avg: nextRank.minAvg,
      need_difficulty: nextRank.minDifficultyClear,
    } : null,
  };
}
