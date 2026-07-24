/**
 * Training session pure/service logic.
 * Injectable query for tests; defaults to shared pool from routes.
 */
import path from 'path';
import fs from 'fs';
import { pool } from './shared.js';

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
