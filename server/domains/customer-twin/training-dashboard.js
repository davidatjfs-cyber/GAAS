/**
 * 全局训练看板（店长/总部经理/管理员可见）
 * 聚合：应训人数、参与率、周训练量、技能通过率/均分、门店对比、
 * 个人每日训练（近 7 天）、未完成训练、连续未练天数、重点跟进、本周积极之星、校准一致性。
 */

export const TRAIN_MANAGER_ROLES = ['admin', 'hq_manager', 'store_manager', 'store_production_manager', 'hr_manager'];

const FOH_RE = /前厅|服务员|收银|迎宾|传菜|水吧|领班|主管|经理|店长|营运|接待|咨客/;
const BACK_RE = /后厨|厨房|厨师|炒锅|烧味|打荷|切配|砧板|洗碗|汤档|煲仔|水台/;

function isFohEmployee(e) {
  const dept = String(e?.department || '').trim();
  const pos = String(e?.position || '').trim();
  if (BACK_RE.test(dept) || BACK_RE.test(pos)) return false;
  return FOH_RE.test(dept) || FOH_RE.test(pos) || String(e?.role || '') === 'store_manager';
}

function sessionScore(aiScore) {
  const vals = Object.values(aiScore || {});
  if (!vals.length) return null;
  const nums = vals.map((v) => Number(v)).filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function toDateKey(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function last7DayKeys() {
  const keys = [];
  for (let i = 6; i >= 0; i -= 1) keys.push(toDateKey(Date.now() - i * 86400000));
  return keys;
}

function roundPct(a, b) {
  return b ? Math.round((a / b) * 100) : null;
}

async function loadStaff(pool, { role = '', store = '', allowedStores = [] } = {}) {
  const stateR = await pool.query(`SELECT data FROM hrms_state WHERE key = 'default' LIMIT 1`);
  const employees = Array.isArray(stateR.rows?.[0]?.data?.employees) ? stateR.rows[0].data.employees : [];
  const managerStores = [store, ...(Array.isArray(allowedStores) ? allowedStores : [])]
    .map((s) => String(s || '').trim()).filter(Boolean);
  const isGlobal = ['admin', 'hq_manager', 'hr_manager'].includes(String(role || '').trim());
  const staff = employees.filter((e) => {
    if (String(e?.status || 'active').trim() !== 'active') return false;
    if (!isFohEmployee(e)) return false;
    const empStore = String(e?.store || '').trim();
    return isGlobal || !managerStores.length || managerStores.includes(empStore);
  });
  const staffByUser = new Map(staff.map((e) => [String(e?.username || '').toLowerCase(), e]));
  return { staff, staffByUser };
}

async function loadTrainingData(pool, staffByUser) {
  const [sessionsR, activeR, progressR, skillsR, calR] = await Promise.all([
    pool.query(`SELECT username, skill_key, success, ai_score, finished_at
                  FROM customer_twin_coach_sessions WHERE status = 'finished'`),
    pool.query(`SELECT username, skill_key, started_at
                  FROM customer_twin_coach_sessions WHERE status = 'active'`),
    pool.query(`SELECT username, skill_key, level, trained_count, success_count, updated_at
                  FROM job_coach_skill_progress`),
    pool.query(`SELECT skill_key, label, sort_order FROM job_coach_skills WHERE active = TRUE ORDER BY sort_order`),
    pool.query(`SELECT count(*)::int AS total,
                       round(avg((agreement->>'rate')::numeric), 0) AS avg_rate,
                       count(*) FILTER (WHERE (agreement->>'rate')::numeric >= 85) AS above_85
                  FROM customer_twin_calibration`),
  ]);
  const inScope = (r) => staffByUser.has(String(r.username || '').toLowerCase());
  const sessions = (sessionsR.rows || []).filter(inScope);
  const activeSessions = (activeR.rows || []).filter(inScope);
  const progress = (progressR.rows || []).filter(inScope);
  const skillMeta = new Map((skillsR.rows || []).map((s) => [s.skill_key, s]));
  const activeByUser = new Map();
  for (const s of activeSessions) {
    const uname = String(s.username || '').toLowerCase();
    activeByUser.set(uname, (activeByUser.get(uname) || 0) + 1);
  }
  return {
    sessions,
    activeSessions,
    progress,
    skillMeta,
    calStats: calR.rows?.[0] || { total: 0, avg_rate: 0, above_85: 0 },
    weekAgo: Date.now() - 7 * 86400000,
    activeByUser,
  };
}

function aggregateBySkill(skills, sessions) {
  const bySkill = {};
  for (const s of skills) {
    bySkill[s.skill_key] = {
      skill_key: s.skill_key, label: s.label, sessions: 0, pass: 0, scoreSum: 0, scoreN: 0, trainedUsers: [],
    };
  }
  for (const s of sessions) {
    const b = bySkill[s.skill_key];
    if (!b) continue;
    b.sessions += 1;
    if (s.success) b.pass += 1;
    const sc = sessionScore(s.ai_score);
    if (sc != null) { b.scoreSum += sc; b.scoreN += 1; }
    if (!b.trainedUsers.includes(s.username)) b.trainedUsers.push(s.username);
  }
  return Object.values(bySkill).map((b) => ({
    skill_key: b.skill_key,
    label: b.label,
    sessions: b.sessions,
    trained_users: b.trainedUsers.length,
    avg_score: b.scoreN ? Math.round(b.scoreSum / b.scoreN) : null,
    pass_rate: roundPct(b.pass, b.sessions),
  }));
}

function aggregateByStore(staff, sessions, progress, weekAgo) {
  const stores = [...new Set(staff.map((e) => String(e?.store || '未分配门店').trim()))].sort();
  return stores.map((storeName) => {
    const list = staff.filter((e) => String(e?.store || '未分配门店').trim() === storeName);
    const usernames = new Set(list.map((e) => String(e?.username || '').toLowerCase()));
    const ss = sessions.filter((s) => usernames.has(String(s.username || '').toLowerCase()));
    const pr = progress.filter((p) => usernames.has(String(p.username || '').toLowerCase()));
    const scores = ss.map((s) => sessionScore(s.ai_score)).filter((v) => v != null);
    return {
      store: storeName,
      staff_count: list.length,
      trained_staff: pr.length,
      sessions: ss.length,
      week_sessions: ss.filter((s) => new Date(s.finished_at || 0).getTime() >= weekAgo).length,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      pass_rate: roundPct(ss.filter((s) => s.success).length, ss.length),
    };
  });
}

function buildStaffDetail(staff, sessions, progress, activeByUser, skillMeta) {
  const dayKeys = last7DayKeys();
  return staff.map((e) => {
    const uname = String(e?.username || '').toLowerCase();
    const pr = progress.filter((p) => String(p.username || '').toLowerCase() === uname);
    const ss = sessions.filter((s) => String(s.username || '').toLowerCase() === uname);
    const scores = ss.map((s) => sessionScore(s.ai_score)).filter((v) => v != null);
    const lastFinished = ss.length ? ss.map((s) => s.finished_at).sort().pop() : null;
    const byDay = new Map(dayKeys.map((k) => [k, { date: k, sessions: 0, completed: 0, passed: 0, failed: 0, avgSum: 0, avgN: 0 }]));
    for (const s of ss) {
      const key = toDateKey(s.finished_at);
      const day = byDay.get(key);
      if (!day) continue;
      day.sessions += 1;
      day.completed += 1;
      if (s.success) day.passed += 1; else day.failed += 1;
      const sc = sessionScore(s.ai_score);
      if (sc != null) { day.avgSum += sc; day.avgN += 1; }
    }
    const recentDays = dayKeys.map((k) => {
      const day = byDay.get(k);
      return {
        date: k,
        sessions: day.sessions,
        completed: day.completed,
        passed: day.passed,
        failed: day.failed,
        avg_score: day.avgN ? Math.round(day.avgSum / day.avgN) : null,
      };
    });
    const weekDaysTrained = recentDays.filter((d) => d.sessions > 0).length;
    const weekSessions = recentDays.reduce((a, d) => a + d.sessions, 0);
    let consecutiveMissed = 0;
    for (const day of [...recentDays].reverse()) {
      if (day.sessions > 0) break;
      consecutiveMissed += 1;
    }
    const skills = pr.map((p) => ({
      skill_key: p.skill_key,
      label: skillMeta.get(p.skill_key)?.label || p.skill_key,
      level: p.level,
      trained_count: Number(p.trained_count || 0),
      success_count: Number(p.success_count || 0),
    }));
    return {
      username: e.username,
      name: e.name || e.username,
      store: e.store || '',
      position: e.position || '',
      trained_count: pr.reduce((a, p) => a + Number(p.trained_count || 0), 0),
      total_sessions: ss.length,
      incomplete_sessions: activeByUser.get(uname) || 0,
      week_sessions: weekSessions,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      last_finished_at: lastFinished || null,
      week_days_trained: weekDaysTrained,
      consecutive_missed_days: consecutiveMissed,
      recent_days: recentDays,
      skills,
    };
  }).sort((a, b) => String(a.store || '').localeCompare(String(b.store || ''), 'zh')
    || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
}

function buildAttention(staffDetail) {
  return staffDetail
    .filter((x) => x.total_sessions === 0 || x.incomplete_sessions > 0 || x.consecutive_missed_days >= 7)
    .map((x) => {
      const reasons = [];
      if (x.total_sessions === 0) reasons.push('从未参训');
      if (x.incomplete_sessions > 0) reasons.push(`有 ${x.incomplete_sessions} 次训练未完成`);
      if (x.consecutive_missed_days >= 7) reasons.push(`已连续 ${x.consecutive_missed_days} 天未训练`);
      return {
        username: x.username,
        name: x.name,
        store: x.store,
        position: x.position,
        reasons,
        total_sessions: x.total_sessions,
        last_finished_at: x.last_finished_at,
      };
    })
    .sort((a, b) => {
      const rank = (x) => (x.reasons.includes('从未参训') ? 3 : x.reasons.some((r) => r.includes('未完成')) ? 2 : 1);
      return rank(b) - rank(a) || String(a.store || '').localeCompare(String(b.store || ''), 'zh');
    });
}

function buildStars(staffDetail) {
  return staffDetail
    .filter((x) => x.total_sessions > 0)
    .sort((a, b) => b.week_days_trained - a.week_days_trained || b.week_sessions - a.week_sessions || (b.avg_score || 0) - (a.avg_score || 0))
    .slice(0, 5)
    .map((x) => ({
      username: x.username,
      name: x.name,
      store: x.store,
      position: x.position,
      week_days_trained: x.week_days_trained,
      week_sessions: x.week_sessions,
      avg_score: x.avg_score,
      total_sessions: x.total_sessions,
    }));
}

export async function trainingDashboard(pool, opts = {}) {
  const { staff, staffByUser } = await loadStaff(pool, opts);
  const data = await loadTrainingData(pool, staffByUser);
  const { sessions, activeSessions, progress, skillMeta, calStats, weekAgo } = data;

  const bySkill = aggregateBySkill([...skillMeta.values()], sessions);
  const byStore = aggregateByStore(staff, sessions, progress, weekAgo);
  const staffDetail = buildStaffDetail(staff, sessions, progress, data.activeByUser || new Map(), skillMeta);

  const trainedUsernames = new Set(progress.map((p) => String(p.username || '').toLowerCase()));
  const notTrained = staff
    .filter((e) => !trainedUsernames.has(String(e?.username || '').toLowerCase()))
    .map((e) => ({ username: e.username, name: e.name || e.username, store: e.store || '', position: e.position || '' }));

  const scoredSkills = bySkill.filter((b) => b.sessions > 0);
  const weakest = [...scoredSkills]
    .sort((a, b) => (a.pass_rate ?? 101) - (b.pass_rate ?? 101) || (a.avg_score ?? 0) - (b.avg_score ?? 0))
    .slice(0, 5)
    .map((b) => ({ skill_key: b.skill_key, label: b.label, sessions: b.sessions, avg_score: b.avg_score, pass_rate: b.pass_rate }));

  const totalScores = sessions.map((s) => sessionScore(s.ai_score)).filter((v) => v != null);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    totals: {
      staff_count: staff.length,
      trained_staff: trainedUsernames.size,
      participation_rate: roundPct(trainedUsernames.size, staff.length) || 0,
      total_sessions: sessions.length,
      week_sessions: sessions.filter((s) => new Date(s.finished_at || 0).getTime() >= weekAgo).length,
      incomplete_sessions: activeSessions.length,
      avg_score: totalScores.length ? Math.round(totalScores.reduce((a, b) => a + b, 0) / totalScores.length) : null,
      pass_rate: roundPct(sessions.filter((s) => s.success).length, sessions.length),
    },
    by_skill: bySkill,
    by_store: byStore,
    weakest_skills: weakest,
    staff_detail: staffDetail,
    not_trained: notTrained,
    attention: buildAttention(staffDetail),
    active_stars: buildStars(staffDetail),
    calibration: {
      total: Number(calStats.total || 0),
      avg_rate: Number(calStats.avg_rate || 0),
      above_85: Number(calStats.above_85 || 0),
    },
  };
}
