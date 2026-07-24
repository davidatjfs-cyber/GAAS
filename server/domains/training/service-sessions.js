/**
 * Training session pure/service logic (non-LLM endpoints).
 * Injectable query for tests; defaults to shared pool from routes.
 */
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
