/**
 * Training employee session routes: my-topics, session, kb-file, explanation, chat, quiz, practice.
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { callLLM, callVisionLLM, callVisionLLMVideo } from '../../agents.js';
import {
  pool,
  isManager,
  uploadsDir,
  serverDir,
  buildKbArticleText,
  generateQuizQuestionsForSession,
  shuffleQuizOptions,
  parseScoringJson,
} from './shared.js';
import {
  listMyTrainingTopics,
  getOrCreateTopicSession,
  gradeAndSubmitQuiz,
  chatTrainingSession,
  startTrainingQuiz,
  resolveTrainingKbFilePath,
  getKbArticleExplanation,
  uploadPracticeMedia,
} from './service-sessions.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'routes-sessions' });


export function registerTrainingSessionsRoutes(app, authMiddleware, uploadMiddleware) {
  // GET /api/training/my-topics - 我的培训任务
  app.get('/api/training/my-topics', authMiddleware, async (req, res) => {
    const result = await listMyTrainingTopics({ username: req.user?.username });
    if (result.status === 401) {
      return res.status(401).json({ error: result.error });
    }
    res.json(result);
  });

  // GET /api/training/topics/:id/session - 获取或创建 session（含 KB 文章内容）
  app.get('/api/training/topics/:id/session', authMiddleware, async (req, res) => {
    const result = await getOrCreateTopicSession({
      username: req.user?.username,
      topicId: req.params.id,
    });
    res.json(result);
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

      const resolved = resolveTrainingKbFilePath({ filePath: row.file_path, serverDir });
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

      const ft = String(row.file_type || '').toLowerCase();
      const ctMap = { pdf: 'application/pdf', video: 'video/mp4', img: 'image/jpeg', image: 'image/jpeg' };
      if (ctMap[ft]) res.setHeader('Content-Type', ctMap[ft]);
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(resolved.abs);
    } catch (e) {
      log.error({ msg: 'training_kb_file_failed', err: e?.message || String(e) });
      res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/training/kb/:articleId/explanation - AI智能解析（首次生成后缓存，全员共用）
  app.get('/api/training/kb/:articleId/explanation', authMiddleware, async (req, res) => {
    const articleId = String(req.params.articleId || '').trim();
    if (!articleId) return res.status(400).json({ error: 'missing_id' });
    const result = await getKbArticleExplanation({
      articleId,
      forceRegen: req.query.force === '1',
      isManagerRole: isManager(req.user?.role),
      callLLM,
    });
    if (result.httpStatus) {
      if (result.httpStatus === 500) {
        log.error({ msg: 'training_explanation_failed', err: result.error });
        return res.status(500).json({ error: result.error });
      }
      const { httpStatus, ...body } = result;
      return res.status(httpStatus).json(body);
    }
    res.json(result);
  });

  // POST /api/training/sessions/:id/chat - AI 对话
  app.post('/api/training/sessions/:id/chat', authMiddleware, async (req, res) => {
    try {
      const result = await chatTrainingSession({
        sessionId: req.params.id,
        username: req.user?.username,
        message: req.body?.message,
        callLLM,
        buildKbArticleText,
      });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'training_chat_failed', err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/start-quiz - 开始测验
  app.post('/api/training/sessions/:id/start-quiz', authMiddleware, async (req, res) => {
    try {
      const result = await startTrainingQuiz({
        sessionId: req.params.id,
        username: req.user?.username,
        generateQuizQuestionsForSession,
        shuffleQuizOptions,
        buildKbArticleText,
      });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'training_start_quiz_failed', err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/submit-quiz - 提交测验答案
  app.post('/api/training/sessions/:id/submit-quiz', authMiddleware, async (req, res) => {
    try {
      const result = await gradeAndSubmitQuiz({
        username: req.user?.username,
        sessionId: req.params.id,
        answers: req.body?.answers,
      });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'training_submit_quiz_failed', err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });

  // POST /api/training/sessions/:id/upload-practice - 上传实操视频/图片（图谱评分版）
  app.post('/api/training/sessions/:id/upload-practice', authMiddleware, uploadMiddleware.single('file'), async (req, res) => {
    try {
      const result = await uploadPracticeMedia({
        sessionId: req.params.id,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id,
        file: req.file,
        uploadsDir,
        pathModule: path,
        fsModule: fs,
        execFileSync,
        callVisionLLM,
        callVisionLLMVideo,
        parseScoringJson,
        randomUUID,
        serverBaseUrl: process.env.SERVER_BASE_URL,
      });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'training_upload_practice_failed', err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });
}
