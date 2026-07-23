/**
 * HRMS 培训认证模块
 *
 * 功能：知识点管理、培训指派、AI 辅助学习、测验、实操判定、认证管理
 * 权限：管理端（admin/hq_manager/store_manager/store_production_manager/hr_manager）
 *       员工端（所有登录用户）
 */

import { pool as getPool, resolveTenantIdDefault, runForActiveTenants } from './utils/database.js';
import { callLLM, callVisionLLM, callVisionLLMVideo, lookupFeishuUserByUsername, sendLarkMessage } from './agents.js';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads', 'training');
function pool() { return getPool(); }

const MANAGER_ROLES = ['admin', 'hq_manager', 'store_manager', 'store_production_manager', 'hr_manager'];
function isManager(role) { return MANAGER_ROLES.includes(role); }
const TRAINING_REMINDER_INTERVAL_MS = Math.max(30 * 60 * 1000, Number(process.env.TRAINING_REMINDER_INTERVAL_MS || 60 * 60 * 1000));
let _trainingReminderSchedulerStarted = false;

// JWT 不含 store，从 employees 表实时查
async function getUserStore(username) {
  try {
    const r = await pool().query(`SELECT store FROM employees WHERE username = $1 LIMIT 1`, [username]);
    return String(r.rows[0]?.store || '').trim();
  } catch (_) { return ''; }
}

// 出题/学习取材：优先用管理员精修过的 AI解析(ai_explanation)，其次原始正文(content)，
// 并附上步骤图谱(step_rubric)的标准类内容。
// 原则：培训内容与考题必须以更新后的 AI解析/知识图谱为准。
function formatRubricStandards(rubric) {
  if (!rubric || !Array.isArray(rubric.items) || rubric.items.length === 0) return '';
  const steps = rubric.items.map((it) => {
    const seq = it.step_seq != null ? `步骤${it.step_seq}` : '步骤';
    const parts = [`${seq}：${it.action || ''}`];
    if (it.quality_standard) parts.push(`质量标准：${it.quality_standard}`);
    if (it.is_critical) parts.push('（关键步骤）');
    if (it.common_failure) parts.push(`常见失败：${it.common_failure}`);
    return '- ' + parts.join('；');
  }).join('\n');
  const fail = Array.isArray(rubric.fail_criteria) && rubric.fail_criteria.length
    ? `\n一票否决项：${rubric.fail_criteria.join('；')}` : '';
  return `【步骤标准图谱（以此为准的操作标准）】\n${steps}${fail}`;
}

function buildKbArticleText(row) {
  const explanation = String(row.ai_explanation || '').trim();
  // 优先用管理员锁定的精修内容或已缓存的AI解析，截断上限提高到12000确保完整内容传入AI上下文
  const base = explanation.length > 50
    ? explanation.slice(0, 12000)
    : String(row.content || '').trim();
  const rubricText = formatRubricStandards(row.step_rubric);
  return rubricText ? `${base}\n\n${rubricText}` : base;
}

// 角色层级：谁能给谁布置培训
// admin/hr_manager → 所有人
// hq_manager → 店长 + 出品经理 + 所有员工
// store_manager → 前厅员工（cashier, front_manager, store_employee）
// store_production_manager → 后厨员工（store_employee，或岗位含厨房关键词）
function getAssignableRoles(assignerRole) {
  if (['admin', 'hr_manager'].includes(assignerRole)) return null; // null = 所有人
  if (assignerRole === 'hq_manager') return ['store_manager', 'store_production_manager', 'store_employee', 'cashier', 'front_manager'];
  if (assignerRole === 'store_manager') return ['store_employee', 'cashier', 'front_manager'];
  if (assignerRole === 'store_production_manager') return ['store_employee'];
  return null;
}

function getShanghaiDateKey(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function parseScoringJson(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    const steps = parsed.steps || [];
    const totalScore = parsed.total_score != null ? Number(parsed.total_score) : null;
    const verdict = ['passed', 'review', 'failed'].includes(parsed.verdict) ? parsed.verdict : 'review';
    const summary = parsed.summary || '';
    // AI sometimes returns the string "null" — treat it as absent
    const failReason = (parsed.fail_reason && parsed.fail_reason !== 'null') ? parsed.fail_reason : null;
    // If fail_reason is present, force failed
    const finalVerdict = failReason ? 'failed' : verdict;
    const feedback = failReason ? `【一票否决】${failReason}。${summary}` : summary;
    return { aiVerdict: finalVerdict, aiFeedback: feedback, aiStepScores: steps, aiTotalScore: totalScore };
  } catch (e) {
    return { aiVerdict: 'review', aiFeedback: '评分解析失败，需人工审核', aiStepScores: null, aiTotalScore: null };
  }
}

function stripJsonCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function repairJsonText(text) {
  let s = stripJsonCodeFence(text);
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

function tryParseQuizJsonFromLLM(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = new Set();
  candidates.add(raw);
  candidates.add(stripJsonCodeFence(raw));
  candidates.add(repairJsonText(raw));

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.add(objectMatch[0]);
    candidates.add(repairJsonText(objectMatch[0]));
  }

  const arrayMatch = raw.match(/"questions"\s*:\s*(\[[\s\S]*)/);
  if (arrayMatch) {
    const arrayChunk = arrayMatch[1];
    for (const suffix of [']}', ']}]}', '"]}', '""}]}']) {
      candidates.add(repairJsonText(`{"questions":${arrayChunk}${suffix}`));
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) { /* ignore */ }
  }

  // 外层 JSON 损坏时，尝试逐题提取完整对象
  const objectPattern = /\{[^{}]*"(?:q|question)"\s*:\s*"[\s\S]*?"options"\s*:\s*\[[^\]]*\][\s\S]*?\}/g;
  const matches = raw.match(objectPattern) || [];
  if (matches.length >= 5) {
    const questions = [];
    for (const m of matches) {
      try {
        questions.push(JSON.parse(repairJsonText(m)));
      } catch (_) { /* ignore */ }
    }
    if (questions.length >= 5) return { questions };
  }

  return null;
}

function normalizeQuizAnswerIndex(answerRaw, options) {
  const opts = Array.isArray(options) ? options.map(o => String(o || '').trim()).filter(Boolean) : [];
  if (!opts.length) return -1;

  if (typeof answerRaw === 'number' && Number.isInteger(answerRaw) && answerRaw >= 0 && answerRaw < opts.length) {
    return answerRaw;
  }

  const s = String(answerRaw ?? '').trim();
  if (!s) return 0;

  const letterMap = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
  const letter = s.toUpperCase();
  if (letter in letterMap && letterMap[letter] < opts.length) return letterMap[letter];

  const num = Number(s);
  if (Number.isInteger(num) && num >= 0 && num < opts.length) return num;

  const exactIdx = opts.findIndex(o => o === s);
  if (exactIdx >= 0) return exactIdx;

  const partialIdx = opts.findIndex(o => o.includes(s) || s.includes(o));
  if (partialIdx >= 0) return partialIdx;

  return 0;
}

function normalizeQuizQuestion(raw) {
  const qText = String(raw?.q || raw?.question || raw?.title || raw?.stem || '').trim();
  let options = Array.isArray(raw?.options)
    ? raw.options.map(o => String(o || '').trim()).filter(Boolean)
    : [];

  if (!options.length && raw?.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
    options = Object.values(raw.options).map(o => String(o || '').trim()).filter(Boolean);
  }

  if (!qText || options.length < 2) return null;

  while (options.length < 4) options.push(`选项${String.fromCharCode(65 + options.length)}`);
  options = options.slice(0, 4);

  const answer = normalizeQuizAnswerIndex(raw?.answer ?? raw?.correct ?? raw?.correctIndex ?? raw?.correct_answer, options);
  const explanation = String(raw?.explanation || raw?.explain || raw?.analysis || '').trim();

  return {
    q: qText,
    options,
    answer: answer >= 0 ? answer : 0,
    explanation
  };
}

function normalizeQuizQuestionsPayload(parsed) {
  let list = [];
  if (Array.isArray(parsed)) list = parsed;
  else if (Array.isArray(parsed?.questions)) list = parsed.questions;
  else if (Array.isArray(parsed?.data?.questions)) list = parsed.data.questions;
  return list.map(normalizeQuizQuestion).filter(Boolean);
}

function shuffleQuizOptions(q) {
  if (!Array.isArray(q?.options) || q.options.length < 2) return q;
  const idx = Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0));
  const correctAnswer = q.options[idx];
  if (correctAnswer == null) return q;
  const shuffled = [...q.options].sort(() => Math.random() - 0.5);
  const newAnswerIdx = shuffled.indexOf(correctAnswer);
  return { ...q, options: shuffled, answer: newAnswerIdx >= 0 ? newAnswerIdx : idx };
}

function buildRuleBasedQuizQuestions({ topicTitle, keyPoints, kbContext, count = 20 }) {
  const lines = [];
  if (Array.isArray(keyPoints)) {
    keyPoints.forEach((kp) => {
      const t = String(kp || '').trim();
      if (t.length >= 8) lines.push(t);
    });
  }
  String(kbContext || '').split(/\n+/).forEach((line) => {
    const t = line.replace(/^[-*#\d.]+\s*/, '').trim();
    if (t.length >= 12 && !/^【/.test(t) && !/参考资料/.test(t)) lines.push(t);
  });

  const unique = [...new Set(lines)].slice(0, 80);
  const title = String(topicTitle || '本培训').trim() || '本培训';
  if (unique.length < 5) {
    unique.push(`${title}是岗位必须掌握的核心能力`);
    unique.push(`${title}要求员工严格按照标准操作流程执行`);
    unique.push(`在${title}相关工作中，质量标准和卫生安全同等重要`);
    unique.push(`完成${title}认证后，方可独立承担相应工作职责`);
    unique.push(`${title}的关键在于理解标准而非单纯记忆`);
  }

  const target = Math.max(5, Math.min(Number(count) || 20, 20));
  const questions = [];
  const templates = [
    `关于${title}，以下哪项描述是正确的？`,
    `根据培训内容，以下哪项属于必须掌握的要点？`,
    `在${title}相关工作中，以下哪项做法符合标准要求？`,
    `以下关于${title}的陈述，哪一项是正确的？`,
  ];

  for (let i = 0; i < target; i++) {
    const correctLine = unique[i % unique.length];
    const wrongPool = unique.filter(l => l !== correctLine);
    const wrongs = [];
    for (let j = 0; j < 3; j++) {
      wrongs.push(wrongPool[(i + j + 1) % wrongPool.length] || `${title}无关的干扰项${j + 1}`);
    }
    const options = [correctLine.slice(0, 120), ...wrongs.map(w => w.slice(0, 120))];
    const correctText = options[0];
    for (let k = options.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [options[k], options[r]] = [options[r], options[k]];
    }
    const answer = options.indexOf(correctText);
    questions.push({
      q: templates[i % templates.length],
      options,
      answer: answer >= 0 ? answer : 0,
      explanation: `正确内容：${correctLine.slice(0, 200)}`
    });
  }
  return questions;
}

async function generateQuizQuestionsForSession({ topic, username, kbQuizContext, prevQuestionsSection }) {
  const kpSection = Array.isArray(topic.key_points) && topic.key_points.length > 0
    ? `\n核心要点：${JSON.stringify(topic.key_points)}` : '';
  const randomSeed = Math.random().toString(36).slice(2, 8);
  const quizPrompt = `根据以下培训内容，为员工[${username}]生成20道单选题，JSON格式返回（随机种子:${randomSeed}）：
{"questions":[{"q":"题目","options":["选项A","选项B","选项C","选项D"],"answer":2,"explanation":"解析"}]}
重要要求：
1. answer 为正确选项的 index（0-3），每道题的正确答案位置必须随机分布，不能总是0或固定位置。
2. 20道题中正确答案在选项0、1、2、3位置各约5道，随机打散。
3. 题目要贴近实际操作场景，测试真实理解，避免纯记忆题。
4. 从培训内容的不同角度、不同知识点出题，确保题目多样性。
5. 只返回JSON，不要markdown代码块，不要任何解释文字。
培训主题：${topic.title}（岗位：${topic.position}）${kpSection}${kbQuizContext}${prevQuestionsSection}`;

  const systemPrompt = '你是一个专业的餐饮培训出题专家。请严格只返回JSON对象，不要添加markdown代码块或其他文字。确保每道题正确答案的位置（answer字段）在0-3之间均匀随机分布。';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const aiResponse = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: quizPrompt }
      ], { max_tokens: 4000, temperature: attempt === 0 ? 0.5 : 0.2, skipCache: true });

      const quizText = aiResponse?.content || '';
      const parsed = tryParseQuizJsonFromLLM(quizText);
      const questions = normalizeQuizQuestionsPayload(parsed);
      if (questions.length >= 5) {
        return { questions, source: 'ai', attempt: attempt + 1 };
      }
      console.warn('[Training] Quiz AI parse attempt failed:', {
        attempt: attempt + 1,
        ok: aiResponse?.ok,
        preview: quizText.slice(0, 400),
        parsedCount: questions.length
      });
    } catch (e) {
      console.warn('[Training] Quiz AI call failed:', e?.message);
    }
  }

  const fallback = buildRuleBasedQuizQuestions({
    topicTitle: topic.title,
    keyPoints: topic.key_points,
    kbContext: kbQuizContext,
    count: 20
  });
  return { questions: fallback, source: 'rule', attempt: 0 };
}

