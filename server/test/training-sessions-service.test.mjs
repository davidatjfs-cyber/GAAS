import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuizGrade,
  gradeAndSubmitQuiz,
  listMyTrainingTopics,
  getOrCreateTopicSession,
  chatTrainingSession,
  startTrainingQuiz,
} from '../domains/training/service-sessions.js';

function makeQuestions(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    q: `Q${i + 1}`,
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
    explanation: `E${i + 1}`,
  }));
}

test('computeQuizGrade: all correct → 100, passed, nextStatus practice if requirePractice', () => {
  const questions = makeQuestions(10);
  const answers = questions.map((q) => q.answer);
  const grade = computeQuizGrade(questions, answers, true);
  assert.equal(grade.correctCount, 10);
  assert.equal(grade.score, 100);
  assert.equal(grade.passed, true);
  assert.equal(grade.nextStatus, 'practice');
  assert.equal(grade.results.length, 10);
});

test('computeQuizGrade: 90% threshold (9/10) → passed', () => {
  const questions = makeQuestions(10);
  const answers = questions.map((q) => q.answer);
  answers[0] = 1;
  const grade = computeQuizGrade(questions, answers, true);
  assert.equal(grade.correctCount, 9);
  assert.equal(grade.score, 90);
  assert.equal(grade.passed, true);
  assert.equal(grade.nextStatus, 'practice');
});

test('computeQuizGrade: below 90 → not passed, nextStatus quiz', () => {
  const questions = makeQuestions(10);
  const answers = questions.map((q) => q.answer);
  answers[0] = 1;
  answers[1] = 1;
  const grade = computeQuizGrade(questions, answers, true);
  assert.equal(grade.correctCount, 8);
  assert.equal(grade.score, 80);
  assert.equal(grade.passed, false);
  assert.equal(grade.nextStatus, 'quiz');
});

test('computeQuizGrade: passed + requirePractice false → certified', () => {
  const questions = makeQuestions(10);
  const answers = questions.map((q) => q.answer);
  const grade = computeQuizGrade(questions, answers, false);
  assert.equal(grade.score, 100);
  assert.equal(grade.passed, true);
  assert.equal(grade.nextStatus, 'certified');
});

