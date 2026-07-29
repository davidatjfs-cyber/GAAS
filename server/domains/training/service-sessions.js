/**
 * Training session pure/service logic.
 * Injectable query for tests; defaults to shared pool from routes.
 */
import path from 'path';
import fs from 'fs';
import { pool } from './shared.js';
import {
  resolvePracticeMediaType,
  scorePracticeMediaWithRubric,
  scorePracticeMediaWithoutRubric,
} from './upload-practice-media-helpers.js';
import { notifyCertificationReviewersPending } from './certification-reviewer.js';

function resolveQuery(query) {
  return query || ((sql, params) => pool().query(sql, params));
}

/**
 * @param {object[]} questions
 * @param {number[]} answers
 * @param {boolean} [requirePractice=true]
 * @returns {{ correctCount: number, score: number, passed: boolean, results: object[], nextStatus: string }}
 */
export function computeQuizGrade(questions, answers, requirePractice = true) {
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
      explanation: q.explanation,
    };
  });

  const score = Math.round((correctCount / questions.length) * 100);
  const passed = score >= 90;
  let nextStatus = 'quiz';
  if (passed) {
    nextStatus = requirePractice ? 'practice' : 'certified';
  }

  return { correctCount, score, passed, results, nextStatus };
}

/**
 * @param {{ username?: string, query?: Function }} params
 */