function getShanghaiDateTimeText(date = new Date()) {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function parseReminderMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

async function createTrainingUserNotification(targetUsername, title, message, meta) {
  try {
    await pool().query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [
        targetUsername,
        title,
        message,
        'training_assignment',
        JSON.stringify(meta || {}),
        resolveTenantIdDefault()
      ]
    );
  } catch (_) { /* ignore */ }
}

async function sendTrainingFeishuMessage(username, message) {
  try {
    const fu = await lookupFeishuUserByUsername(username);
    if (fu?.open_id) {
      await sendLarkMessage(fu.open_id, message, { skipDedup: true });
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

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

// ─── Schema ───────────────────────────────────────────────
export async function ensureTrainingSchema() {
  try {
    // 知识点表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_topics (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        position VARCHAR(50) NOT NULL,
        description TEXT,
        key_points JSONB DEFAULT '[]',
        practice_task TEXT,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 培训指派表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_assignments (
        id SERIAL PRIMARY KEY,
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL REFERENCES training_topics(id),
        assigned_by VARCHAR(100),
        due_date DATE,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_username, topic_id)
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_employee ON training_assignments (employee_username)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_topic ON training_assignments (topic_id)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_due_date ON training_assignments (due_date)`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS require_practice BOOLEAN DEFAULT false`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS reminder_meta JSONB DEFAULT '{}'::jsonb`);

    // 学习会话表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id SERIAL PRIMARY KEY,
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL REFERENCES training_topics(id),
        chat_history JSONB DEFAULT '[]',
        quiz_questions JSONB DEFAULT '[]',
        quiz_answers JSONB DEFAULT '[]',
        quiz_score INT,
        quiz_passed BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'learning',
        started_at TIMESTAMP DEFAULT NOW(),
        quiz_passed_at TIMESTAMP,
        UNIQUE(employee_username, topic_id)
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ts_employee ON training_sessions (employee_username)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ts_topic ON training_sessions (topic_id)`);

    // 认证记录表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_certifications (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES training_sessions(id),
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL,
        media_url VARCHAR(500),
        media_type VARCHAR(20),
        ai_verdict VARCHAR(20),
        ai_feedback TEXT,
        ai_raw_response JSONB,
        manager_verdict VARCHAR(20),
        manager_note TEXT,
        manager_reviewed_by VARCHAR(100),
        certified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_tc_session ON training_certifications (session_id)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_tc_employee ON training_certifications (employee_username)`);

    // 关联知识库文章（多选）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS kb_article_ids UUID[] DEFAULT '{}'`);
    // 门店归属（空=全部门店可见）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS store VARCHAR(100) DEFAULT ''`);
    // 允许同一员工对同一知识点有多次指派（移除唯一约束）
    await pool().query(`ALTER TABLE training_assignments DROP CONSTRAINT IF EXISTS training_assignments_employee_username_topic_id_key`);
    // AI 智能解析缓存（生成一次，全员复用）
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation TEXT`);
    // 管理员手动编辑锁：锁定后自动生成不得覆盖（管理员通过"重新生成"解锁）
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation_locked BOOLEAN DEFAULT false`);
    // 考试历史记录（每次提交均追加）
    await pool().query(`ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS quiz_history JSONB DEFAULT '[]'`);

    // ── 实操图谱评分（2026-05-23新增）──
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS step_rubric JSONB`);
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS step_rubric JSONB`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS ai_step_scores JSONB`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS ai_total_score INT`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending'`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS manager_score INT`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS final_score INT`);

    // ── 知识库 AI解析/步骤图谱 修改记录（2026-06-11新增，留痕便于追溯与回滚）──
    await pool().query(`
      CREATE TABLE IF NOT EXISTS knowledge_edit_history (
        id BIGSERIAL PRIMARY KEY,
        knowledge_id UUID NOT NULL,
        field VARCHAR(32) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        editor VARCHAR(100),
        editor_role VARCHAR(50),
        edited_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_keh_knowledge ON knowledge_edit_history (knowledge_id, edited_at DESC)`);

    // ── 培训-晋升一体化（2026-06-13新增）──
    // 知识点：是否作为对应岗位的晋升能力要求项 + 认证有效期（天）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS promotion_required BOOLEAN DEFAULT false`);
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS validity_days INT DEFAULT 180`);
    // 晋升等级（如 三砧/二砧/头砧、见习镬/二镬/头镬、L1/L2/L3、储备/正式 等），与 position 一起确定该知识点是哪个岗位+级别的晋升要求
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS level VARCHAR(20)`);
    // 指派来源（manual/anomaly_trigger/promotion_qualification/recert）+ 关联晋升记录
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual'`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS related_track_id VARCHAR(64)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_related_track ON training_assignments (related_track_id)`);
    // 认证有效期与状态（valid/expired/under_review）
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS valid_until DATE`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'valid'`);

    console.log('[Training] Schema ensured');
  } catch (e) {
    console.error('[Training] Schema error:', e?.message);
  }
}