test('gradeAndSubmitQuiz: session not found', async () => {
  const result = await gradeAndSubmitQuiz({
    username: 'emp1',
    sessionId: 'sess-missing',
    answers: [0],
    query: async () => ({ rows: [] }),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '会话不存在');
});

test('gradeAndSubmitQuiz: incomplete answers', async () => {
  const result = await gradeAndSubmitQuiz({
    username: 'emp1',
    sessionId: 'sess-1',
    answers: [],
    query: async () => ({ rows: [] }),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '请提交完整答案');
});

test('listMyTrainingTopics: no username → 未登录', async () => {
  const result = await listMyTrainingTopics({ username: '', query: async () => ({ rows: [] }) });
  assert.equal(result.success, false);
  assert.equal(result.error, '未登录');
  assert.equal(result.status, 401);
});

test('listMyTrainingTopics: mock query returns rows → topics', async () => {
  const mockRows = [{ topic_id: 't1', title: '测试主题' }];
  const result = await listMyTrainingTopics({
    username: 'emp1',
    query: async (sql, params) => {
      assert.match(sql, /training_assignments/);
      assert.deepEqual(params, ['emp1']);
      return { rows: mockRows };
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.topics, mockRows);
});

test('getOrCreateTopicSession: topic missing → error', async () => {
  const result = await getOrCreateTopicSession({
    username: 'emp1',
    topicId: 'missing-topic',
    query: async (sql) => {
      if (sql.includes('training_topics')) return { rows: [] };
      return { rows: [] };
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '知识点不存在');
});

const mockSessionRow = {
  id: 'sess-1',
  title: '烧鹅制作',
  position: '后厨',
  description: 'desc',
  key_points: ['出成率', '火候'],
  kb_article_ids: ['kb-1'],
  chat_history: [],
  quiz_questions: [],
  status: 'learning',
};

function makeSessionQuery(sessionRow = mockSessionRow) {
  return async (sql) => {
    if (sql.includes('FROM training_sessions s') && sql.includes('JOIN training_topics')) {
      return { rows: sessionRow ? [sessionRow] : [] };
    }
    if (sql.includes('UPDATE training_sessions SET chat_history')) {
      return { rows: [] };
    }
    if (sql.includes('UPDATE training_sessions SET quiz_questions')) {
      return { rows: [] };
    }
    if (sql.includes('FROM knowledge_base')) {
      return {
        rows: [{ title: 'KB文章', content: '内容', ai_explanation: '解析', step_rubric: null }],
      };
    }
    return { rows: [] };
  };
}

test('chatTrainingSession: empty message', async () => {
  const result = await chatTrainingSession({
    sessionId: 'sess-1',
    username: 'emp1',
    message: '   ',
    callLLM: async () => ({ content: 'x' }),
    buildKbArticleText: (r) => r.content,
    query: makeSessionQuery(),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '消息不能为空');
});

test('chatTrainingSession: session not found', async () => {
  const result = await chatTrainingSession({
    sessionId: 'sess-missing',
    username: 'emp1',
    message: '你好',
    callLLM: async () => ({ content: 'x' }),
    buildKbArticleText: (r) => r.content,
    query: makeSessionQuery(null),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '会话不存在');
});

test('chatTrainingSession: success persists chat_history', async () => {
  let updateCalled = false;
  let updatePayload = null;
  const query = async (sql, params) => {
    if (sql.includes('FROM training_sessions s') && sql.includes('JOIN training_topics')) {
      return { rows: [{ ...mockSessionRow, chat_history: [] }] };
    }
    if (sql.includes('UPDATE training_sessions SET chat_history')) {
      updateCalled = true;
      updatePayload = params;
      return { rows: [] };
    }
    if (sql.includes('FROM knowledge_base')) {
      return { rows: [{ title: 'KB', content: 'c', ai_explanation: 'e', step_rubric: null }] };
    }
    return { rows: [] };
  };

  const result = await chatTrainingSession({
    sessionId: 'sess-1',
    username: 'emp1',
    message: '什么是出成率？',
    callLLM: async () => ({ content: '出成率是成品重量占比。' }),
    buildKbArticleText: (r) => r.content,
    query,
  });

  assert.equal(result.success, true);
  assert.equal(result.reply, '出成率是成品重量占比。');
  assert.equal(updateCalled, true);
  const saved = JSON.parse(updatePayload[0]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].role, 'user');
  assert.equal(saved[0].content, '什么是出成率？');
  assert.equal(saved[1].role, 'assistant');
  assert.equal(saved[1].content, '出成率是成品重量占比。');
  assert.deepEqual(result.chat_history, saved);
});

test('startTrainingQuiz: certified blocked', async () => {
  const result = await startTrainingQuiz({
    sessionId: 'sess-1',
    username: 'emp1',
    generateQuizQuestionsForSession: async () => ({ questions: [] }),
    shuffleQuizOptions: (q) => q,
    buildKbArticleText: (r) => r.content,
    query: makeSessionQuery({ ...mockSessionRow, status: 'certified' }),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '已完成认证，无需重复测试');
});

test('startTrainingQuiz: too few questions', async () => {
  const result = await startTrainingQuiz({
    sessionId: 'sess-1',
    username: 'emp1',
    generateQuizQuestionsForSession: async () => ({ questions: [{ q: 'Q1', options: ['A'], answer: 0 }] }),
    shuffleQuizOptions: (q) => q,
    buildKbArticleText: (r) => r.content,
    query: makeSessionQuery(),
    log: { error: () => {} },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '题目数量不足，请重试');
});

test('startTrainingQuiz: success without answer field, shuffle applied', async () => {
  let shuffleCount = 0;
  let updateCalled = false;
  let storedQuestions = null;

  const generated = Array.from({ length: 5 }, (_, i) => ({
    q: `题目${i + 1}`,
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
    explanation: `解释${i + 1}`,
  }));

  const query = async (sql, params) => {
    if (sql.includes('FROM training_sessions s') && sql.includes('JOIN training_topics')) {
      return { rows: [{ ...mockSessionRow, quiz_questions: [{ q: '旧题1' }] }] };
    }
    if (sql.includes('UPDATE training_sessions SET quiz_questions')) {
      updateCalled = true;
      storedQuestions = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (sql.includes('FROM knowledge_base')) {
      return { rows: [{ title: 'KB', content: 'c', ai_explanation: 'e', step_rubric: null }] };
    }
    return { rows: [] };
  };

  let genArgs = null;
  const result = await startTrainingQuiz({
    sessionId: 'sess-1',
    username: 'emp1',
    generateQuizQuestionsForSession: async (args) => {
      genArgs = args;
      return { questions: generated, source: 'ai' };
    },
    shuffleQuizOptions: (q) => {
      shuffleCount += 1;
      return { ...q, options: [...q.options].reverse() };
    },
    buildKbArticleText: (r) => `text:${r.title}`,
    query,
    log: { warn: () => {} },
  });

  assert.equal(result.success, true);
  assert.equal(result.questions.length, 5);
  for (const q of result.questions) {
    assert.equal('answer' in q, false);
    assert.equal('explanation' in q, false);
    assert.ok(Array.isArray(q.options));
  }
  assert.equal(shuffleCount, 5);
  assert.equal(updateCalled, true);
  assert.equal(storedQuestions.length, 5);
  assert.equal(storedQuestions[0].answer, 0);
  assert.match(genArgs.prevQuestionsSection, /旧题1/);
  assert.match(genArgs.kbQuizContext, /KB/);
});
