import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuizGrade,
  gradeAndSubmitQuiz,
  listMyTrainingTopics,
  getOrCreateTopicSession,
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
