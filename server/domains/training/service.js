/**
 * Training domain service: schema, promotion/track progress, assignments, development map.
 */
import { pool, createTrainingUserNotification, sendTrainingFeishuMessage } from './shared.js';

// 某岗位+级别的晋升能力要求 = 标记了 promotion_required 且 position 包含该岗位、level 匹配该级别的知识点
// level 留空时不按级别过滤（兼容未设置级别体系的旧知识点）
export async function getPromotionRequiredTopics(position, level) {
  const pos = String(position || '').trim();
  if (!pos) return [];
  const lvl = String(level || '').trim();
  const params = [pos, pos + ',%', '%,' + pos, '%,' + pos + ',%'];
  let levelClause = '';
  if (lvl) {
    params.push(lvl);
    levelClause = ` AND level = $${params.length}`;
  }
  const r = await pool().query(
    `SELECT * FROM training_topics
     WHERE is_active = true AND promotion_required = true
       AND (position = $1 OR position LIKE $2 OR position LIKE $3 OR position LIKE $4)
       ${levelClause}
     ORDER BY sort_order, id`,
    params
  );
  return r.rows || [];
}

// 厨师长晋升阶段一前提："任一专业线达最高技师级 + 第二条线达L2"
// 各专业线的最高级 / L2级 命名（与该 position 下 training_topics.level 对应）
const KITCHEN_TRACK_LEVELS = {
  '炒锅': { top: 'T2', l2: 'T1' },
  '砧板': { top: 'T2', l2: 'T1' },
  '烧味/卤水': { top: 'T2', l2: 'T1' },
  '刺身': { top: 'T2', l2: 'T1' },
};

export async function getCrossTrackTechnicianStatus(username) {
  const tracks = Object.keys(KITCHEN_TRACK_LEVELS);
  const status = {};
  for (const track of tracks) {
    const { top, l2 } = KITCHEN_TRACK_LEVELS[track];
    const topTopics = await getPromotionRequiredTopics(track, top);
    const l2Topics = await getPromotionRequiredTopics(track, l2);
    const topProgress = await getPromotionTrackProgress(username, topTopics.map(t => t.id));
    const l2Progress = await getPromotionTrackProgress(username, l2Topics.map(t => t.id));
    status[track] = { topLevel: top, l2Level: l2, topPassed: topProgress.passed, l2Passed: l2Progress.passed };
  }
  const topTracks = tracks.filter(t => status[t].topPassed);
  const eligible = topTracks.some(top => tracks.some(other => other !== top && status[other].l2Passed));
  return { tracks: status, topTracks, eligible };
}

