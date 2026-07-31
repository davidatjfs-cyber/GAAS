/**
 * Talent Engine — Coach Memory（规则态自适应焦点，非聊天记忆）
 */

const MAX_RECENT = 8;
const DEFAULT_BOOST_HOURS = 72;

export async function getCoachMemory(pool, username, jobProfileKey) {
  const r = await pool.query(
    `SELECT * FROM talent_coach_memory
      WHERE username=$1 AND job_profile_key=$2`,
    [username, jobProfileKey]
  );
  return r.rows?.[0] || null;
}

/**
 * 根据本场技能分更新焦点：弱项提升出题权重窗口
 * @param {{ skills: Record<string, number>, personaKey?: string, scenarioKeys?: string[], passScore?: number }} result
 */
export async function updateCoachMemoryFromSession(pool, {
  username,
  jobProfileKey,
  skills = {},
  personaKey = null,
  scenarioKeys = [],
  passScore = 75,
  boostHours = DEFAULT_BOOST_HOURS,
}) {
  if (!username || !jobProfileKey) return null;

  const ranked = Object.entries(skills)
    .map(([k, v]) => [k, Number(v)])
    .filter(([, v]) => !Number.isNaN(v))
    .sort((a, b) => a[1] - b[1]);

  const focus = ranked
    .filter(([, v]) => v < passScore)
    .slice(0, 3)
    .map(([k]) => k);
  if (!focus.length && ranked.length) focus.push(ranked[0][0]);

  const prev = await getCoachMemory(pool, username, jobProfileKey);
  const recentPersonas = pushUnique(prev?.recent_persona_keys, personaKey, MAX_RECENT);
  const recentScenarios = pushUnique(prev?.recent_scenario_keys, scenarioKeys, MAX_RECENT);
  const boostUntil = new Date(Date.now() + boostHours * 3600 * 1000).toISOString();

  const r = await pool.query(
    `INSERT INTO talent_coach_memory
       (username, job_profile_key, focus_competencies, boost_until,
        recent_persona_keys, recent_scenario_keys, meta, updated_at)
     VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7::jsonb,NOW())
     ON CONFLICT (username, job_profile_key) DO UPDATE SET
       focus_competencies = EXCLUDED.focus_competencies,
       boost_until = EXCLUDED.boost_until,
       recent_persona_keys = EXCLUDED.recent_persona_keys,
       recent_scenario_keys = EXCLUDED.recent_scenario_keys,
       meta = EXCLUDED.meta,
       updated_at = NOW()
     RETURNING *`,
    [
      username,
      jobProfileKey,
      JSON.stringify(focus),
      boostUntil,
      JSON.stringify(recentPersonas),
      JSON.stringify(recentScenarios),
      JSON.stringify({ last_skills: skills }),
    ]
  );
  return r.rows?.[0] || null;
}

function pushUnique(existing, incoming, max) {
  const arr = Array.isArray(existing)
    ? existing.slice()
    : (typeof existing === 'string' ? safeJson(existing, []) : []);
  const add = Array.isArray(incoming) ? incoming : (incoming ? [incoming] : []);
  for (const item of add) {
    if (!item) continue;
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
    arr.unshift(item);
  }
  return arr.slice(0, max);
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/** 若记忆仍在 boost 窗口内，优先用 focus 作为出题焦点 */
export function resolveFocusFromMemory(memory, fallbackFocus) {
  if (!memory) return fallbackFocus;
  const until = memory.boost_until ? new Date(memory.boost_until).getTime() : 0;
  if (until && until < Date.now()) return fallbackFocus;
  const focus = Array.isArray(memory.focus_competencies)
    ? memory.focus_competencies
    : safeJson(memory.focus_competencies, []);
  return focus[0] || fallbackFocus;
}

export function recentPersonaSet(memory) {
  const arr = Array.isArray(memory?.recent_persona_keys)
    ? memory.recent_persona_keys
    : safeJson(memory?.recent_persona_keys, []);
  return new Set(arr);
}
