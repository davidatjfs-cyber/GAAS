/**
 * Training rubric / knowledge analyze / score-detail / kb-search routes.
 */
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { callVisionLLM, callVisionLLMVideo } from '../../agents.js';
import {
  pool,
  isManager,
  uploadsDir,
  serverDir,
  resolveTenantIdDefault,
} from './shared.js';

export function registerTrainingRubricRoutes(app, authMiddleware, _uploadMiddleware) {
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
          const localVideoPath = path.join(serverDir, '..', fileField);
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
        const fileAbsPath = path.join(serverDir, '..', fileField);
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
}