// ─── Routes Registration ───────────────────────────────────────────────
export function registerTrainingRoutes(app, authMiddleware, uploadMiddleware) {

  // ═══════════════════════════════════════════════════════════
  // 管理端路由
  // ═══════════════════════════════════════════════════════════

  // GET /api/training/promotion-requirements?position=X&level=Y - 该岗位+级别的晋升能力要求知识点（员工/管理员均可查看）
  app.get('/api/training/promotion-requirements', authMiddleware, async (req, res) => {
    try {
      const topics = await getPromotionRequiredTopics(req.query.position || '', req.query.level || '');
      res.json({ success: true, topics: topics.map(t => ({ id: t.id, title: t.title, level: t.level, validity_days: t.validity_days })) });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/topics/set-promotion-requirements
  // 管理员批量设置某岗位+级别的晋升认证要求：
  // required_ids 里的 topic 设为 promotion_required=true；同岗位+级别其余 topic 设为 false。
  app.post('/api/training/topics/set-promotion-requirements', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可修改晋升认证要求' });
      }
      const position = String(req.body?.position || '').trim();
      const level = String(req.body?.level || '').trim();
      const requiredIds = Array.isArray(req.body?.required_ids)
        ? req.body.required_ids.map(Number).filter(n => Number.isFinite(n) && n > 0)
        : [];
      if (!position || !level) return res.status(400).json({ error: '必须指定 position 和 level' });

      // 取该岗位+级别的所有 topic id（position 字段是逗号分隔，用 LIKE 匹配）
      const allR = await pool().query(
        `SELECT id FROM training_topics WHERE is_active = true AND level = $1
           AND (position = $2 OR position LIKE $3 OR position LIKE $4 OR position LIKE $5)`,
        [level, position, `${position},%`, `%,${position}`, `%,${position},%`]
      );
      const allIds = allR.rows.map(r => r.id);
      if (!allIds.length) return res.json({ success: true, updated: 0 });

      // 批量 update：用 CASE 一次搞定
      await pool().query(
        `UPDATE training_topics SET promotion_required = (id = ANY($1::int[]))
         WHERE id = ANY($2::int[])`,
        [requiredIds, allIds]
      );
      return res.json({ success: true, updated: allIds.length, required_count: requiredIds.length });
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/training/my-development-map - 我的发展地图（档案首页）
  app.get('/api/training/my-development-map', authMiddleware, async (req, res) => {
    try {
      const target = String(req.query.username || req.user?.username || '').trim();
      if (!isManager(req.user?.role) && target !== req.user?.username) {
        return res.status(403).json({ success: false, error: '无权限查看他人数据' });
      }
      const map = await getMyDevelopmentMap(target);
      res.json({ success: true, map });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/cross-track-status?username=X - 厨师长晋升阶段一前提：跨专业线技师级状态
  app.get('/api/training/cross-track-status', authMiddleware, async (req, res) => {
    try {
      const target = String(req.query.username || req.user?.username || '').trim();
      if (!isManager(req.user?.role) && target !== req.user?.username) {
        return res.status(403).json({ error: '无权限查看他人数据' });
      }
      const status = await getCrossTrackTechnicianStatus(target);
      res.json({ success: true, ...status });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/topics - 列出知识点
  // 注意：员工提交晋升资格申请(技能提升)时，前端要按目标岗位查知识点供自选，
  // 调用方是申请人本人(store_employee)而非管理者——之前这里要求isManager()，
  // 普通员工调用必得403，前端又把{error:...}误判成{topics:[]}显示"该岗位暂无知识点"，
  // 导致所有非管理者角色提交同岗位晋升申请时永远看不到任何知识点可选。
  // 知识点标题/要点本身不是敏感数据(本来就是员工要学的内容)，放开给所有登录用户只读查询。
  app.get('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      const position = req.query.position || '';
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const params = [tenantId];
      let sql = `SELECT * FROM training_topics WHERE is_active = true AND tenant_id = $1`;
      // 门店过滤：店长/出品经理只看自己门店（或全部门店的知识点）
      const userRole = req.user?.role;
      const userStore = ['store_manager', 'store_production_manager'].includes(userRole)
        ? await getUserStore(req.user?.username) : '';
      if (userStore) {
        sql += ` AND (store = '' OR store = $${params.length + 1})`;
        params.push(userStore);
      }
      if (position) {
        sql += ` AND (position = $${params.length + 1} OR position LIKE $${params.length + 2} OR position LIKE $${params.length + 3} OR position LIKE $${params.length + 4})`;
        params.push(position, position + ',%', '%,' + position, '%,' + position + ',%');
      }
      sql += ` ORDER BY sort_order, id`;
      const result = await pool().query(sql, params);
      res.json({ success: true, topics: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/topics - 创建知识点
  app.post('/api/training/topics', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可新建知识点' });
      }
      const { title, positions, position, description, key_points, practice_task, sort_order, kb_article_ids, store, promotion_required, validity_days, level } = req.body;
      // positions 优先（新格式：数组），position 备用（旧格式：字符串）
      const posArr = Array.isArray(positions) && positions.length ? positions : (position ? [position] : []);
      const posStr = posArr.join(',');
      if (!title?.trim() || !posStr) {
        return res.json({ success: false, error: '标题和岗位必填' });
      }
      const kbIds = Array.isArray(kb_article_ids) ? kb_article_ids : [];
      // 门店：store_manager/production_mgr 强制使用自己的门店
      const userRole = req.user?.role;
      let storeVal = String(store || '').trim();
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        storeVal = await getUserStore(req.user?.username);
      }
      const promotionRequired = promotion_required === true || promotion_required === 'true';
      const validityDays = Math.max(1, Number(validity_days) || 180);
      const levelVal = String(level || '').trim();
      const tenantIdForInsert = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(
        `INSERT INTO training_topics (title, position, description, key_points, practice_task, sort_order, created_by, kb_article_ids, store, promotion_required, validity_days, level, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [title, posStr, description || '', JSON.stringify(key_points || []), practice_task || '', sort_order || 0, req.user?.username, kbIds, storeVal, promotionRequired, validityDays, levelVal, tenantIdForInsert]
      );
      res.json({ success: true, topic: result.rows[0] });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // PUT /api/training/topics/:id - 更新知识点
  app.put('/api/training/topics/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可编辑知识点' });
      }
      const { id } = req.params;
      const { title, positions, position, description, key_points, practice_task, sort_order, kb_article_ids, store, promotion_required, validity_days, level } = req.body;
      const posArr = Array.isArray(positions) && positions.length ? positions : (position ? [position] : null);
      const posStr = posArr ? posArr.join(',') : null;
      const kbIds = Array.isArray(kb_article_ids) ? kb_article_ids : null;
      // 门店：store_manager/production_mgr 强制使用自己的门店
      const userRole = req.user?.role;
      let storeVal = store !== undefined ? String(store || '').trim() : null;
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        storeVal = await getUserStore(req.user?.username);
      }
      const promotionRequired = promotion_required === undefined ? null : (promotion_required === true || promotion_required === 'true');
      const validityDays = validity_days === undefined ? null : Math.max(1, Number(validity_days) || 180);
      const levelVal = level === undefined ? null : String(level || '').trim();
      const result = await pool().query(
        `UPDATE training_topics
         SET title = COALESCE($1, title),
             position = COALESCE($2, position),
             description = COALESCE($3, description),
             key_points = COALESCE($4, key_points),
             practice_task = COALESCE($5, practice_task),
             sort_order = COALESCE($6, sort_order),
             kb_article_ids = COALESCE($7, kb_article_ids),
             store = COALESCE($9, store),
             promotion_required = COALESCE($10, promotion_required),
             validity_days = COALESCE($11, validity_days),
             level = COALESCE($12, level)
         WHERE id = $8
         RETURNING *`,
        [title, posStr, description, JSON.stringify(key_points), practice_task, sort_order, kbIds, id, storeVal, promotionRequired, validityDays, levelVal]
      );
      if (result.rows.length === 0) {
        return res.json({ success: false, error: '知识点不存在' });
      }
      res.json({ success: true, topic: result.rows[0] });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // DELETE /api/training/topics/:id - 软删除知识点
  app.delete('/api/training/topics/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'hq_manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: '仅管理员和总部营运可删除知识点' });
      }
      await pool().query(`UPDATE training_topics SET is_active = false WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 步骤图谱生成 & 管理
  // ═══════════════════════════════════════════════════════════

  // POST /api/knowledge/:id/analyze-rubric — 分析KB视频/图片，生成步骤图谱
  app.post('/api/knowledge/:id/analyze-rubric', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限' });
      }
      const { id } = req.params;
      const article = (await pool().query(`SELECT * FROM knowledge_base WHERE id = $1`, [id])).rows[0];
      if (!article) return res.json({ success: false, error: '知识条目不存在' });

      const fileField = article.file_path || '';
      const isVideo = /\.(mp4|mov|webm|avi)$/i.test(fileField);
      const baseUrl = process.env.SERVER_BASE_URL || 'https://nnyx.cc';

      const dishName = (article.title || '').trim();
      const dishDesc = article.content ? `\n菜品描述：${article.content.slice(0, 200)}` : '';

      const rubricPrompt = `你是餐饮培训标准制定专家。
【重要】当前考核菜品/操作的准确名称是：「${dishName}」${dishDesc}
这个名称来自文件名，是该菜品/操作的真实名称，请严格以此为准，不要根据图片自行猜测菜名。

请认真观看视频/图片，提取标准化的培训考核评分表。输出格式必须严格对齐厨房SOP结构，包含每步的：操作动作、评分权重、质量标准、常见失败、补救措施、是否为关键步骤，以及3-5个可视化检查点用于实操评分。

要求：
1. 第一项必须是「菜品核验：${dishName || '考核内容'}」（权重10分）：核查员工提交的实操图片/视频是否为「${dishName || '考核内容'}」，checks中列出该菜品的唯一识别特征。
2. 提取后续操作步骤时，每步必须包含完整厨房SOP字段。
3. action/checks 必须是视觉上可判定的（能看到），不能是不可见的（"温度""时间"等抽象概念转为视觉描述）。
4. 判断工位(station)名称，如"烧味""切配""炒锅""凉菜"等。
5. 列出3-5个一票否决项（fail_criteria），出现任一即不合格。
6. 合格线设为80分（pass_threshold）。
7. 权重：菜品核验10分 + 其余步骤合计90分（权重根据重要性分配）。
8. 严格返回JSON，不要额外文字。

返回JSON格式（严格使用厨房SOP结构）：
{
  "dish_name": "${dishName}",
  "station": "识别出的工位",
  "type": "steps",
  "items": [
    {
      "step_seq": 1,
      "action": "操作动作名称，如：烫鸭",
      "weight": 10,
      "quality_standard": "质量标准，如：表皮均匀收缩",
      "common_failure": "常见失败，如：烫制不均",
      "failure_action": "补救措施，如：重新烫制",
      "is_critical": false,
      "time_limit_seconds": null,
      "checks": ["可视化检查点1", "可视化检查点2"]
    }
  ],
  "fail_criteria": ["一票否决项1", "一票否决项2"],
  "pass_threshold": 80
}`;

      let llmResult;
      if (isVideo) {
        const videoUrl = `${baseUrl}${fileField}`;
        const framePath = path.join(uploadsDir, `rubric-frame-${randomUUID()}.jpg`);
        try {
          const localVideoPath = path.join(__dirname, '..', fileField);
          execFileSync('ffmpeg', ['-i', localVideoPath, '-ss', '00:00:05', '-frames:v', '1', framePath], { timeout: 30000 });
          llmResult = await callVisionLLM(framePath, rubricPrompt);
          try { fs.unlinkSync(framePath); } catch (_) { /* ignore */ }
        } catch (ffmpegErr) {
          // Try video API as fallback
          try {
            llmResult = await callVisionLLMVideo(videoUrl, rubricPrompt);
          } catch (vErr) {
            return res.json({ success: false, error: '视频分析失败: ' + (ffmpegErr?.message || vErr?.message) });
          }
        }
      } else {
        const fileAbsPath = path.join(__dirname, '..', fileField);
        if (!fs.existsSync(fileAbsPath)) return res.json({ success: false, error: '文件未找到' });
        llmResult = await callVisionLLM(fileAbsPath, rubricPrompt);
      }

      if (!llmResult?.ok) return res.json({ success: false, error: 'AI分析失败: ' + (llmResult?.error || 'unknown') });

      const text = llmResult.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.json({ success: false, error: 'AI返回格式异常: ' + text.slice(0, 200) });

      const rubric = JSON.parse(jsonMatch[0]);
      if (!rubric.items || !Array.isArray(rubric.items)) return res.json({ success: false, error: '返回数据缺少items字段' });

      const totalWeight = rubric.items.reduce((s, item) => s + (Number(item.weight) || 0), 0);
      if (Math.abs(totalWeight - 100) > 5) {
        return res.json({ success: false, error: `步骤权重总和应为100，当前为${totalWeight}`, raw_rubric: rubric });
      }

      await pool().query(`UPDATE knowledge_base SET step_rubric = $1 WHERE id = $2`, [JSON.stringify(rubric), id]);
      await pool().query(
        `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
         VALUES ($1::uuid, 'step_rubric', $2, $3, $4, $5, $6)`,
        [id, article.step_rubric ? JSON.stringify(article.step_rubric) : null, JSON.stringify(rubric),
         req.user?.username || null, req.user?.role || null, resolveTenantIdDefault()]
      ).catch((e) => console.error('[Training] edit-history(rubric) failed:', e?.message));
      res.json({ success: true, rubric });
    } catch (e) {
      console.error('[Training] analyze-rubric error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/knowledge/:id/edit-history — AI解析/步骤图谱 修改记录查询（管理端）
  app.get('/api/knowledge/:id/edit-history', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) return res.status(403).json({ success: false, error: '无权限' });
      const r = await pool().query(
        `SELECT id, field, editor, editor_role, edited_at,
                LEFT(COALESCE(old_value,''), 300) AS old_preview,
                LEFT(COALESCE(new_value,''), 300) AS new_preview,
                length(COALESCE(old_value,'')) AS old_len,
                length(COALESCE(new_value,'')) AS new_len
         FROM knowledge_edit_history
         WHERE knowledge_id = $1::uuid
         ORDER BY edited_at DESC LIMIT 100`,
        [req.params.id]
      );
      res.json({ success: true, history: r.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/topics/:id/generate-rubric — 话题从关联KB视频生成图谱
  app.post('/api/training/topics/:id/generate-rubric', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) return res.status(403).json({ error: '无权限' });
      const { id } = req.params;
      const topic = (await pool().query(`SELECT * FROM training_topics WHERE id = $1 AND is_active = true`, [id])).rows[0];
      if (!topic) return res.json({ success: false, error: '知识点不存在' });
      const kbIds = topic.kb_article_ids || [];
      if (!kbIds.length) return res.json({ success: false, error: '该知识点未关联任何知识库文章，无法生成图谱' });

      // 优先取已有 step_rubric 的KB文章（媒体文件优先），否则取第一个视频/图片文件
      // 注意：1对1设计原则——每个培训话题对应1个SOP文件，多关联时只取第一个可用媒体文件
      const kbResult = await pool().query(
        `SELECT id, title, file_path, step_rubric FROM knowledge_base
         WHERE id = ANY($1) AND (file_path IS NOT NULL OR step_rubric IS NOT NULL)
         ORDER BY step_rubric IS NOT NULL DESC, file_path IS NOT NULL DESC
         LIMIT 1`,
        [kbIds]
      );
      if (kbResult.rows.length === 0) return res.json({ success: false, error: '关联的KB文章不存在或无媒体文件' });
      const kbArticle = kbResult.rows[0];
      const usedKbCount = kbIds.length;
      const warningMsg = usedKbCount > 1
        ? `注意：该话题关联了${usedKbCount}篇KB文章，图谱仅基于「${kbArticle.title}」生成。建议每个话题只关联1篇SOP文件。`
        : null;

      let rubric;
      if (kbArticle.step_rubric) {
        rubric = kbArticle.step_rubric;
      } else {
        // 检查是否有现成的厨房 SOP 步骤数据（根据菜品名称匹配）
        const dishMatch = await pool().query(
          `SELECT DISTINCT dish_name, station FROM kitchen_sop_steps WHERE dish_name ILIKE $1 OR $2 ILIKE '%' || dish_name || '%' LIMIT 1`,
          [`%${topic.title}%`, topic.title]
        );
        if (dishMatch.rows.length > 0) {
          const { dish_name: matchedDish, station: matchedStation } = dishMatch.rows[0];
          const steps = await pool().query(
            `SELECT step_seq, action, time_limit_seconds, quality_standard, common_failure, failure_action, is_critical
             FROM kitchen_sop_steps WHERE dish_name = $1 ORDER BY step_seq`,
            [matchedDish]
          );
          // Convert to rubric format: 第一项菜品核验 + 每步默认权重
          const totalSteps = steps.rows.length;
          const baseWeight = totalSteps > 0 ? Math.floor(90 / totalSteps) : 0;
          const remainder = 90 - baseWeight * totalSteps;
          rubric = {
            dish_name: matchedDish,
            station: matchedStation,
            type: 'steps',
            items: [
              {
                step_seq: 0,
                action: `菜品核验：${matchedDish}`,
                weight: 10,
                quality_standard: `确认提交内容为「${matchedDish}」`,
                common_failure: null,
                failure_action: null,
                is_critical: true,
                time_limit_seconds: null,
                checks: [`外观符合${matchedDish}特征`, '主料颜色正确', '摆盘/器具符合标准']
              },
              ...steps.rows.map((s, i) => ({
                step_seq: s.step_seq,
                action: s.action,
                weight: baseWeight + (i < remainder ? 1 : 0),
                quality_standard: s.quality_standard || null,
                common_failure: s.common_failure || null,
                failure_action: s.failure_action || null,
                is_critical: s.is_critical || false,
                time_limit_seconds: s.time_limit_seconds || null,
                checks: (s.quality_standard ? [s.quality_standard] : []).concat(s.common_failure ? [`避免：${s.common_failure}`] : [])
              }))
            ],
            fail_criteria: ['提交的实操内容与考核菜品明显不符', '操作区域严重污秽', '明显操作安全隐患'],
            pass_threshold: 80,
            source: 'kitchen_sop_steps'
          };
        } else {
          // Check file type — only images/videos can be analyzed
          const fileField = kbArticle.file_path || '';
          const isMedia = /\.(mp4|mov|webm|avi|jpg|jpeg|png|gif|webp)$/i.test(fileField);
          if (!isMedia) {
            return res.json({ success: false, error: `关联的知识库文章（${kbArticle.title}）是${kbArticle.file_type || 'PDF'}格式，图谱分析需要视频或图片文件。请先上传包含操作视频/图片的知识库文章，或手动配置图谱。` });
          }
          // Trigger KB analysis
          try {
            const analyzeRes = await axios.post(
              `http://localhost:3000/api/knowledge/${kbArticle.id}/analyze-rubric`,
              {},
              { headers: { 'Authorization': req.headers['authorization'] || '' } }
            );
            if (!analyzeRes.data?.success) {
              return res.json({ success: false, error: '步骤图谱生成失败: ' + (analyzeRes.data?.error || '') });
            }
            rubric = analyzeRes.data.rubric;
          } catch (innerE) {
            return res.json({ success: false, error: '分析请求失败: ' + innerE?.message });
          }
        }
      }

      await pool().query(`UPDATE training_topics SET step_rubric = $1 WHERE id = $2`, [JSON.stringify(rubric), id]);
      res.json({ success: true, rubric, source_kb: { id: kbArticle.id, title: kbArticle.title }, warning: warningMsg });
    } catch (e) {
      console.error('[Training] generate-rubric error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/topics/:id/rubric — 获取话题图谱
  app.get('/api/training/topics/:id/rubric', authMiddleware, async (req, res) => {
    try {
      const topic = (await pool().query(`SELECT step_rubric FROM training_topics WHERE id = $1`, [req.params.id])).rows[0];
      if (!topic) return res.json({ success: false, error: '知识点不存在' });
      res.json({ success: true, rubric: topic.step_rubric || null });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 实操评分明细
  // ═══════════════════════════════════════════════════════════

  // GET /api/training/certifications/:id/score-detail — 查看评分明细（员工端/管理端通用）
  app.get('/api/training/certifications/:id/score-detail', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const username = req.user?.username;
      const isMgr = isManager(req.user?.role);
      const certResult = await pool().query(`
        SELECT c.*, t.title, t.position
        FROM training_certifications c JOIN training_topics t ON t.id = c.topic_id
        WHERE c.id = $1`, [id]);
      if (certResult.rows.length === 0) return res.json({ success: false, error: '认证记录不存在' });
      const cert = certResult.rows[0];
      if (!isMgr && cert.employee_username !== username) return res.status(403).json({ error: '无权查看' });
      res.json({
        success: true,
        certification: cert,
        ai_step_scores: cert.ai_step_scores || null,
        ai_total_score: cert.ai_total_score || null,
        review_status: cert.review_status || 'pending',
        manager_score: cert.manager_score || null,
        final_score: cert.final_score || null,
        manager_note: cert.manager_note || ''
      });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/kb-search?q=关键词 - 搜索知识库文章（供知识点关联使用）
  app.get('/api/training/kb-search', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限' });
      }
      const q = (req.query.q || '').trim();
      const idsParam = (req.query.ids || '').trim();
      let sql, params;
      if (idsParam) {
        const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
        const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true AND id::text IN (${placeholders}) ORDER BY title`;
        params = ids;
      } else if (q) {
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true AND (title ILIKE $1 OR content ILIKE $1) ORDER BY title LIMIT 20`;
        params = ['%' + q + '%'];
      } else {
        sql = `SELECT id, title, category, LEFT(content, 200) AS excerpt FROM knowledge_base WHERE enabled = true ORDER BY updated_at DESC LIMIT 20`;
        params = [];
      }
      const result = await pool().query(sql, params);
      res.json({ success: true, articles: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/stores - 获取可指派的门店列表
  app.get('/api/training/stores', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) return res.status(403).json({ error: '无权限' });
      const userRole = req.user?.role;
      // store_manager/production_mgr 只看自己的门店
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        const userStore = await getUserStore(req.user?.username);
        if (userStore) return res.json({ success: true, stores: [userStore] });
      }
      const result = await pool().query(`SELECT DISTINCT store FROM employees WHERE store != '' AND status != 'inactive' AND tenant_id = $1 ORDER BY store`, [req.tenantId || req.user?.tenant_id || 'default']);
      res.json({ success: true, stores: result.rows.map(r => r.store) });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/search-employees?q=&store=&position= - 搜索可指派的员工（支持门店+岗位过滤）
  app.get('/api/training/search-employees', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限' });
      }
      const q = (req.query.q || '').trim();
      const filterStore = (req.query.store || '').trim();
      const filterPosition = (req.query.position || '').trim();
      const assignableRoles = getAssignableRoles(req.user?.role);
      const userRole = req.user?.role;

      const clauses = [`status != 'inactive'`];
      const params = [];
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      clauses.push(`tenant_id = $${params.length}`);

      // 角色过滤
      if (assignableRoles !== null) {
        params.push(assignableRoles);
        clauses.push(`role = ANY($${params.length})`);
      }

      // 门店过滤：store_manager/production_mgr 强制自己的门店
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        const userStore = await getUserStore(req.user?.username);
        if (userStore) {
          params.push(userStore);
          clauses.push(`store = $${params.length}`);
        }
      } else if (filterStore) {
        params.push(filterStore);
        clauses.push(`store = $${params.length}`);
      }

      // 岗位过滤（employees.position 字段）
      if (filterPosition) {
        params.push('%' + filterPosition + '%');
        clauses.push(`position ILIKE $${params.length}`);
      }

      // 姓名搜索
      if (q) {
        params.push('%' + q + '%');
        clauses.push(`(name ILIKE $${params.length} OR username ILIKE $${params.length})`);
      }

      const sql = `SELECT username, name, role, position, store FROM employees WHERE ${clauses.join(' AND ')} ORDER BY store, name LIMIT 50`;
      const result = await pool().query(sql, params);
      res.json({ success: true, employees: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/assignments - 列出指派
  app.get('/api/training/assignments', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const name = (req.query.name || '').trim();
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const params = [tenantId];
      let sql = `
        SELECT a.*, t.title, t.position,
               s.status AS session_status, s.quiz_passed, s.quiz_score,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_overdue,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date = ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_due_today,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN (((NOW() AT TIME ZONE 'Asia/Shanghai')::date) - a.due_date)
                 ELSE 0
               END AS days_overdue,
               e.name AS employee_name
        FROM training_assignments a
        JOIN training_topics t ON t.id = a.topic_id
        LEFT JOIN training_sessions s ON s.topic_id = a.topic_id AND s.employee_username = a.employee_username
        LEFT JOIN employees e ON e.username = a.employee_username
        WHERE a.tenant_id = $1
      `;
      // 非管理员/总部营运只能看自己指派的任务
      if (!['admin', 'hq_manager'].includes(role)) {
        params.push(username);
        sql += ` AND a.assigned_by = $${params.length}`;
      }
      if (name) {
        params.push('%' + name + '%');
        sql += ` AND (e.name ILIKE $${params.length} OR a.employee_username ILIKE $${params.length})`;
      }
      sql += ` ORDER BY a.created_at DESC`;
      const result = await pool().query(sql, params);
      res.json({ success: true, assignments: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/assignments - 批量指派知识点给员工（支持多员工）
  app.post('/api/training/assignments', authMiddleware, async (req, res) => {
    try {
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(req.user?.role)) {
        return res.status(403).json({ error: '仅店长及以上角色可指派培训任务' });
      }
      // 支持旧格式 employee_username（字符串）和新格式 employee_usernames（数组）
      const { employee_username, employee_usernames, topic_id, due_date, note } = req.body;
      const usernames = Array.isArray(employee_usernames) && employee_usernames.length
        ? employee_usernames
        : (employee_username ? [employee_username] : []);
      if (!usernames.length || !topic_id) {
        return res.json({ success: false, error: '员工和知识点必填' });
      }

      const assignableRoles = getAssignableRoles(req.user?.role);
      const requirePractice = req.body.require_practice === true || req.body.require_practice === 'true';
      const created = [];

      for (const username of usernames) {
        if (!username.trim()) continue;
        // 角色层级验证
        if (assignableRoles !== null) {
          const empCheck = await pool().query(`SELECT role, name FROM employees WHERE username = $1`, [username]);
          if (empCheck.rows.length === 0) continue;
          if (!assignableRoles.includes(empCheck.rows[0].role)) continue;
        }
        const row = await createTrainingAssignment({
          employeeUsername: username,
          topicId: topic_id,
          assignedBy: req.user?.username,
          dueDate: due_date || null,
          note: note || '',
          requirePractice,
          source: 'manual',
          tenantId: req.tenantId || req.user?.tenant_id
        });
        if (row) created.push(row);
      }

      res.json({ success: true, count: created.length, assignments: created });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // DELETE /api/training/assignments/:id - 撤销指派（仅自己指派的，或管理员/总部营运）
  app.delete('/api/training/assignments/:id', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      const _canAssign = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
      if (!_canAssign.includes(role)) {
        return res.status(403).json({ error: '无权限操作' });
      }
      // 非管理员/总部营运只能撤销自己指派的
      if (!['admin', 'hq_manager'].includes(role)) {
        const check = await pool().query(`SELECT assigned_by FROM training_assignments WHERE id = $1`, [req.params.id]);
        if (check.rows.length === 0) return res.json({ success: false, error: '记录不存在' });
        if (check.rows[0].assigned_by !== username) {
          return res.status(403).json({ error: '只能撤销自己指派的任务' });
        }
      }
      await pool().query(`DELETE FROM training_assignments WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/dashboard - 团队通过率看板（含每人明细）
  app.get('/api/training/dashboard', authMiddleware, async (req, res) => {
    try {
      const role = req.user?.role;
      const username = req.user?.username;
      if (!isManager(role)) {
        return res.status(403).json({ error: '无权限访问' });
      }

      // admin / hq_manager 看所有人派发的任务；其他管理者只看自己派发的
      const isHQ = ['admin', 'hr_manager', 'hq_manager'].includes(role);
      const assignedByFilter = isHQ ? '' : `AND a.assigned_by = '${username.replace(/'/g, "''")}'`;

      // 是否在结果中显示派发人（HQ 看全量需要知道是谁派的）
      const assignerField = isHQ
        ? `, a.assigned_by AS assigned_by, COALESCE(ae.name, a.assigned_by) AS assigner_name`
        : '';
      const assignerJoin = isHQ
        ? `LEFT JOIN employees ae ON ae.username = a.assigned_by`
        : '';
      const groupExtra = isHQ ? `, a.assigned_by, ae.name` : '';

      const result = await pool().query(`
        SELECT t.id, t.title, t.position
               ${assignerField},
               COUNT(DISTINCT a.employee_username) AS assigned_count,
               COUNT(DISTINCT CASE WHEN s.status = 'certified' THEN s.employee_username END) AS certified_count,
               COUNT(DISTINCT CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN a.employee_username
               END) AS overdue_count,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'username', a.employee_username,
                     'name', COALESCE(e.name, a.employee_username),
                     'status', COALESCE(s.status, 'not_started'),
                     'quiz_score', s.quiz_score,
                     'quiz_history', COALESCE(s.quiz_history, '[]'::jsonb),
                     'due_date', a.due_date,
                     'is_overdue', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN true ELSE false
                     END,
                     'is_due_today', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date = ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN true ELSE false
                     END,
                     'days_overdue', CASE
                       WHEN a.due_date IS NOT NULL
                        AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                        AND COALESCE(s.status, 'not_started') != 'certified'
                       THEN (((NOW() AT TIME ZONE 'Asia/Shanghai')::date) - a.due_date)
                       ELSE 0
                     END
                   ) ORDER BY e.name
                 ) FILTER (WHERE a.employee_username IS NOT NULL),
                 '[]'::json
               ) AS members
        FROM training_topics t
        LEFT JOIN training_assignments a ON a.topic_id = t.id ${assignedByFilter}
        LEFT JOIN training_sessions s ON s.topic_id = t.id AND s.employee_username = a.employee_username
        LEFT JOIN employees e ON e.username = a.employee_username
        ${assignerJoin}
        WHERE t.is_active = true
        GROUP BY t.id, t.title, t.position ${groupExtra}
        ORDER BY t.sort_order, t.id
      `);
      res.json({ success: true, dashboard: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/certifications/pending - 待审核列表（谁派发谁审核）
  app.get('/api/training/certifications/pending', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const username = String(req.user?.username || '').trim();
      const role = String(req.user?.role || '').trim();
      const isAdminOrHQ = role === 'admin' || role === 'hq_manager';
      // 谁派发谁审核：非管理员/总部只能看到自己派发的任务的认证。
      // assigned_by 为空（如到期复训自动派发未回填指派人的历史脏数据）时，
      // 兜底给该员工所在门店的店长/出品经理，避免记录永远无人能审。
      const assignerClause = isAdminOrHQ
        ? ''
        : `AND EXISTS (
             SELECT 1 FROM training_assignments a2
             WHERE a2.employee_username = c.employee_username
               AND a2.topic_id = c.topic_id
               AND (
                 lower(a2.assigned_by) = lower('${username.replace(/'/g, "''")}')
                 OR (
                   a2.assigned_by IS NULL
                   AND EXISTS (
                     SELECT 1 FROM employees ce
                     JOIN employees re ON re.store = ce.store AND lower(re.username) = lower('${username.replace(/'/g, "''")}')
                     WHERE lower(ce.username) = lower(c.employee_username)
                       AND re.role IN ('store_production_manager','store_manager')
                   )
                 )
               )
           )`;
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(`
        SELECT c.*, t.title, t.position, s.employee_username,
               e.name AS employee_name
        FROM training_certifications c
        JOIN training_sessions s ON s.id = c.session_id
        JOIN training_topics t ON t.id = c.topic_id
        LEFT JOIN employees e ON e.username = c.employee_username
        WHERE c.manager_verdict IS NULL AND c.tenant_id = $1
        ${assignerClause}
        ORDER BY c.created_at DESC
      `, [tenantId]);
      res.json({ success: true, pending: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/certifications/:id/review - 人工复核（谁派发谁审核）
  app.post('/api/training/certifications/:id/review', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限访问' });
      }
      const { id } = req.params;
      const { action, verdict, note, steps } = req.body;
      const reviewer = req.user?.username;
      const role = String(req.user?.role || '').trim();
      const isAdminOrHQ = role === 'admin' || role === 'hq_manager';

      // 获取认证记录
      const existing = (await pool().query(`SELECT * FROM training_certifications WHERE id = $1`, [id])).rows[0];
      if (!existing) return res.json({ success: false, error: '认证记录不存在' });

      // 谁派发谁审核：非管理员/总部校验是否为派发人
      if (!isAdminOrHQ) {
        const assignCheck = await pool().query(
          `SELECT 1 FROM training_assignments WHERE employee_username = $1 AND topic_id = $2 AND lower(assigned_by) = lower($3) LIMIT 1`,
          [existing.employee_username, existing.topic_id, reviewer]
        );
        if (!assignCheck.rows.length) {
          return res.status(403).json({ error: '只有派发人才能审核此认证' });
        }
      }

      let finalScore = null;
      let managerScore = null;
      let reviewStatus = 'pending';
      let passed = false;
      let managerNote = note || '';
      let stepScores = existing.ai_step_scores;

      if (action === 'confirm') {
        // 确认AI评分
        reviewStatus = 'confirmed';
        finalScore = existing.ai_total_score || 0;
        passed = (existing.ai_verdict === 'passed' || finalScore >= 80);
      } else if (action === 'override' && Array.isArray(steps)) {
        // 人工覆盖评分
        reviewStatus = 'overridden';
        managerScore = steps.reduce((sum, s) => sum + (Number(s.score) || 0), 0);
        finalScore = managerScore;
        stepScores = steps;
        passed = managerScore >= 80; // rubric pass_threshold always 80
      } else if (verdict && ['passed', 'failed'].includes(verdict)) {
        // 兼容旧版调用（直接传passed/failed）
        reviewStatus = 'confirmed';
        passed = verdict === 'passed';
        finalScore = existing.ai_total_score || (passed ? 100 : 0);
      } else {
        return res.json({ success: false, error: '请提供 action (confirm/override) 或 verdict (passed/failed)' });
      }

      // 通过则按知识点的认证有效期计算到期日，作为P3持续认证的起点
      let validUntil = null;
      if (passed) {
        const topicRes = await pool().query(`SELECT validity_days FROM training_topics WHERE id = $1`, [existing.topic_id]);
        const days = Math.max(1, Number(topicRes.rows[0]?.validity_days) || 180);
        validUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      }

      await pool().query(
        `UPDATE training_certifications
         SET manager_verdict = $1, manager_note = $2, manager_reviewed_by = $3,
             review_status = $4, manager_score = $5, final_score = $6,
             ai_step_scores = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE ai_step_scores END,
             certified_at = CASE WHEN $8 THEN NOW() ELSE NULL END,
             valid_until = CASE WHEN $8 THEN $10::date ELSE valid_until END,
             status = CASE WHEN $8 THEN 'valid' ELSE status END
         WHERE id = $9`,
        [passed ? 'passed' : 'failed', managerNote, reviewer,
         reviewStatus, managerScore, finalScore, JSON.stringify(stepScores), passed, id, validUntil]
      );

      if (passed) {
        await pool().query(`UPDATE training_sessions SET status = 'certified' WHERE id = $1`, [existing.session_id]);
      }

      const updated = (await pool().query(`SELECT * FROM training_certifications WHERE id = $1`, [id])).rows[0];
      res.json({ success: true, certification: updated, final_score: finalScore });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 员工端路由
  // ═══════════════════════════════════════════════════════════

  // GET /api/training/my-topics - 我的培训任务
  app.get('/api/training/my-topics', authMiddleware, async (req, res) => {
    try {
      const username = req.user?.username;
      if (!username) {
        return res.status(401).json({ error: '未登录' });
      }

      const result = await pool().query(`
        SELECT a.id AS assignment_id, a.due_date, a.note, a.require_practice, a.assigned_by,
               t.id AS topic_id, t.title, t.position, t.description, t.key_points,
               s.id AS session_id, s.status AS session_status, s.quiz_passed, s.quiz_score,
               CASE WHEN EXISTS (
                 SELECT 1 FROM training_certifications ec
                 WHERE ec.session_id = s.id
                   AND ec.employee_username = a.employee_username
                   AND ec.tenant_id = a.tenant_id
                   AND (ec.manager_verdict = 'passed' OR ec.legacy_accepted = true)
                   AND COALESCE(ec.status, 'valid') = 'valid'
               ) THEN 'certified' ELSE COALESCE(s.status, 'not_started') END AS effective_status,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_overdue,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date = ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN true ELSE false
               END AS is_due_today,
               CASE
                 WHEN a.due_date IS NOT NULL
                  AND a.due_date < ((NOW() AT TIME ZONE 'Asia/Shanghai')::date)
                  AND COALESCE(s.status, 'not_started') != 'certified'
                 THEN (((NOW() AT TIME ZONE 'Asia/Shanghai')::date) - a.due_date)
                 ELSE 0
               END AS days_overdue
        FROM training_assignments a
        JOIN training_topics t ON t.id = a.topic_id
        LEFT JOIN training_sessions s ON s.topic_id = a.topic_id AND s.employee_username = a.employee_username
        WHERE a.employee_username = $1 AND t.is_active = true
        ORDER BY a.created_at DESC
      `, [username]);

      res.json({ success: true, topics: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/topics/:id/session - 获取或创建 session（含 KB 文章内容）
  app.get('/api/training/topics/:id/session', authMiddleware, async (req, res) => {
    try {
      const username = req.user?.username;
      const topicId = req.params.id;

      const topicResult = await pool().query(`SELECT * FROM training_topics WHERE id = $1 AND is_active = true`, [topicId]);
      if (topicResult.rows.length === 0) {
        return res.json({ success: false, error: '知识点不存在' });
      }
      const topic = topicResult.rows[0];

      // 拉取关联知识库文章全文供员工阅读
      let kbArticles = [];
      if (Array.isArray(topic.kb_article_ids) && topic.kb_article_ids.length > 0) {
        const kbResult = await pool().query(
          `SELECT id, title, content, file_path, file_type FROM knowledge_base WHERE id = ANY($1) AND enabled = true ORDER BY title`,
          [topic.kb_article_ids]
        );
        kbArticles = kbResult.rows;
      }

      let sessionResult = await pool().query(
        `SELECT * FROM training_sessions WHERE employee_username = $1 AND topic_id = $2`,
        [username, topicId]
      );
      if (sessionResult.rows.length === 0) {
        sessionResult = await pool().query(
          `INSERT INTO training_sessions (employee_username, topic_id) VALUES ($1, $2) RETURNING *`,
          [username, topicId]
        );
      }

      res.json({ success: true, topic, session: sessionResult.rows[0], kb_articles: kbArticles });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // GET /api/training/kb-file/:articleId - 直接提供培训文章文件（绕过知识库受众权限检查）
  app.get('/api/training/kb-file/:articleId', authMiddleware, async (req, res) => {
    const articleId = String(req.params.articleId || '').trim();
    if (!articleId) return res.status(400).json({ error: 'missing_id' });
    try {
      const check = await pool().query(
        `SELECT id FROM training_topics WHERE $1 = ANY(kb_article_ids) AND is_active = true LIMIT 1`,
        [articleId]
      );
      if (check.rows.length === 0) return res.status(403).json({ error: 'forbidden' });

      const r = await pool().query(
        `SELECT file_path, file_type FROM knowledge_base WHERE id = $1 AND enabled = true LIMIT 1`,
        [articleId]
      );
      const row = r.rows[0];
      if (!row?.file_path) return res.status(404).json({ error: 'not_found' });

      const kbUploadsDir = path.resolve(path.join(__dirname, '..', 'uploads'));
      const raw = String(row.file_path || '').trim();
      const rel = raw.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
      const normalized = path.posix.normalize(rel).replace(/^\/+/, '');
      if (!normalized || normalized.includes('..')) return res.status(400).json({ error: 'invalid_path' });
      const abs = path.join(kbUploadsDir, normalized);
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file_not_found' });

      const ft = String(row.file_type || '').toLowerCase();
      const ctMap = { pdf: 'application/pdf', video: 'video/mp4', img: 'image/jpeg', image: 'image/jpeg' };
      if (ctMap[ft]) res.setHeader('Content-Type', ctMap[ft]);
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(abs);
    } catch (e) {
      console.error('[Training] kb-file error:', e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/training/kb/:articleId/explanation - AI智能解析（首次生成后缓存，全员共用）
  app.get('/api/training/kb/:articleId/explanation', authMiddleware, async (req, res) => {
    const articleId = String(req.params.articleId || '').trim();
    if (!articleId) return res.status(400).json({ error: 'missing_id' });
    try {
      const check = await pool().query(
        `SELECT id FROM training_topics WHERE $1 = ANY(kb_article_ids) AND is_active = true LIMIT 1`,
        [articleId]
      );
      if (check.rows.length === 0) return res.status(403).json({ error: 'forbidden' });

      const r = await pool().query(
        `SELECT title, content, file_type, ai_explanation, ai_explanation_locked FROM knowledge_base WHERE id = $1 AND enabled = true LIMIT 1`,
        [articleId]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'not_found' });

      // 管理员手动编辑锁：锁定后直接返回，任何角色均不能自动覆盖；
      // 只有管理员在知识库调用"重新生成"后才能解锁并重新生成
      if (row.ai_explanation_locked) {
        return res.json({ success: true, explanation: row.ai_explanation || '', cached: true, locked: true });
      }

      // 已有缓存直接返回（管理员可传 ?force=1 强制重新生成，仅在未锁定时有效）
      const forceRegen = req.query.force === '1' && isManager(req.user?.role);
      if (!forceRegen && row.ai_explanation && row.ai_explanation.trim().length > 50) {
        return res.json({ success: true, explanation: row.ai_explanation, cached: true });
      }

      const rawContent = String(row.content || '').trim();
      if (!rawContent || rawContent.length < 20) {
        return res.json({ success: false, error: 'no_content', message: '此文章暂无文字内容，无法生成AI解析' });
      }

      const fileType = (row.file_type || '').toLowerCase();
      const isMediaFile = /video|image|mp4|mov|jpg|jpeg|png|gif/.test(fileType);

      // 手册/教材类：多章节综合文档，不能套单一SOP模板
      const titleAndHead = row.title + rawContent.slice(0, 800);
      const isHandbook = /体系手册|培训手册|培训教材|培训体系|操作手册|培训大纲|岗位手册|综合.*培训/.test(titleAndHead);

      // 真正的单操作SOP：内容含SOP结构词，且不是综合手册
      const isSopContent = !isHandbook && /SOP|标准操作|工序|步骤\s*\d|操作动作|质量标准|常见失败|补救/.test(rawContent);

      // 超长文档截断：单次LLM输入建议不超过25000字
      const MAX_CONTENT = 25000;
      const contentForPrompt = rawContent.length > MAX_CONTENT
        ? rawContent.slice(0, MAX_CONTENT) + `\n\n【注：原文共${rawContent.length}字，以上为前${MAX_CONTENT}字节选，请基于已有内容完整生成解析】`
        : rawContent;

      let prompt;
      if (isSopContent || isMediaFile) {
        prompt = `你是一名餐饮培训标准制定专家，请根据以下原始内容，输出严格对齐厨房SOP格式的标准培训解析。

【原始SOP内容】
${contentForPrompt}

请严格按以下结构输出（保留 ## 标题符号），每步必须包含：操作动作、质量标准、常见失败、补救措施、是否为关键步骤：

## 🍳 工序：${row.title}

## 📋 SOP步骤分解
按原始内容的步骤顺序，每一步用以下格式输出：

### 步骤N：操作动作名称

> **关键步骤**：是/否

- **操作动作**：具体做什么，一线员工能直接照着做的动作描述
- **质量标准**：做到什么程度算合格（可视化可判定）
- **⏱ 建议时长**：N分钟

> **常见失败**：可能会出什么问题

> **补救措施**：出了问题怎么办

### 步骤N+1：...

---

## ⚠️ 一票否决项
列出3-5条绝对不能出现的情况（出现任一即不合格）：

## ✅ 关键记忆
用"到岗→操作→复核"格式的口诀，帮助员工快速记住核心流程。

输出语言：简体中文。不要添加任何开场白或结尾语，直接从"## 🍳 工序"开始输出。`;
      } else if (isHandbook) {
        prompt = `你是一名餐饮人力资源培训专家，正在为管理层和员工制作综合培训手册解析。

【文件标题】${row.title}

【原始内容】
${contentForPrompt}

这是一份涵盖多个岗位/多个章节的综合培训手册，不是单一工序SOP。请按以下结构生成解析，必须忠实原文内容，不得虚构或替换：

## 📌 手册定位
用2-3句话说清楚：这份手册面向谁？覆盖哪些岗位？核心目标是什么？

## 🗂️ 内容框架
按原文章节结构，列出各章节/各岗位的培训模块，每条注明：模块名称 → 核心培训内容（1行概括）

## 📖 各岗位/章节详细解析
严格按原文每个章节/岗位逐一展开，格式如下：

### [章节/岗位名称]
**培训目标**：…
**核心技能/知识点**：列出原文要求的具体内容（含数字、标准、时限等）
**考核标准**：原文中的考核/验收要求
**晋升路径**（如有）：原文中的晋升条件

（按章节数量重复以上格式，不限章节数量，有几个写几个）

## ⚠️ 重要制度 & 红线
原文中的纪律要求、不合格标准、强制性规定（用"- "列出，不得自行添加）

## ✅ 使用指南
这份手册如何配合日常培训使用？新员工/管理者分别应关注哪几章？

输出语言：简体中文。忠实原文，不虚构内容，不要添加开场白，直接从"## 📌 手册定位"开始输出。`;
      } else {
        prompt = `你是一名经验丰富的餐饮培训导师，正在为餐厅一线员工制作培训材料。

【培训文章标题】${row.title}

【原始内容】
${contentForPrompt}

请根据以上内容，生成一份**结构清晰、内容完整、实用性强**的培训解析。核心要求：
- ⚠️ 原始内容中所有的具体数字、温度、时间、百分比、克重等量化数据**必须完整保留**，不得省略或模糊化（如"烧鹅出成65-70%"必须写出来，"中火180℃→大火220℃"必须写出来）
- ⚠️ 原始内容中每个具体的操作方法、标准、步骤**必须完整展开**，不能只写标题不写内容
- 语言可以口语化，但技术细节和标准数据必须一字不差保留
- 每个操作流程用数字编号，让员工照着做

请严格按以下结构输出（保留 ## 标题符号）：

## 📌 一句话总结
用一两句话说清楚这篇培训的核心是什么，让员工知道学完能干什么。

## 🎯 必须掌握的要点
列出3-6条最关键的知识点或操作步骤，每条单独一行，用"- "开头，简短有力。

## 📖 详细讲解
把原始内容的每个章节/每个知识点**完整展开**，结合实际工作场景说明。
- 对于每个大要点，列出所有子步骤和具体操作（不能只写标题）
- 所有具体数字、温度、出成率、时间等必须写出来
- 遇到操作流程按 1、2、3 步骤详细列出
- 每个大要点之间用空行分隔，加粗大要点标题

## ⚠️ 常见错误 & 注意事项
列出3-5条实际工作中容易犯的错误或被忽视的细节，用"- "开头。结合具体场景说明后果。

## ✅ 记住这几点就够了
用4-6条口诀或行动清单（含关键数字），帮助员工快速记住核心内容，类似"烧鹅出成65-70%，低于60%查腌制和改刀"这种含具体标准的格式。

输出语言：简体中文。不要添加任何开场白或结尾语，直接从"## 📌 一句话总结"开始输出。`;
      }

      const aiResp = await callLLM([
        { role: 'system', content: '你是专业的餐饮培训导师，擅长把复杂的操作规程转化成一线员工能快速理解和记忆的培训内容。输出时严格遵守给定的结构，不添加多余内容。' },
        { role: 'user', content: prompt }
      ], { max_tokens: 6000, temperature: 0.45 });

      const explanation = String(aiResp?.content || '').trim();
      if (!explanation || explanation.length < 100) {
        return res.json({ success: false, error: 'ai_failed', message: 'AI生成失败，请稍后重试' });
      }

      // 缓存到数据库，后续所有员工直接读缓存无需重新生成
      await pool().query(
        `UPDATE knowledge_base SET ai_explanation = $1, updated_at = NOW() WHERE id = $2`,
        [explanation, articleId]
      );

      res.json({ success: true, explanation, cached: false });
    } catch (e) {
      console.error('[Training] explanation error:', e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/training/my-certifications - 我的认证记录
  app.get('/api/training/my-certifications', authMiddleware, async (req, res) => {
    try {
      const username = req.user?.username;
      if (!username) return res.status(401).json({ error: '未登录' });
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const result = await pool().query(`
        SELECT c.id, c.session_id, c.topic_id, c.media_url, c.media_type,
               c.ai_verdict, c.ai_feedback, c.ai_total_score, c.ai_step_scores,
               c.manager_verdict, c.manager_note, c.final_score, c.manager_score,
               c.review_status, c.certified_at, c.created_at,
               t.title, t.position,
               a.require_practice,
               CASE WHEN (c.manager_verdict = 'passed' OR c.legacy_accepted = true)
                          AND COALESCE(c.status, 'valid') = 'valid'
                    THEN 'certified'
                    WHEN c.manager_verdict IS NULL AND c.legacy_accepted IS NOT TRUE
                    THEN 'pending_review'
                    ELSE 'not_certified'
               END AS effective_status,
               s.quiz_score, s.status AS session_status
        FROM training_certifications c
        JOIN training_topics t ON t.id = c.topic_id
        JOIN training_sessions s ON s.id = c.session_id
        LEFT JOIN LATERAL (
          SELECT require_practice
          FROM training_assignments
          WHERE employee_username = c.employee_username AND topic_id = c.topic_id
            AND tenant_id = c.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) a ON true
        WHERE c.employee_username = $1 AND c.tenant_id = $2
        ORDER BY c.created_at DESC
      `, [username, tenantId]);
      res.json({ success: true, certifications: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/chat - AI 对话
  app.post('/api/training/sessions/:id/chat', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { message } = req.body;
      const username = req.user?.username;

      if (!message?.trim()) {
        return res.json({ success: false, error: '消息不能为空' });
      }

      // 获取 session 和 topic（含关联知识库文章ID）
      const sessionResult = await pool().query(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.kb_article_ids
        FROM training_sessions s
        JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [id, username]);

      if (sessionResult.rows.length === 0) {
        return res.json({ success: false, error: '会话不存在' });
      }

      const session = sessionResult.rows[0];
      const topic = {
        title: session.title,
        position: session.position,
        description: session.description,
        key_points: session.key_points,
        kb_article_ids: session.kb_article_ids || []
      };

      // 构建对话历史
      const chatHistory = session.chat_history || [];
      chatHistory.push({ role: 'user', content: message });

      // 拼接关联知识库文章内容
      let kbContext = '';
      if (topic.kb_article_ids.length > 0) {
        const kbResult = await pool().query(
          `SELECT title, LEFT(content, 6000) AS content, ai_explanation, step_rubric FROM knowledge_base WHERE id = ANY($1) AND enabled = true`,
          [topic.kb_article_ids]
        );
        if (kbResult.rows.length > 0) {
          kbContext = '\n\n以下是相关参考资料，请结合这些内容回答（标准类内容以此为准）：\n\n' +
            kbResult.rows.map(r => `【${r.title}】\n${buildKbArticleText(r)}`).join('\n\n---\n\n');
        }
      }

      // 构建 system prompt（key_points 为空时只靠知识库内容）
      const kpText = Array.isArray(topic.key_points) && topic.key_points.length > 0
        ? `\n核心要点：${topic.key_points.join('、')}` : '';
      const systemPrompt = `你是一名餐饮培训助手，正在帮助员工学习「${topic.title}」。
岗位：${topic.position}${kpText}${kbContext}
请用简体中文，结合实际工作场景解释，适当提问检验理解。每次回复控制在150字以内。`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...chatHistory.slice(-10).map(h => ({ role: h.role, content: h.content }))
      ];

      // 调用 AI
      const aiResponse = await callLLM(messages, { max_tokens: 500, temperature: 0.7 });
      const aiReply = aiResponse?.content || '抱歉，AI 服务暂时不可用。';

      // 保存对话历史
      chatHistory.push({ role: 'assistant', content: aiReply });
      await pool().query(
        `UPDATE training_sessions SET chat_history = $1 WHERE id = $2`,
        [JSON.stringify(chatHistory), id]
      );

      res.json({ success: true, reply: aiReply, chat_history: chatHistory });
    } catch (e) {
      console.error('[Training] Chat error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/start-quiz - 开始测验
  app.post('/api/training/sessions/:id/start-quiz', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const username = req.user?.username;

      // 获取 session 和 topic（含关联知识库文章ID）
      const sessionResult = await pool().query(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.kb_article_ids
        FROM training_sessions s
        JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [id, username]);

      if (sessionResult.rows.length === 0) {
        return res.json({ success: false, error: '会话不存在' });
      }

      const session = sessionResult.rows[0];
      // Only block retake if already certified (passed and certified)
      if (session.status === 'certified') {
        return res.json({ success: false, error: '已完成认证，无需重复测试' });
      }

      const topic = {
        title: session.title,
        key_points: session.key_points,
        description: session.description,
        kb_article_ids: session.kb_article_ids || []
      };

      // Collect previous questions to avoid repetition (70%+ variety)
      let prevQuestionsSection = '';
      const prevQs = session.quiz_questions || [];
      if (prevQs.length > 0) {
        const prevTexts = prevQs.map((q, i) => `${i + 1}. ${q.q}`).join('\n');
        prevQuestionsSection = `\n\n【重要】以下是上次已出过的题目，本次必须避免重复，至少70%以上题目要全新不同：\n${prevTexts}`;
      }

      // 拼接关联知识库内容用于出题
      let kbQuizContext = '';
      if (topic.kb_article_ids.length > 0) {
        const kbResult = await pool().query(
          `SELECT title, LEFT(content, 6000) AS content, ai_explanation, step_rubric FROM knowledge_base WHERE id = ANY($1) AND enabled = true`,
          [topic.kb_article_ids]
        );
        if (kbResult.rows.length > 0) {
          kbQuizContext = '\n参考资料（请严格依据以下内容出题，标准类内容以此为准）：\n' +
            kbResult.rows.map(r => `【${r.title}】\n${buildKbArticleText(r)}`).join('\n---\n');
        }
      }

      // 生成测验题目（key_points 为空时纯靠知识库内容出题）
      const genResult = await generateQuizQuestionsForSession({
        topic: {
          title: topic.title,
          position: session.position,
          key_points: topic.key_points
        },
        username,
        kbQuizContext,
        prevQuestionsSection
      });

      let questionList = Array.isArray(genResult.questions) ? genResult.questions : [];
      if (questionList.length < 5) {
        console.error('[Training] Quiz generation failed completely:', genResult);
        return res.json({ success: false, error: '题目数量不足，请重试' });
      }

      if (genResult.source === 'rule') {
        console.warn('[Training] Quiz used rule-based fallback for session', id);
      }

      questionList = questionList.map(shuffleQuizOptions);

      // 保存题目（不含答案）
      const questionsForClient = questionList.map(q => ({
        q: q.q,
        options: q.options
      }));

      await pool().query(
        `UPDATE training_sessions SET quiz_questions = $1, status = 'quiz' WHERE id = $2`,
        [JSON.stringify(questionList), id]
      );

      res.json({ success: true, questions: questionsForClient });
    } catch (e) {
      console.error('[Training] Start quiz error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/submit-quiz - 提交测验答案
  app.post('/api/training/sessions/:id/submit-quiz', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { answers } = req.body; // [0, 2, 1] 格式
      const username = req.user?.username;

      if (!Array.isArray(answers) || answers.length < 1) {
        return res.json({ success: false, error: '请提交完整答案' });
      }

      // 获取 session
      const sessionResult = await pool().query(
        `SELECT * FROM training_sessions WHERE id = $1 AND employee_username = $2`,
        [id, username]
      );

      if (sessionResult.rows.length === 0) {
        return res.json({ success: false, error: '会话不存在' });
      }

      const session = sessionResult.rows[0];
      const questions = session.quiz_questions || [];

      // 查询 assignment 的 require_practice 标志
      const assignmentRes = await pool().query(
        `SELECT require_practice FROM training_assignments WHERE employee_username = $1 AND topic_id = $2`,
        [username, session.topic_id]
      );
      const requirePractice = assignmentRes.rows[0]?.require_practice ?? true; // 默认需要实操

      // 计算得分（百分制）
      let correctCount = 0;
      const results = questions.map((q, i) => {
        const userAnswer = answers[i];
        const correct = q.answer;
        const isCorrect = userAnswer === correct;
        if (isCorrect) correctCount++;
        return {
          q: q.q,
          options: q.options,
          userAnswer,
          correct,
          isCorrect,
          explanation: q.explanation
        };
      });

      const score = Math.round(correctCount / questions.length * 100); // 0-100分
      const passed = score >= 90; // 90分即通过

      // 通过且不需要实操 → 直接 certified；通过且需要实操 → practice；未通过 → 留在 quiz
      let nextStatus = 'quiz';
      if (passed) {
        nextStatus = requirePractice ? 'practice' : 'certified';
      }

      // 追加本次考试到 quiz_history（保留完整历史记录）
      await pool().query(
        `UPDATE training_sessions
         SET quiz_answers = $1, quiz_score = $2, quiz_passed = $3,
             quiz_passed_at = CASE WHEN $3 THEN NOW() ELSE quiz_passed_at END,
             status = $4,
             certified_at = CASE WHEN $5 THEN NOW() ELSE certified_at END,
             quiz_questions = NULL,
             quiz_history = COALESCE(quiz_history, '[]'::jsonb) || $6::jsonb
         WHERE id = $7`,
        [
          JSON.stringify(answers), score, passed, nextStatus, nextStatus === 'certified',
          JSON.stringify([{ score, passed, at: new Date().toISOString() }]),
          id
        ]
      );

      res.json({ success: true, score, passed, total: questions.length, results, require_practice: requirePractice, next_status: nextStatus });
    } catch (e) {
      console.error('[Training] Submit quiz error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/upload-practice - 上传实操视频/图片（图谱评分版）
  app.post('/api/training/sessions/:id/upload-practice', authMiddleware, uploadMiddleware.single('file'), async (req, res) => {
    try {
      const { id } = req.params;
      const username = req.user?.username;

      if (!req.file) {
        return res.json({ success: false, error: '请上传文件' });
      }

      const sessionResult = await pool().query(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.practice_task, t.step_rubric
        FROM training_sessions s JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [id, username]);

      if (sessionResult.rows.length === 0) return res.json({ success: false, error: '会话不存在' });
      const session = sessionResult.rows[0];
      if (!session.quiz_passed) return res.json({ success: false, error: '请先通过测验' });

      const rubric = session.step_rubric;
      const topicTitle = session.title || '';

      const filePath = req.file.path;
      const fileName = req.file.filename;
      const mediaUrl = `/uploads/training/${fileName}`;
      // /uploads现在是鉴权路由，按文件归属租户校验后才放行，这里记录归属
      await pool().query(
        `INSERT INTO upload_file_owners (filename, tenant_id, uploaded_by) VALUES ($1,$2,$3)
         ON CONFLICT (filename) DO NOTHING`,
        [fileName, req.tenantId || 'default', username || null]
      ).catch((e) => console.warn('[training] recordUploadOwnership failed:', e?.message));
      const originalExt = path.extname(req.file.originalname).toLowerCase();
      const mediaType = ['.mp4', '.mov', '.webm'].includes(originalExt) ? 'video' : 'image';
      const baseUrl = process.env.SERVER_BASE_URL || 'https://nnyx.cc';

      let aiVerdict = 'review';
      let aiFeedback = '';
      let aiRawResponse = null;
      let aiStepScores = null;
      let aiTotalScore = null;

      if (rubric && Array.isArray(rubric.items) && rubric.items.length) {
        // ──── 图谱评分模式（兼容新旧格式）────
        const dishInfo = rubric.dish_name ? `考核菜品：${rubric.dish_name}（${rubric.station || '未知工位'}）` : '';
        const scoringPrompt = `你是餐饮实操考试审评官。请根据以下步骤评分表，逐项判断员工操作是否合格，给出具体得分和扣分原因。

【评分表】
${dishInfo}
项目：
${rubric.items.map((item, i) => {
  const name = item.action || item.name || `步骤${i+1}`;
  const checks = item.checks || [];
  const quality = item.quality_standard ? `质量标准：${item.quality_standard}` : '';
  const failure = item.common_failure ? `常见失败：${item.common_failure}` : '';
  const critical = item.is_critical ? '【关键步骤】' : '';
  return `  ${i+1}. ${critical} ${name}（${item.weight}分）: ${checks.join('；')}${quality ? '\n     质量：'+quality : ''}${failure ? '\n     注意：'+failure : ''}`;
}).join('\n')}
一票否决项：${(rubric.fail_criteria || []).join('；')}
合格线：${rubric.pass_threshold || 80}分
实操科目：${topicTitle}

请先认真观看${mediaType === 'video' ? '完整视频' : '图片'}，然后逐项评分。严格返回JSON：
{
  "steps": [{"name":"步骤名称","score":12,"max":15,"feedback":"得分或扣分具体原因"}],
  "total_score": 88,
  "verdict": "passed/review/failed",
  "fail_reason": "一票否决原因（无则填null）",
  "summary": "整体评价，50字以内"
}
verdict说明：passed=总分≥${rubric.pass_threshold || 80}且无一票否决，review=总分60-79或存疑，failed=总分<60或有一票否决。
注意：只能输出JSON，不要任何额外文字。`;

        try {
          if (mediaType === 'image') {
            const visionResult = await callVisionLLM(filePath, scoringPrompt);
            aiRawResponse = visionResult;
            const text = visionResult?.content || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const p = parseScoringJson(jsonMatch[0]);
              aiVerdict = p.aiVerdict; aiFeedback = p.aiFeedback;
              aiStepScores = p.aiStepScores; aiTotalScore = p.aiTotalScore;
            }
          } else {
            const videoUrl = `${baseUrl}${mediaUrl}`;
            // Try native video analysis first
            let visionResult = await callVisionLLMVideo(videoUrl, scoringPrompt);
            if (!visionResult?.ok) {
              // Fallback: multi-frame extraction
              const frames = [];
              const frameDir = path.join(uploadsDir, `frames-${randomUUID()}`);
              fs.mkdirSync(frameDir, { recursive: true });
              try {
                execFileSync('ffmpeg', ['-i', filePath, '-vf', 'fps=1/5,scale=480:-1', '-frames:v', '8', path.join(frameDir, '%03d.jpg')], { timeout: 60000 });
                const frameFiles = fs.readdirSync(frameDir).sort().slice(0, 8);
                for (const f of frameFiles) {
                  const buf = fs.readFileSync(path.join(frameDir, f));
                  frames.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } });
                }
                frames.push({ type: 'text', text: scoringPrompt });
                visionResult = await callVisionLLM(frames, '');
              } finally {
                try { fs.rmSync(frameDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
              }
            }
            aiRawResponse = visionResult;
            const text = visionResult?.content || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const p = parseScoringJson(jsonMatch[0]);
              aiVerdict = p.aiVerdict; aiFeedback = p.aiFeedback;
              aiStepScores = p.aiStepScores; aiTotalScore = p.aiTotalScore;
            }
          }
        } catch (scoreErr) {
          console.error('[Training] Rubric scoring error:', scoreErr?.message);
          aiVerdict = 'review';
          aiFeedback = 'AI评分失败，需人工审核';
        }
      } else {
        // ──── 无图谱：传统单帧判断 ────
        const judgmentPrompt = `你是餐饮培训评审官。请根据以下实操任务要求，判断图片/视频帧中的操作是否合格。
任务要求：${session.practice_task || '按要求完成操作'}
考核要点：${JSON.stringify(session.key_points)}
请返回JSON：{"verdict":"passed/review/failed","feedback":"具体说明，50字以内"}
verdict说明：passed=合格，review=需人工复核，failed=不合格需重练。`;

        try {
          if (mediaType === 'image') {
            const visionResult = await callVisionLLM(filePath, judgmentPrompt);
            aiRawResponse = visionResult;
            const text = visionResult?.content || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              aiVerdict = parsed.verdict || 'review';
              aiFeedback = parsed.feedback || '';
            }
          } else {
            try {
              const framePath = path.join(uploadsDir, `frame-${randomUUID()}.jpg`);
              execFileSync('ffmpeg', ['-i', filePath, '-ss', '00:00:05', '-frames:v', '1', framePath], { timeout: 30000 });
              const visionResult = await callVisionLLM(framePath, judgmentPrompt);
              aiRawResponse = visionResult;
              const text = visionResult?.content || '';
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                aiVerdict = parsed.verdict || 'review';
                aiFeedback = parsed.feedback || '';
              }
              try { fs.unlinkSync(framePath); } catch (_) { /* ignore */ }
            } catch (ffmpegErr) {
              aiVerdict = 'review';
              aiFeedback = '视频处理失败，需人工审核';
            }
          }
        } catch (aiErr) {
          aiVerdict = 'review';
          aiFeedback = 'AI 判定失败，需人工审核';
        }
      }

      // 保存认证记录（图谱评分始终设为 pending review，等派发人确认）
      const certTenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const certResult = await pool().query(
        `INSERT INTO training_certifications (session_id, employee_username, topic_id, media_url, media_type, ai_verdict, ai_feedback, ai_raw_response, ai_step_scores, ai_total_score, review_status, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
         RETURNING *`,
        [id, username, session.topic_id, mediaUrl, mediaType, aiVerdict, aiFeedback || '', aiRawResponse, JSON.stringify(aiStepScores), aiTotalScore, certTenantId]
      );

      res.json({
        success: true,
        certification: certResult.rows[0],
        verdict: aiVerdict,
        feedback: aiFeedback,
        step_scores: aiStepScores,
        total_score: aiTotalScore,
        has_rubric: !!rubric
      });
    } catch (e) {
      console.error('[Training] Upload practice error:', e?.message);
      res.json({ success: false, error: e?.message });
    }
  });

}

export async function runTrainingReminderSweep() {
  const todayKey = getShanghaiDateKey();
  let preDueSent = 0;
  let overdueEscalated = 0;

  try {
    const result = await pool().query(`
      SELECT
        a.id,
        a.employee_username,
        a.assigned_by,
        a.topic_id,
        a.due_date,
        a.reminder_meta,
        t.title,
        COALESCE(e.name, a.employee_username) AS employee_name,
        COALESCE(assigner_emp.name, a.assigned_by, '管理员') AS assigner_name,
        COALESCE(s.status, 'not_started') AS session_status
      FROM training_assignments a
      JOIN training_topics t ON t.id = a.topic_id
      LEFT JOIN training_sessions s ON s.topic_id = a.topic_id AND s.employee_username = a.employee_username
      LEFT JOIN employees e ON e.username = a.employee_username
      LEFT JOIN employees assigner_emp ON assigner_emp.username = a.assigned_by
      WHERE a.due_date IS NOT NULL
        AND t.is_active = true
        AND COALESCE(s.status, 'not_started') != 'certified'
      ORDER BY a.due_date ASC, a.created_at ASC
    `);

    for (const row of result.rows || []) {
      const dueDate = String(row.due_date || '').slice(0, 10);
      if (!dueDate) continue;
      const reminderMeta = parseReminderMeta(row.reminder_meta);
      const topicTitle = String(row.title || '培训任务').trim();
      const assigneeName = String(row.employee_name || row.employee_username || '').trim() || '员工';
      const isOverdue = todayKey > dueDate;

      if (!isOverdue) {
        if (reminderMeta.last_pre_due_reminder_on === todayKey) continue;
        const message = `请在 ${dueDate} 前完成培训任务「${topicTitle}」。系统将每天提醒一次，当前仍未完成，请尽快登录 HRMS 完成学习。`;
        await createTrainingUserNotification(
          row.employee_username,
          '培训任务完成提醒',
          message,
          {
            assignment_id: row.id,
            topic_id: row.topic_id,
            due_date: dueDate,
            reminder_phase: 'pre_due',
            reminded_on: todayKey
          }
        );
        await sendTrainingFeishuMessage(
          row.employee_username,
          `📚 培训任务提醒\n\n你被指派的培训任务【${topicTitle}】尚未完成。\n截止日期：${dueDate}\n系统会在截止前每天提醒 1 次，请尽快登录 HRMS 完成学习。`
        );
        await pool().query(
          `UPDATE training_assignments
           SET reminder_meta = COALESCE(reminder_meta, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          [
            JSON.stringify({
              last_pre_due_reminder_on: todayKey,
              pre_due_reminder_count: Number(reminderMeta.pre_due_reminder_count || 0) + 1,
              last_pre_due_reminder_at: getShanghaiDateTimeText()
            }),
            row.id
          ]
        );
        preDueSent++;
        continue;
      }

      if (reminderMeta.last_overdue_reminder_on === todayKey) continue;
      const daysOverdue = Math.max(1, Math.floor((Date.parse(`${todayKey}T00:00:00+08:00`) - Date.parse(`${dueDate}T00:00:00+08:00`)) / 86400000));
      await sendTrainingFeishuMessage(
        row.employee_username,
        `⚠️ 培训任务已逾期\n\n培训任务【${topicTitle}】已超过截止日期 ${daysOverdue} 天（截止：${dueDate}）。请立即登录 HRMS 补完成，进度看板已标记为逾期。`
      );
      if (row.assigned_by) {
        await sendTrainingFeishuMessage(
          row.assigned_by,
          `🚨 培训任务逾期提醒\n\n${assigneeName} 的培训任务【${topicTitle}】已逾期 ${daysOverdue} 天（截止：${dueDate}），当前仍未完成。请在培训进度看板中查看并跟进。`
        );
        await createTrainingUserNotification(
          row.assigned_by,
          '培训任务逾期提醒',
          `${assigneeName} 的培训任务「${topicTitle}」已逾期 ${daysOverdue} 天，请及时跟进。`,
          {
            assignment_id: row.id,
            topic_id: row.topic_id,
            due_date: dueDate,
            assignee_username: row.employee_username,
            reminder_phase: 'overdue_escalation',
            reminded_on: todayKey
          }
        );
      }
      await pool().query(
        `UPDATE training_assignments
         SET reminder_meta = COALESCE(reminder_meta, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            last_overdue_reminder_on: todayKey,
            overdue_reminder_count: Number(reminderMeta.overdue_reminder_count || 0) + 1,
            last_overdue_reminder_at: getShanghaiDateTimeText()
          }),
          row.id
        ]
      );
      overdueEscalated++;
    }
  } catch (e) {
    console.error('[Training] reminder sweep error:', e?.message || e);
    return { ok: false, error: e?.message || String(e), preDueSent, overdueEscalated };
  }

  if (preDueSent || overdueEscalated) {
    console.log(`[Training] reminder sweep complete: preDue=${preDueSent}, overdue=${overdueEscalated}`);
  }
  return { ok: true, preDueSent, overdueEscalated };
}

// 认证到期前提前天数，触发复训指派
const RECERT_LEAD_DAYS = 14;

// 认证到期复训：每条知识点认证有效期到期（或即将到期）时，
// 自动将认证标记为过期，并指派一条复训任务（source='recert'）
export async function runCertificationExpirySweep() {
  let expired = 0;
  let recertAssigned = 0;

  try {
    const result = await pool().query(`
      SELECT c.id, c.employee_username, c.topic_id, c.valid_until, c.certified_at, c.status, c.tenant_id, t.title
      FROM training_certifications c
      JOIN training_topics t ON t.id = c.topic_id
      WHERE c.manager_verdict = 'passed'
        AND c.status IN ('valid', 'expired')
        AND c.valid_until IS NOT NULL
        AND c.valid_until <= CURRENT_DATE + INTERVAL '${RECERT_LEAD_DAYS} days'
        AND c.id = (
          SELECT c2.id FROM training_certifications c2
          WHERE c2.employee_username = c.employee_username AND c2.topic_id = c.topic_id
          ORDER BY c2.created_at DESC LIMIT 1
        )
      AND t.is_active = true
    `);

    for (const row of result.rows || []) {
      if (row.status === 'valid' && row.valid_until && getShanghaiDateKey() > String(row.valid_until).slice(0, 10)) {
        await pool().query(`UPDATE training_certifications SET status = 'expired' WHERE id = $1`, [row.id]);
        expired++;
      }

      const existing = await pool().query(
        `SELECT 1 FROM training_assignments
         WHERE employee_username = $1 AND topic_id = $2 AND source = 'recert' AND created_at > $3
         LIMIT 1`,
        [row.employee_username, row.topic_id, row.certified_at]
      );
      if (existing.rows.length) continue;

      // assigned_by 不能留空：审核队列按「谁派发谁审核」过滤，assigned_by=NULL 时
      // 非admin/hq_manager角色永远查不到这条待审——复训通知发了但没人能审核确认。
      // 这里回填为该员工所在门店的出品经理/店长（跟晋升派发同一套解法）。
      let recertAssignedBy = null;
      try {
        const empRow = await pool().query(
          `SELECT store FROM employees WHERE username = $1 AND tenant_id = $2 LIMIT 1`,
          [row.employee_username, row.tenant_id]
        );
        const store = String(empRow.rows[0]?.store || '').trim();
        if (store) {
          const mgrRow = await pool().query(
            `SELECT username, position FROM employees
             WHERE store = $1 AND tenant_id = $2 AND role IN ('store_production_manager','store_manager')
               AND COALESCE(status, '') NOT IN ('离职', 'inactive')
             ORDER BY CASE WHEN position ~ '出品经理|厨师长' THEN 0 ELSE 1 END
             LIMIT 1`,
            [store, row.tenant_id]
          );
          recertAssignedBy = mgrRow.rows[0]?.username || null;
        }
      } catch (e) {
        console.warn('[Training] recert assignedBy lookup failed:', e?.message);
      }

      await createTrainingAssignment({
        employeeUsername: row.employee_username,
        topicId: row.topic_id,
        assignedBy: recertAssignedBy,
        dueDate: row.valid_until,
        note: `认证「${row.title}」即将于 ${String(row.valid_until).slice(0, 10)} 到期，请完成复训重新认证。`,
        requirePractice: true,
        source: 'recert',
        tenantId: row.tenant_id
      });
      recertAssigned++;
    }
  } catch (e) {
    console.error('[Training] certification expiry sweep error:', e?.message || e);
    return { ok: false, error: e?.message || String(e), expired, recertAssigned };
  }

  if (expired || recertAssigned) {
    console.log(`[Training] certification expiry sweep complete: expired=${expired}, recertAssigned=${recertAssigned}`);
  }
  return { ok: true, expired, recertAssigned };
}

export function startTrainingReminderScheduler() {
  if (_trainingReminderSchedulerStarted) return;
  _trainingReminderSchedulerStarted = true;

  const tick = () => {
    runForActiveTenants(
      (tenantId) => runTrainingReminderSweep().then((value) => ({ tenantId, ...value })),
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          console.error(`[Training] reminder scheduler tick error (tenant=${tenantId}):`, error?.message || error);
        }
      }
    ).catch((e) => {
      console.error('[Training] reminder scheduler bootstrap error:', e?.message || e);
    });
    runForActiveTenants(
      (tenantId) => runCertificationExpirySweep().then((value) => ({ tenantId, ...value })),
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          console.error(`[Training] certification expiry scheduler tick error (tenant=${tenantId}):`, error?.message || error);
        }
      }
    ).catch((e) => {
      console.error('[Training] certification expiry scheduler bootstrap error:', e?.message || e);
    });
  };

  setTimeout(tick, 90 * 1000);
  setInterval(tick, TRAINING_REMINDER_INTERVAL_MS);
  console.log('[Training] reminder scheduler started');
}
