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
} from './service-sessions.js';

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

      const kbUploadsDir = path.resolve(path.join(serverDir, '..', 'uploads'));
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
      const result = await gradeAndSubmitQuiz({
        username: req.user?.username,
        sessionId: req.params.id,
        answers: req.body?.answers,
      });
      res.json(result);
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
