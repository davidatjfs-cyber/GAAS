import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuizGrade,
  gradeAndSubmitQuiz,
  listMyTrainingTopics,
  getOrCreateTopicSession,
  chatTrainingSession,
  startTrainingQuiz,
  buildKbExplanationPrompt,
  getKbArticleExplanation,
  uploadPracticeMedia,
} from '../service-sessions.js';

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

// ─── buildKbExplanationPrompt ───

test('buildKbExplanationPrompt: SOP-like content → kind sop, prompt contains 工序', () => {
  const rawContent = '标准操作程序 SOP\n步骤1：切配\n操作动作：均匀切片\n质量标准：厚度2mm\n常见失败：切太厚\n补救：重新切';
  const { prompt, kind } = buildKbExplanationPrompt({ title: '切配SOP', rawContent, fileType: 'pdf' });
  assert.equal(kind, 'sop');
  assert.match(prompt, /工序/);
  assert.match(prompt, /切配SOP/);
});

test('buildKbExplanationPrompt: handbook title → kind handbook', () => {
  const rawContent = '第一章 前厅服务\n第二章 后厨操作\n第三章 管理规范';
  const { prompt, kind } = buildKbExplanationPrompt({
    title: '餐饮培训手册',
    rawContent,
    fileType: 'pdf',
  });
  assert.equal(kind, 'handbook');
  assert.match(prompt, /手册定位/);
});

test('buildKbExplanationPrompt: short generic → kind default', () => {
  const rawContent = '烧鹅制作要点：出成率65-70%，中火180℃烤制40分钟。';
  const { prompt, kind } = buildKbExplanationPrompt({ title: '烧鹅制作', rawContent, fileType: 'pdf' });
  assert.equal(kind, 'default');
  assert.match(prompt, /一句话总结/);
});

test('buildKbExplanationPrompt: long content truncated (>25000)', () => {
  const rawContent = 'x'.repeat(30000);
  const { prompt, kind } = buildKbExplanationPrompt({ title: '长文', rawContent, fileType: 'pdf' });
  assert.equal(kind, 'default');
  assert.match(prompt, /原文共30000字/);
  assert.match(prompt, /前25000字节选/);
});

// ─── getKbArticleExplanation ───