export async function listMyTrainingTopics({ username, query }) {
  const q = resolveQuery(query);
  try {
    if (!username) {
      return { success: false, error: '未登录', status: 401 };
    }

    const result = await q(`
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

    return { success: true, topics: result.rows };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

/**
 * @param {{ username?: string, topicId: string, query?: Function, randomUUID?: Function }} params
 */
export async function getOrCreateTopicSession({ username, topicId, query }) {
  const q = resolveQuery(query);
  try {
    const topicResult = await q(
      `SELECT * FROM training_topics WHERE id = $1 AND is_active = true`,
      [topicId]
    );
    if (topicResult.rows.length === 0) {
      return { success: false, error: '知识点不存在' };
    }
    const topic = topicResult.rows[0];

    let kbArticles = [];
    if (Array.isArray(topic.kb_article_ids) && topic.kb_article_ids.length > 0) {
      const kbResult = await q(
        `SELECT id, title, content, file_path, file_type FROM knowledge_base WHERE id = ANY($1) AND enabled = true ORDER BY title`,
        [topic.kb_article_ids]
      );
      kbArticles = kbResult.rows;
    }

    let sessionResult = await q(
      `SELECT * FROM training_sessions WHERE employee_username = $1 AND topic_id = $2`,
      [username, topicId]
    );
    if (sessionResult.rows.length === 0) {
      sessionResult = await q(
        `INSERT INTO training_sessions (employee_username, topic_id) VALUES ($1, $2) RETURNING *`,
        [username, topicId]
      );
    }

    return {
      success: true,
      topic,
      session: sessionResult.rows[0],
      kb_articles: kbArticles,
    };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

/**
 * @param {{ username?: string, sessionId: string, answers: unknown, query?: Function }} params
 */
export async function gradeAndSubmitQuiz({ username, sessionId, answers, query }) {
  const q = resolveQuery(query);
  try {
    if (!Array.isArray(answers) || answers.length < 1) {
      return { success: false, error: '请提交完整答案' };
    }

    const sessionResult = await q(
      `SELECT * FROM training_sessions WHERE id = $1 AND employee_username = $2`,
      [sessionId, username]
    );

    if (sessionResult.rows.length === 0) {
      return { success: false, error: '会话不存在' };
    }

    const session = sessionResult.rows[0];
    const questions = session.quiz_questions || [];

    const assignmentRes = await q(
      `SELECT require_practice FROM training_assignments WHERE employee_username = $1 AND topic_id = $2`,
      [username, session.topic_id]
    );
    const requirePractice = assignmentRes.rows[0]?.require_practice ?? true;

    const { score, passed, results, nextStatus } = computeQuizGrade(
      questions,
      answers,
      requirePractice
    );

    await q(
      `UPDATE training_sessions
         SET quiz_answers = $1, quiz_score = $2, quiz_passed = $3,
             quiz_passed_at = CASE WHEN $3 THEN NOW() ELSE quiz_passed_at END,
             status = $4,
             certified_at = CASE WHEN $5 THEN NOW() ELSE certified_at END,
             quiz_questions = NULL,
             quiz_history = COALESCE(quiz_history, '[]'::jsonb) || $6::jsonb
         WHERE id = $7`,
      [
        JSON.stringify(answers),
        score,
        passed,
        nextStatus,
        nextStatus === 'certified',
        JSON.stringify([{ score, passed, at: new Date().toISOString() }]),
        sessionId,
      ]
    );

    return {
      success: true,
      score,
      passed,
      total: questions.length,
      results,
      require_practice: requirePractice,
      next_status: nextStatus,
    };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

/**
 * Resolve KB article file path for training kb-file route.
 * @param {{ filePath: string, serverDir: string, pathModule?: typeof path, fsModule?: typeof fs }} params
 * @returns {{ error: string, status: number } | { abs: string, contentType?: string }}
 */
export function resolveTrainingKbFilePath({ filePath, serverDir, pathModule = path, fsModule = fs }) {
  const kbUploadsDir = pathModule.resolve(pathModule.join(serverDir, '..', 'uploads'));
  const raw = String(filePath || '').trim();
  const rel = raw.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
  const normalized = pathModule.posix.normalize(rel).replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    return { error: 'invalid_path', status: 400 };
  }
  const abs = pathModule.join(kbUploadsDir, normalized);
  if (!fsModule.existsSync(abs)) {
    return { error: 'file_not_found', status: 404 };
  }
  return { abs };
}

/**
 * @param {{ sessionId: string, username?: string, message: unknown, query?: Function, callLLM: Function, buildKbArticleText: Function }} params
 */
export async function chatTrainingSession({
  sessionId,
  username,
  message,
  query,
  callLLM,
  buildKbArticleText,
}) {
  const q = resolveQuery(query);
  try {
    if (!message?.trim()) {
      return { success: false, error: '消息不能为空' };
    }

    const sessionResult = await q(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.kb_article_ids
        FROM training_sessions s
        JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [sessionId, username]);

    if (sessionResult.rows.length === 0) {
      return { success: false, error: '会话不存在' };
    }

    const session = sessionResult.rows[0];
    const topic = {
      title: session.title,
      position: session.position,
      description: session.description,
      key_points: session.key_points,
      kb_article_ids: session.kb_article_ids || [],
    };

    const chatHistory = session.chat_history || [];
    chatHistory.push({ role: 'user', content: message });

    let kbContext = '';
    if (topic.kb_article_ids.length > 0) {
      const kbResult = await q(
        `SELECT title, LEFT(content, 6000) AS content, ai_explanation, step_rubric FROM knowledge_base WHERE id = ANY($1) AND enabled = true`,
        [topic.kb_article_ids]
      );
      if (kbResult.rows.length > 0) {
        kbContext = '\n\n以下是相关参考资料，请结合这些内容回答（标准类内容以此为准）：\n\n' +
          kbResult.rows.map((r) => `【${r.title}】\n${buildKbArticleText(r)}`).join('\n\n---\n\n');
      }
    }

    const kpText = Array.isArray(topic.key_points) && topic.key_points.length > 0
      ? `\n核心要点：${topic.key_points.join('、')}` : '';
    const systemPrompt = `你是一名餐饮培训助手，正在帮助员工学习「${topic.title}」。
岗位：${topic.position}${kpText}${kbContext}
请用简体中文，结合实际工作场景解释，适当提问检验理解。每次回复控制在150字以内。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    ];

    const aiResponse = await callLLM(messages, { max_tokens: 500, temperature: 0.7 });
    const aiReply = aiResponse?.content || '抱歉，AI 服务暂时不可用。';

    chatHistory.push({ role: 'assistant', content: aiReply });
    await q(
      `UPDATE training_sessions SET chat_history = $1 WHERE id = $2`,
      [JSON.stringify(chatHistory), sessionId]
    );

    return { success: true, reply: aiReply, chat_history: chatHistory };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

/**
 * @param {{ sessionId: string, username?: string, query?: Function, generateQuizQuestionsForSession: Function, shuffleQuizOptions: Function, buildKbArticleText: Function, log?: Function }} params
 */
export async function startTrainingQuiz({
  sessionId,
  username,
  query,
  generateQuizQuestionsForSession,
  shuffleQuizOptions,
  buildKbArticleText,
  log = console,
}) {
  const q = resolveQuery(query);
  try {
    const sessionResult = await q(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.kb_article_ids
        FROM training_sessions s
        JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [sessionId, username]);

    if (sessionResult.rows.length === 0) {
      return { success: false, error: '会话不存在' };
    }

    const session = sessionResult.rows[0];
    if (session.status === 'certified') {
      return { success: false, error: '已完成认证，无需重复测试' };
    }

    const topic = {
      title: session.title,
      key_points: session.key_points,
      description: session.description,
      kb_article_ids: session.kb_article_ids || [],
    };

    let prevQuestionsSection = '';
    const prevQs = session.quiz_questions || [];
    if (prevQs.length > 0) {
      const prevTexts = prevQs.map((item, i) => `${i + 1}. ${item.q}`).join('\n');
      prevQuestionsSection = `\n\n【重要】以下是上次已出过的题目，本次必须避免重复，至少70%以上题目要全新不同：\n${prevTexts}`;
    }

    let kbQuizContext = '';
    if (topic.kb_article_ids.length > 0) {
      const kbResult = await q(
        `SELECT title, LEFT(content, 6000) AS content, ai_explanation, step_rubric FROM knowledge_base WHERE id = ANY($1) AND enabled = true`,
        [topic.kb_article_ids]
      );
      if (kbResult.rows.length > 0) {
        kbQuizContext = '\n参考资料（请严格依据以下内容出题，标准类内容以此为准）：\n' +
          kbResult.rows.map((r) => `【${r.title}】\n${buildKbArticleText(r)}`).join('\n---\n');
      }
    }

    const genResult = await generateQuizQuestionsForSession({
      topic: {
        title: topic.title,
        position: session.position,
        key_points: topic.key_points,
      },
      username,
      kbQuizContext,
      prevQuestionsSection,
    });

    let questionList = Array.isArray(genResult.questions) ? genResult.questions : [];
    if (questionList.length < 5) {
      log.error?.('[Training] Quiz generation failed completely:', genResult);
      return { success: false, error: '题目数量不足，请重试' };
    }

    if (genResult.source === 'rule') {
      log.warn?.('[Training] Quiz used rule-based fallback for session', sessionId);
    }

    questionList = questionList.map(shuffleQuizOptions);

    const questionsForClient = questionList.map((item) => ({
      q: item.q,
      options: item.options,
    }));

    await q(
      `UPDATE training_sessions SET quiz_questions = $1, status = 'quiz' WHERE id = $2`,
      [JSON.stringify(questionList), sessionId]
    );

    return { success: true, questions: questionsForClient };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

/**
 * Build KB article AI explanation prompt (SOP / handbook / default).
 * @param {{ title: string, rawContent: string, fileType?: string }} params
 * @returns {{ prompt: string, kind: 'sop'|'handbook'|'default' }}
 */
export function buildKbExplanationPrompt({ title, rawContent, fileType = '' }) {
  const ft = String(fileType || '').toLowerCase();
  const isMediaFile = /video|image|mp4|mov|jpg|jpeg|png|gif/.test(ft);

  const titleAndHead = title + rawContent.slice(0, 800);
  const isHandbook = /体系手册|培训手册|培训教材|培训体系|操作手册|培训大纲|岗位手册|综合.*培训/.test(titleAndHead);

  const isSopContent = !isHandbook && /SOP|标准操作|工序|步骤\s*\d|操作动作|质量标准|常见失败|补救/.test(rawContent);

  const MAX_CONTENT = 25000;
  const contentForPrompt = rawContent.length > MAX_CONTENT
    ? rawContent.slice(0, MAX_CONTENT) + `\n\n【注：原文共${rawContent.length}字，以上为前${MAX_CONTENT}字节选，请基于已有内容完整生成解析】`
    : rawContent;

  let prompt;
  let kind;
  if (isSopContent || isMediaFile) {
    kind = 'sop';
    prompt = `你是一名餐饮培训标准制定专家，请根据以下原始内容，输出严格对齐厨房SOP格式的标准培训解析。

【原始SOP内容】
${contentForPrompt}

请严格按以下结构输出（保留 ## 标题符号），每步必须包含：操作动作、质量标准、常见失败、补救措施、是否为关键步骤：

## 🍳 工序：${title}

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
    kind = 'handbook';
    prompt = `你是一名餐饮人力资源培训专家，正在为管理层和员工制作综合培训手册解析。

【文件标题】${title}

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
    kind = 'default';
    prompt = `你是一名经验丰富的餐饮培训导师，正在为餐厅一线员工制作培训材料。

【培训文章标题】${title}

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

  return { prompt, kind };
}

/**
 * @param {{ articleId: string, forceRegen?: boolean, isManagerRole?: boolean, query?: Function, callLLM: Function }} params
 */
export async function getKbArticleExplanation({
  articleId,
  forceRegen = false,
  isManagerRole = false,
  query,
  callLLM,
}) {
  const q = resolveQuery(query);
  try {
    const check = await q(
      `SELECT id FROM training_topics WHERE $1 = ANY(kb_article_ids) AND is_active = true LIMIT 1`,
      [articleId]
    );
    if (check.rows.length === 0) {
      return { httpStatus: 403, error: 'forbidden' };
    }

    const r = await q(
      `SELECT title, content, file_type, ai_explanation, ai_explanation_locked FROM knowledge_base WHERE id = $1 AND enabled = true LIMIT 1`,
      [articleId]
    );
    const row = r.rows[0];
    if (!row) {
      return { httpStatus: 404, error: 'not_found' };
    }

    if (row.ai_explanation_locked) {
      return { success: true, explanation: row.ai_explanation || '', cached: true, locked: true };
    }

    const shouldForceRegen = forceRegen && isManagerRole;
    if (!shouldForceRegen && row.ai_explanation && row.ai_explanation.trim().length > 50) {
      return { success: true, explanation: row.ai_explanation, cached: true };
    }

    const rawContent = String(row.content || '').trim();
    if (!rawContent || rawContent.length < 20) {
      return { success: false, error: 'no_content', message: '此文章暂无文字内容，无法生成AI解析' };
    }

    const { prompt } = buildKbExplanationPrompt({
      title: row.title,
      rawContent,
      fileType: row.file_type,
    });

    const aiResp = await callLLM([
      { role: 'system', content: '你是专业的餐饮培训导师，擅长把复杂的操作规程转化成一线员工能快速理解和记忆的培训内容。输出时严格遵守给定的结构，不添加多余内容。' },
      { role: 'user', content: prompt },
    ], { max_tokens: 6000, temperature: 0.45 });

    const explanation = String(aiResp?.content || '').trim();
    if (!explanation || explanation.length < 100) {
      return { success: false, error: 'ai_failed', message: 'AI生成失败，请稍后重试' };
    }

    await q(
      `UPDATE knowledge_base SET ai_explanation = $1, updated_at = NOW() WHERE id = $2`,
      [explanation, articleId]
    );

    return { success: true, explanation, cached: false };
  } catch (e) {
    return { httpStatus: 500, error: e?.message };
  }
}

/**
 * @param {{ sessionId: string, username?: string, tenantId?: string, file: object|null, query?: Function, uploadsDir: string, pathModule?: typeof path, fsModule?: typeof fs, execFileSync: Function, callVisionLLM: Function, callVisionLLMVideo: Function, parseScoringJson: Function, randomUUID: Function, serverBaseUrl?: string, log?: Console }} params
 */
export async function uploadPracticeMedia({
  sessionId,
  username,
  tenantId,
  file,
  files,
  query,
  uploadsDir,
  pathModule = path,
  fsModule = fs,
  execFileSync,
  callVisionLLM,
  callVisionLLMVideo,
  parseScoringJson,
  randomUUID,
  serverBaseUrl,
  log = console,
}) {
  const q = resolveQuery(query);
  try {
    const fileList = Array.isArray(files) && files.length
      ? files.filter(Boolean)
      : (file ? [file] : []);
    if (!fileList.length) {
      return { success: false, error: '请上传文件' };
    }

    const sessionResult = await q(`
        SELECT s.*, t.title, t.position, t.description, t.key_points, t.practice_task, t.step_rubric
        FROM training_sessions s JOIN training_topics t ON t.id = s.topic_id
        WHERE s.id = $1 AND s.employee_username = $2
      `, [sessionId, username]);

    if (sessionResult.rows.length === 0) {
      return { success: false, error: '会话不存在' };
    }
    const session = sessionResult.rows[0];
    if (!session.quiz_passed) {
      return { success: false, error: '请先通过测验' };
    }

    const pendingCert = await q(
      `SELECT id FROM training_certifications
         WHERE session_id = $1 AND lower(employee_username) = lower($2)
           AND manager_verdict IS NULL
         LIMIT 1`,
      [sessionId, username]
    );
    if (pendingCert.rows.length) {
      return { success: false, error: '已有待审核的实操提交，请等待审核完成后再提交' };
    }

    const recentCert = await q(
      `SELECT id FROM training_certifications
         WHERE session_id = $1 AND lower(employee_username) = lower($2)
           AND created_at > NOW() - INTERVAL '30 seconds'
         LIMIT 1`,
      [sessionId, username]
    );
    if (recentCert.rows.length) {
      return { success: false, error: '提交过于频繁，请 30 秒后再试' };
    }

    const rubric = session.step_rubric;
    const topicTitle = session.title || '';
    const mediaUrls = [];
    const filePaths = [];

    for (const f of fileList) {
      const mediaUrl = `/uploads/training/${f.filename}`;
      mediaUrls.push(mediaUrl);
      filePaths.push(f.path);
      await q(
        `INSERT INTO upload_file_owners (filename, tenant_id, uploaded_by) VALUES ($1,$2,$3)
           ON CONFLICT (filename) DO NOTHING`,
        [f.filename, tenantId || 'default', username || null]
      ).catch((e) => log.warn?.('[training] recordUploadOwnership failed:', e?.message));
    }

    const hasVideo = fileList.some((f) => resolvePracticeMediaType(pathModule.extname(f.originalname || '').toLowerCase()) === 'video');
    const mediaType = hasVideo ? 'video' : 'image';
    if (mediaType === 'image' && fileList.length < 3) {
      return { success: false, error: '实操认证图片请至少上传 3 张（不同步骤或角度）' };
    }
    if (mediaType === 'video' && fileList.length > 1) {
      // 视频只取第一个，避免混传干扰评分
      fileList.splice(1);
      mediaUrls.splice(1);
      filePaths.splice(1);
    }

    const mediaUrl = mediaUrls[0];
    const filePath = filePaths[0];
    const baseUrl = serverBaseUrl || process.env.SERVER_BASE_URL || 'https://nnyx.cc';

    let aiVerdict = 'review';
    let aiFeedback = '';
    let aiRawResponse = null;
    let aiStepScores = null;
    let aiTotalScore = null;

    if (rubric && Array.isArray(rubric.items) && rubric.items.length) {
      const scored = await scorePracticeMediaWithRubric({
        rubric,
        topicTitle,
        mediaType,
        filePath,
        filePaths,
        mediaUrl,
        uploadsDir,
        pathModule,
        fsModule,
        execFileSync,
        callVisionLLM,
        callVisionLLMVideo,
        parseScoringJson,
        randomUUID,
        serverBaseUrl: baseUrl,
        log,
      });
      aiVerdict = scored.aiVerdict;
      aiFeedback = scored.aiFeedback;
      aiRawResponse = scored.aiRawResponse;
      aiStepScores = scored.aiStepScores;
      aiTotalScore = scored.aiTotalScore;
    } else {
      const scored = await scorePracticeMediaWithoutRubric({
        session,
        mediaType,
        filePath,
        filePaths,
        uploadsDir,
        pathModule,
        fsModule,
        execFileSync,
        callVisionLLM,
        randomUUID,
      });
      aiVerdict = scored.aiVerdict;
      aiFeedback = scored.aiFeedback;
      aiRawResponse = scored.aiRawResponse;
      aiStepScores = scored.aiStepScores;
      aiTotalScore = scored.aiTotalScore;
    }

    const certTenantId = String(tenantId || 'default').trim() || 'default';
    let certResult;
    try {
      certResult = await q(
        `INSERT INTO training_certifications (session_id, employee_username, topic_id, media_url, media_type, media_urls, ai_verdict, ai_feedback, ai_raw_response, ai_step_scores, ai_total_score, review_status, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, 'pending', $12)
           RETURNING *`,
        [sessionId, username, session.topic_id, mediaUrl, mediaType, JSON.stringify(mediaUrls), aiVerdict, aiFeedback || '', aiRawResponse, JSON.stringify(aiStepScores), aiTotalScore, certTenantId]
      );
    } catch (e) {
      // 兼容尚未跑 migration 155 的库
      if (!/media_urls|column/i.test(String(e?.message || ''))) throw e;
      certResult = await q(
        `INSERT INTO training_certifications (session_id, employee_username, topic_id, media_url, media_type, ai_verdict, ai_feedback, ai_raw_response, ai_step_scores, ai_total_score, review_status, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
           RETURNING *`,
        [sessionId, username, session.topic_id, mediaUrl, mediaType, aiVerdict, aiFeedback || '', aiRawResponse, JSON.stringify(aiStepScores), aiTotalScore, certTenantId]
      );
    }

    const cert = certResult.rows[0];
    try {
      await notifyCertificationReviewersPending({
        pool: { query: q },
        employeeUsername: username,
        topicId: session.topic_id,
        topicTitle: session.title,
        tenantId: certTenantId,
        certificationId: cert.id,
      });
    } catch (notifyErr) {
      log.warn?.({ msg: 'training_practice_review_notify_failed', err: notifyErr?.message });
    }

    return {
      success: true,
      certification: cert,
      verdict: aiVerdict,
      feedback: aiFeedback,
      step_scores: aiStepScores,
      total_score: aiTotalScore,
      has_rubric: !!rubric,
      media_urls: mediaUrls,
    };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}
