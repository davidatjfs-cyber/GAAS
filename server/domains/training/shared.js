/**
 * Training domain shared helpers (pool, roles, quiz/LLM parse, notifications, paths).
 */
import { pool as getPool, resolveTenantIdDefault } from '../../utils/database.js';
import { callLLM, lookupFeishuUserByUsername, sendLarkMessage } from '../../agents.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'shared' });


const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to server/ (parent of domains/training). */
export const serverDir = path.join(__dirname, '../..');
export const uploadsDir = path.join(serverDir, 'uploads', 'training');

export function pool() { return getPool(); }

export const MANAGER_ROLES = ['admin', 'hq_manager', 'store_manager', 'store_production_manager', 'hr_manager'];
export function isManager(role) { return MANAGER_ROLES.includes(role); }

// JWT 不含 store，从 employees 表实时查
export async function getUserStore(username) {
  try {
    const r = await pool().query(`SELECT store FROM employees WHERE username = $1 LIMIT 1`, [username]);
    return String(r.rows[0]?.store || '').trim();
  } catch (_) { return ''; }
}

// 出题/学习取材：优先用管理员精修过的 AI解析(ai_explanation)，其次原始正文(content)，
// 并附上步骤图谱(step_rubric)的标准类内容。
// 原则：培训内容与考题必须以更新后的 AI解析/知识图谱为准。
export function formatRubricStandards(rubric) {
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

export function buildKbArticleText(row) {
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
export function getAssignableRoles(assignerRole) {
  if (['admin', 'hr_manager'].includes(assignerRole)) return null; // null = 所有人
  if (assignerRole === 'hq_manager') return ['store_manager', 'store_production_manager', 'store_employee', 'cashier', 'front_manager'];
  if (assignerRole === 'store_manager') return ['store_employee', 'cashier', 'front_manager'];
  if (assignerRole === 'store_production_manager') return ['store_employee'];
  return null;
}

export function getShanghaiDateKey(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

export function parseScoringJson(jsonText) {
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

export function stripJsonCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function repairJsonText(text) {
  let s = stripJsonCodeFence(text);
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export function tryParseQuizJsonFromLLM(text) {
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

export function normalizeQuizAnswerIndex(answerRaw, options) {
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

export function normalizeQuizQuestion(raw) {
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

export function normalizeQuizQuestionsPayload(parsed) {
  let list = [];
  if (Array.isArray(parsed)) list = parsed;
  else if (Array.isArray(parsed?.questions)) list = parsed.questions;
  else if (Array.isArray(parsed?.data?.questions)) list = parsed.data.questions;
  return list.map(normalizeQuizQuestion).filter(Boolean);
}

export function shuffleQuizOptions(q) {
  if (!Array.isArray(q?.options) || q.options.length < 2) return q;
  const idx = Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0));
  const correctAnswer = q.options[idx];
  if (correctAnswer == null) return q;
  const shuffled = [...q.options].sort(() => Math.random() - 0.5);
  const newAnswerIdx = shuffled.indexOf(correctAnswer);
  return { ...q, options: shuffled, answer: newAnswerIdx >= 0 ? newAnswerIdx : idx };
}

export function buildRuleBasedQuizQuestions({ topicTitle, keyPoints, kbContext, count = 20 }) {
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

export async function generateQuizQuestionsForSession({ topic, username, kbQuizContext, prevQuestionsSection }) {
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
      log.warn({
        msg: 'training_quiz_ai_parse_failed',
        attempt: attempt + 1,
        ok: aiResponse?.ok,
        preview: quizText.slice(0, 400),
        parsedCount: questions.length
      });
    } catch (e) {
      log.warn({ msg: 'training_quiz_ai_call_failed', err: e?.message || String(e) });
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

export function getShanghaiDateTimeText(date = new Date()) {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function parseReminderMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

export async function createTrainingUserNotification(targetUsername, title, message, meta) {
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

export async function sendTrainingFeishuMessage(username, message) {
  try {
    const fu = await lookupFeishuUserByUsername(username);
    if (fu?.open_id) {
      await sendLarkMessage(fu.open_id, message, { skipDedup: true });
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

export { resolveTenantIdDefault };
