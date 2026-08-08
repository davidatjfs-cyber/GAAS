/**
 * 全局训练看板（店长/总部经理/管理员可见）
 * 聚合：应训人数、参与率、周训练量、技能通过率/均分、门店对比、个人明细、未训名单、校准一致性。
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

export async function trainingDashboard(pool, { role = '', store = '', allowedStores = [] } = {}) {
  const stateR = await pool.query(
    `SELECT data FROM hrms_state WHERE key = 'default' LIMIT 1`
  );
  const employees = Array.isArray(stateR.rows?.[0]?.data?.employees) ? stateR.rows[0].data.employees : [];
  const managerStores = [store, ...(Array.isArray(allowedStores) ? allowedStores : [])].map((s) => String(s || '').trim()).filter(Boolean);
  const isGlobal = ['admin', 'hq_manager', 'hr_manager'].includes(String(role || '').trim());

  const staff = employees.filter((e) => {
    if (String(e?.status || 'active').trim() === '离职') return false;
    if (!isFohEmployee(e)) return false;
    const empStore = String(e?.store || '').trim();
    return isGlobal || !managerStores.length || managerStores.includes(empStore);
  });
  const staffByUser = new Map(staff.map((e) => [String(e?.username || '').toLowerCase(), e]));

  const [sessionsR, progressR, skillsR, calR] = await Promise.all([
    pool.query(
      `SELECT username, skill_key, success, ai_score, finished_at
         FROM customer_twin_coach_sessions
        WHERE status = 'finished'`
    ),
    pool.query(
      `SELECT username, skill_key, level, trained_count, success_count, updated_at
         FROM job_coach_skill_progress`
    ),
    pool.query(
      `SELECT skill_key, label, sort_order FROM job_coach_skills WHERE active = TRUE ORDER BY sort_order`
    ),
    pool.query(
      `SELECT count(*)::int AS total,
              round(avg((agreement->>'rate')::numeric), 0) AS avg_rate,
              count(*) FILTER (WHERE (agreement->>'rate')::numeric >= 85) AS above_85
         FROM customer_twin_calibration`
    ),
  ]);

  const sessions = (sessionsR.rows || []).filter((s) => staffByUser.has(String(s.username || '').toLowerCase()));
  const progress = (progressR.rows || []).filter((p) => staffByUser.has(String(p.username || '').toLowerCase()));
  const weekAgo = Date.now() - 7 * 86400000;
  const weekSessions = sessions.filter((s) => new Date(s.finished_at || 0).getTime() >= weekAgo);

  const skillMeta = new Map((skillsR.rows || []).map((s) => [s.skill_key, s]));
  const bySkill = {};
  for (const s of skillsR.rows || []) {
    bySkill[s.skill_key] = { skill_key: s.skill_key, label: s.label, sessions: 0, pass: 0, scoreSum: 0, scoreN: 0, trainedUsers: [] };
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
  const bySkillOut = Object.values(bySkill).map((b) => ({
    skill_key: b.skill_key,
    label: b.label,
    sessions: b.sessions,
    trained_users: b.trainedUsers.length,
    avg_score: b.scoreN ? Math.round(b.scoreSum / b.scoreN) : null,
    pass_rate: b.sessions ? Math.round((b.pass / b.sessions) * 100) : null,
  }));

  const stores = [...new Set(staff.map((e) => String(e?.store || '未分配门店').trim()))].sort();
  const byStore = stores.map((storeName) => {
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
      pass_rate: ss.length ? Math.round((ss.filter((s) => s.success).length / ss.length) * 100) : null,
    };
  });

  const staffDetail = staff.map((e) => {
    const uname = String(e?.username || '').toLowerCase();
    const pr = progress.filter((p) => String(p.username || '').toLowerCase() === uname);
    const ss = sessions.filter((s) => String(s.username || '').toLowerCase() === uname);
    const scores = ss.map((s) => sessionScore(s.ai_score)).filter((v) => v != null);
    const lastFinished = ss.length ? ss.map((s) => s.finished_at).sort().pop() : null;
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
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      last_finished_at: lastFinished || null,
      skills,
    };
  });
  staffDetail.sort((a, b) => String(a.store || '').localeCompare(String(b.store || ''), 'zh') || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));

  const trainedUsernames = new Set(progress.map((p) => String(p.username || '').toLowerCase()));
  const notTrained = staff
    .filter((e) => !trainedUsernames.has(String(e?.username || '').toLowerCase()))
    .map((e) => ({ username: e.username, name: e.name || e.username, store: e.store || '', position: e.position || '' }));

  const scoredSkills = bySkillOut.filter((b) => b.sessions > 0);
  const weakest = [...scoredSkills]
    .sort((a, b) => (a.pass_rate ?? 101) - (b.pass_rate ?? 101) || (a.avg_score ?? 0) - (b.avg_score ?? 0))
    .slice(0, 5)
    .map((b) => ({ skill_key: b.skill_key, label: b.label, sessions: b.sessions, avg_score: b.avg_score, pass_rate: b.pass_rate }));

  const totalScores = sessions.map((s) => sessionScore(s.ai_score)).filter((v) => v != null);
  const calStats = calR.rows?.[0] || { total: 0, avg_rate: 0, above_85: 0 };

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    totals: {
      staff_count: staff.length,
      trained_staff: trainedUsernames.size,
      participation_rate: staff.length ? Math.round((trainedUsernames.size / staff.length) * 100) : 0,
      total_sessions: sessions.length,
      week_sessions: weekSessions.length,
      avg_score: totalScores.length ? Math.round(totalScores.reduce((a, b) => a + b, 0) / totalScores.length) : null,
      pass_rate: sessions.length ? Math.round((sessions.filter((s) => s.success).length / sessions.length) * 100) : null,
    },
    by_skill: bySkillOut,
    by_store: byStore,
    weakest_skills: weakest,
    staff_detail: staffDetail,
    not_trained: notTrained,
    calibration: {
      total: Number(calStats.total || 0),
      avg_rate: Number(calStats.avg_rate || 0),
      above_85: Number(calStats.above_85 || 0),
    },
  };
}