// 创建一条培训指派（统一入口：管理员手动指派 / 异常触发 / 晋升要求 / 到期复训均走此函数）
export async function createTrainingAssignment({ employeeUsername, topicId, assignedBy, dueDate, note, requirePractice, source, relatedTrackId, tenantId }) {
  const username = String(employeeUsername || '').trim();
  if (!username || !topicId) return null;
  const topicRes = await pool().query(`SELECT title FROM training_topics WHERE id = $1`, [topicId]);
  const topicTitle = topicRes.rows[0]?.title || '培训任务';
  const tid = String(tenantId || 'default').trim() || 'default';
  const r = await pool().query(
    `INSERT INTO training_assignments (employee_username, topic_id, assigned_by, due_date, note, require_practice, source, related_track_id, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [username, topicId, String(assignedBy || '').trim() || null, dueDate || null, note || '', !!requirePractice, String(source || 'manual'), relatedTrackId ? String(relatedTrackId) : null, tid]
  );
  const row = r.rows[0];
  if (!row) return null;

  let assignerName = String(assignedBy || '').trim() || '系统';
  if (assignerName && assignerName !== '系统') {
    const ar = await pool().query(`SELECT name FROM employees WHERE username = $1 LIMIT 1`, [assignerName]);
    if (ar.rows[0]?.name) assignerName = ar.rows[0].name;
  }
  await createTrainingUserNotification(
    username,
    '你有新的培训任务',
    `${assignerName} 为你指派了培训任务「${topicTitle}」${dueDate ? '，截止日期：' + dueDate : ''}，请尽快完成。`,
    { topic_id: topicId, topic_title: topicTitle, assigned_by: assignedBy || null, source: source || 'manual', related_track_id: relatedTrackId || null }
  );
  await sendTrainingFeishuMessage(
    username,
    `📚 培训任务通知\n\n${assignerName} 为您指派了培训任务：\n【${topicTitle}】\n${dueDate ? '截止日期：' + dueDate + '\n' : ''}${note ? '备注：' + note + '\n' : ''}\n请登录 HRMS 系统完成培训。`
  );
  return row;
}

// 晋升资格的培训认证进度（系统自动判定考核结果，去掉人工考核环节）
// 通过 = 每个晋升能力要求知识点都有一条有效（valid）且经理已确认通过（manager_verdict='passed'）的认证
export async function getPromotionTrackProgress(applicantUsername, requiredTopicIds) {
  const username = String(applicantUsername || '').trim();
  const ids = Array.isArray(requiredTopicIds) ? requiredTopicIds.filter(x => x != null) : [];
  if (!username || !ids.length) return { total: ids.length, certifiedCount: 0, passed: ids.length === 0, items: [] };

  const r = await pool().query(
    `SELECT t.id AS topic_id, t.title,
            c.manager_verdict, c.review_status, c.valid_until, c.status AS cert_status,
            c.legacy_accepted, c.certified_at
     FROM training_topics t
     LEFT JOIN LATERAL (
       SELECT * FROM training_certifications
       WHERE employee_username = $1 AND topic_id = t.id
       ORDER BY created_at DESC LIMIT 1
     ) c ON true
     WHERE t.id = ANY($2)`,
    [username, ids]
  );
  const items = r.rows.map(row => ({
    topicId: row.topic_id,
    title: row.title,
    certified: (row.manager_verdict === 'passed' || row.legacy_accepted === true)
      && (row.cert_status || 'valid') === 'valid',
    validUntil: row.valid_until || null,
    certifiedAt: row.certified_at || null
  }));
  const certifiedCount = items.filter(i => i.certified).length;
  return { total: items.length, certifiedCount, passed: items.length > 0 && certifiedCount === items.length, items };
}

// ─── 发展地图（我的档案首页）─────────────────────────────────
// 岗位 → 该岗位的级别阶梯（顺序）。与生产 training_topics.position/level 对齐。
const POSITION_LADDER = {
  '打荷': ['T1', 'T2'], '汤档/煲仔': ['T1', 'T2'], '刺身': ['T1', 'T2'],
  '烧味/卤水': ['T1', 'T2'], '砧板': ['T1', 'T2'], '炒锅': ['T1', 'T2'],
  '出品经理': ['T2', 'T3'], '洗碗': ['T1'],
  '传菜': ['L1'], '服务员': ['L2'], '水吧': ['L1', 'L2', 'L3'], '收银员': ['L1', 'L2'],
  '主管': ['M1'], '前厅经理': ['M2'], '门店店长': ['M3'],
};
const LEVEL_LABEL = {
  T1: 'T1 合格', T2: 'T2 师傅', T3: 'T3 厨师长',
  L1: 'L1', L2: 'L2', L3: 'L3', M1: 'M1 主管', M2: 'M2 经理', M3: 'M3 店长',
};
const POSITION_DISPLAY = { '出品经理': '厨师长', '烧味/卤水': '烧味', '汤档/煲仔': '汤档', '门店店长': '店长' };
// 厨房技术难度主路 / 前厅成长主路（横向）
const KITCHEN_MAIN_PATH = ['打荷', '汤档/煲仔', '刺身', '烧味/卤水', '砧板', '炒锅', '出品经理'];
const FRONT_MAIN_PATH = ['传菜', '服务员', '主管', '前厅经理', '门店店长'];

export async function getMyDevelopmentMap(username) {
  const uname = String(username || '').trim();
  if (!uname) return null;
  const er = await pool().query(`SELECT position, extra_json FROM employees WHERE username = $1 LIMIT 1`, [uname]);
  const emp = er.rows[0] || {};
  const position = String(emp.position || '').trim();
  const ej = emp.extra_json && typeof emp.extra_json === 'object' ? emp.extra_json : {};
  const currentLevel = String(ej.level || ej.jobLevel || ej.rank || '').trim();

  // 级别阶梯（优先配置，兜底用库里该岗位实际有的级别）
  let levels = POSITION_LADDER[position];
  if (!levels) {
    const lr = await pool().query(
      `SELECT DISTINCT level FROM training_topics WHERE is_active AND promotion_required AND position = $1 AND level IS NOT NULL AND level <> ''`,
      [position]
    );
    levels = lr.rows.map(r => r.level).sort();
  }
  const ladder = [];
  for (const lv of (levels || [])) {
    const topics = await getPromotionRequiredTopics(position, lv);
    const prog = await getPromotionTrackProgress(uname, topics.map(t => t.id));
    ladder.push({
      level: lv, label: LEVEL_LABEL[lv] || lv,
      total: prog.total, certified: prog.certifiedCount,
      complete: prog.total > 0 && prog.passed,
      isCurrent: lv === currentLevel,
    });
  }

  // 横向主路
  let path = null;
  const inKitchen = KITCHEN_MAIN_PATH.includes(position);
  const inFront = FRONT_MAIN_PATH.includes(position);
  if (inKitchen || inFront) {
    const arr = inKitchen ? KITCHEN_MAIN_PATH : FRONT_MAIN_PATH;
    path = {
      type: inKitchen ? 'kitchen' : 'front',
      note: inKitchen ? '厨房技术难度主路（参考，可专精/按需调岗）' : '前厅成长主路（参考）',
      nodes: arr.map(p => ({ position: p, display: POSITION_DISPLAY[p] || p, isCurrent: p === position, isApex: p === '出品经理' || p === '门店店长' })),
    };
  } else if (position === '洗碗') {
    path = { type: 'feeder', note: '保洁岗精进后可转「打荷」进入厨房技术主路', nodes: [] };
  }

  // 下一步提示：以"当前级别"为基准 —— 当前级别未达标 → 提示补齐当前级别；
  // 当前级别已达标且阶梯里有下一级 → 提示可申请晋升下一级；否则按主路提示下一岗位。
  let nextStep = '';
  let cta = null;
  const curIdx = ladder.findIndex(l => l.isCurrent);
  const cur = curIdx >= 0 ? ladder[curIdx] : null;
  const next = curIdx >= 0 && curIdx + 1 < ladder.length ? ladder[curIdx + 1] : null;

  if (cur && cur.total > 0 && !cur.complete) {
    const remain = cur.total - cur.certified;
    nextStep = `当前级别「${cur.label}」还需认证 ${remain}/${cur.total} 项能力`;
    cta = { text: '要升职，先培训', action: 'promotion' };
  } else if (next) {
    nextStep = `当前级别「${cur ? cur.label : (LEVEL_LABEL[currentLevel] || currentLevel)}」能力已达标，可申请晋升至「${next.label}」（需认证 ${next.total} 项能力）`;
    cta = { text: '要升职，先培训', action: 'promotion' };
  } else if (inKitchen && position !== '出品经理' && (!cur || cur.complete || cur.total === 0)) {
    const ni = KITCHEN_MAIN_PATH.indexOf(position);
    const nextPos = KITCHEN_MAIN_PATH[ni + 1];
    nextStep = nextPos ? `本岗位已达顶，可沿主路进入「${POSITION_DISPLAY[nextPos] || nextPos}」继续成长` : '本岗位能力已全部认证 ✅';
  } else {
    nextStep = '本岗位能力已全部认证 ✅';
  }

  return { position, positionDisplay: POSITION_DISPLAY[position] || position, currentLevel, ladder, path, nextStep, cta };
}