test('getKbArticleExplanation: forbidden when topic check empty', async () => {
  const result = await getKbArticleExplanation({
    articleId: 'kb-1',
    callLLM: async () => ({ content: 'x' }),
    query: async (sql) => {
      if (sql.includes('training_topics')) return { rows: [] };
      return { rows: [] };
    },
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.error, 'forbidden');
});

test('getKbArticleExplanation: locked returns cached locked', async () => {
  const result = await getKbArticleExplanation({
    articleId: 'kb-1',
    callLLM: async () => ({ content: 'x' }),
    query: async (sql) => {
      if (sql.includes('training_topics')) return { rows: [{ id: 't1' }] };
      if (sql.includes('knowledge_base')) {
        return {
          rows: [{
            title: 'T',
            content: 'content long enough for test',
            file_type: 'pdf',
            ai_explanation: 'locked explanation text here',
            ai_explanation_locked: true,
          }],
        };
      }
      return { rows: [] };
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.cached, true);
  assert.equal(result.locked, true);
  assert.equal(result.explanation, 'locked explanation text here');
});

test('getKbArticleExplanation: cached hit without force', async () => {
  const result = await getKbArticleExplanation({
    articleId: 'kb-1',
    forceRegen: false,
    callLLM: async () => { throw new Error('should not call LLM'); },
    query: async (sql) => {
      if (sql.includes('training_topics')) return { rows: [{ id: 't1' }] };
      if (sql.includes('knowledge_base')) {
        return {
          rows: [{
            title: 'T',
            content: 'content long enough for test',
            file_type: 'pdf',
            ai_explanation: 'a'.repeat(60),
            ai_explanation_locked: false,
          }],
        };
      }
      return { rows: [] };
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.cached, true);
  assert.equal(result.explanation, 'a'.repeat(60));
});

test('getKbArticleExplanation: no_content short text', async () => {
  const result = await getKbArticleExplanation({
    articleId: 'kb-1',
    callLLM: async () => ({ content: 'x' }),
    query: async (sql) => {
      if (sql.includes('training_topics')) return { rows: [{ id: 't1' }] };
      if (sql.includes('knowledge_base')) {
        return {
          rows: [{
            title: 'T',
            content: 'short',
            file_type: 'pdf',
            ai_explanation: null,
            ai_explanation_locked: false,
          }],
        };
      }
      return { rows: [] };
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'no_content');
});

test('getKbArticleExplanation: success generates + UPDATE ai_explanation', async () => {
  let updateCalled = false;
  let updateParams = null;
  let llmCalled = false;
  const generated = 'x'.repeat(120);

  const result = await getKbArticleExplanation({
    articleId: 'kb-1',
    callLLM: async () => {
      llmCalled = true;
      return { content: generated };
    },
    query: async (sql, params) => {
      if (sql.includes('training_topics')) return { rows: [{ id: 't1' }] };
      if (sql.includes('UPDATE knowledge_base SET ai_explanation')) {
        updateCalled = true;
        updateParams = params;
        return { rows: [] };
      }
      if (sql.includes('knowledge_base')) {
        return {
          rows: [{
            title: '烧鹅SOP',
            content: '标准操作 工序 步骤1 操作动作 质量标准 常见失败 补救措施 ' + 'y'.repeat(30),
            file_type: 'pdf',
            ai_explanation: null,
            ai_explanation_locked: false,
          }],
        };
      }
      return { rows: [] };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.cached, false);
  assert.equal(result.explanation, generated);
  assert.equal(llmCalled, true);
  assert.equal(updateCalled, true);
  assert.equal(updateParams[0], generated);
  assert.equal(updateParams[1], 'kb-1');
});

// ─── uploadPracticeMedia ───

const mockPracticeSession = {
  id: 'sess-1',
  topic_id: 'topic-1',
  quiz_passed: true,
  title: '烧鹅实操',
  practice_task: '完成烧鹅制作',
  key_points: ['出成率'],
  step_rubric: {
    dish_name: '烧鹅',
    station: '后厨',
    items: [{ action: '腌制', weight: 20, checks: ['均匀'], is_critical: true }],
    fail_criteria: ['未腌制'],
    pass_threshold: 80,
  },
};

function makeUploadQuery(sessionRow = mockPracticeSession) {
  return async (sql, params) => {
    if (sql.includes('FROM training_sessions s') && sql.includes('JOIN training_topics')) {
      return { rows: sessionRow ? [sessionRow] : [] };
    }
    if (sql.includes('INSERT INTO upload_file_owners')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO training_certifications')) {
      return {
        rows: [{
          id: 'cert-1',
          session_id: params[0],
          employee_username: params[1],
          topic_id: params[2],
          media_url: params[3],
          ai_verdict: params[5],
        }],
      };
    }
    return { rows: [] };
  };
}

const mockUploadDeps = {
  uploadsDir: '/tmp/uploads',
  pathModule: {
    extname: (name) => (name.endsWith('.jpg') ? '.jpg' : '.mp4'),
    join: (...parts) => parts.join('/'),
  },
  fsModule: {
    mkdirSync: () => {},
    readdirSync: () => [],
    readFileSync: () => Buffer.from(''),
    rmSync: () => {},
    unlinkSync: () => {},
  },
  execFileSync: () => {},
  parseScoringJson: (json) => ({
    aiVerdict: JSON.parse(json).verdict || 'passed',
    aiFeedback: JSON.parse(json).summary || 'ok',
    aiStepScores: JSON.parse(json).steps || [],
    aiTotalScore: JSON.parse(json).total_score || 88,
  }),
  randomUUID: () => 'uuid-test',
  serverBaseUrl: 'https://test.example',
};

test('uploadPracticeMedia: no file', async () => {
  const result = await uploadPracticeMedia({
    sessionId: 'sess-1',
    username: 'emp1',
    file: null,
    query: makeUploadQuery(),
    ...mockUploadDeps,
    callVisionLLM: async () => ({}),
    callVisionLLMVideo: async () => ({}),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '请上传文件');
});

test('uploadPracticeMedia: session not found', async () => {
  const result = await uploadPracticeMedia({
    sessionId: 'sess-missing',
    username: 'emp1',
    file: { path: '/tmp/f.jpg', filename: 'f.jpg', originalname: 'photo.jpg' },
    query: makeUploadQuery(null),
    ...mockUploadDeps,
    callVisionLLM: async () => ({}),
    callVisionLLMVideo: async () => ({}),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '会话不存在');
});

test('uploadPracticeMedia: quiz not passed', async () => {
  const result = await uploadPracticeMedia({
    sessionId: 'sess-1',
    username: 'emp1',
    file: { path: '/tmp/f.jpg', filename: 'f.jpg', originalname: 'photo.jpg' },
    query: makeUploadQuery({ ...mockPracticeSession, quiz_passed: false }),
    ...mockUploadDeps,
    callVisionLLM: async () => ({}),
    callVisionLLMVideo: async () => ({}),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, '请先通过测验');
});

test('uploadPracticeMedia: success image + rubric inserts certification', async () => {
  let certInsertCalled = false;
  let certParams = null;
  let visionCalled = false;

  const scoringJson = JSON.stringify({
    steps: [{ name: '腌制', score: 18, max: 20, feedback: '良好' }],
    total_score: 88,
    verdict: 'passed',
    fail_reason: null,
    summary: '操作规范',
  });

  const result = await uploadPracticeMedia({
    sessionId: 'sess-1',
    username: 'emp1',
    tenantId: 'tenant-1',
    file: { path: '/tmp/practice.jpg', filename: 'practice.jpg', originalname: 'practice.jpg' },
    query: async (sql, params) => {
      if (sql.includes('FROM training_sessions s') && sql.includes('JOIN training_topics')) {
        return { rows: [mockPracticeSession] };
      }
      if (sql.includes('INSERT INTO upload_file_owners')) return { rows: [] };
      if (sql.includes('INSERT INTO training_certifications')) {
        certInsertCalled = true;
        certParams = params;
        return { rows: [{ id: 'cert-1', ai_verdict: 'passed' }] };
      }
      return { rows: [] };
    },
    ...mockUploadDeps,
    callVisionLLM: async (filePath, prompt) => {
      visionCalled = true;
      assert.equal(filePath, '/tmp/practice.jpg');
      assert.match(prompt, /评分表/);
      return { content: scoringJson };
    },
    callVisionLLMVideo: async () => ({ ok: false }),
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, 'passed');
  assert.equal(result.has_rubric, true);
  assert.equal(visionCalled, true);
  assert.equal(certInsertCalled, true);
  assert.equal(certParams[0], 'sess-1');
  assert.equal(certParams[1], 'emp1');
  assert.equal(certParams[5], 'passed');
});
