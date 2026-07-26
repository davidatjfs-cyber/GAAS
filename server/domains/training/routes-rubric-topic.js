/**
 * Training topic rubric generate / read routes.
 */
import axios from 'axios';
import { agentsOutboundHeaders } from '../shared/agents-service-auth.js';
import { pool, isManager } from './shared.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'routes-rubric-topic' });

export function registerTrainingRubricTopicRoutes(app, authMiddleware, _uploadMiddleware) {
  app.post('/api/training/topics/:id/generate-rubric', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) return res.status(403).json({ error: '无权限' });
      const { id } = req.params;
      const topic = (await pool().query(`SELECT * FROM training_topics WHERE id = $1 AND is_active = true`, [id])).rows[0];
      if (!topic) return res.json({ success: false, error: '知识点不存在' });
      const kbIds = topic.kb_article_ids || [];
      if (!kbIds.length) return res.json({ success: false, error: '该知识点未关联任何知识库文章，无法生成图谱' });

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
          const fileField = kbArticle.file_path || '';
          const isMedia = /\.(mp4|mov|webm|avi|jpg|jpeg|png|gif|webp)$/i.test(fileField);
          if (!isMedia) {
            return res.json({ success: false, error: `关联的知识库文章（${kbArticle.title}）是${kbArticle.file_type || 'PDF'}格式，图谱分析需要视频或图片文件。请先上传包含操作视频/图片的知识库文章，或手动配置图谱。` });
          }
          try {
            const analyzeRes = await axios.post(
              `http://localhost:3000/api/knowledge/${kbArticle.id}/analyze-rubric`,
              {},
              { headers: agentsOutboundHeaders(req, { Authorization: req.headers['authorization'] || '' }) }
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
      log.error({ msg: 'training_generate_rubric_failed', request_id: req.requestId, err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });

  app.get('/api/training/topics/:id/rubric', authMiddleware, async (req, res) => {
    try {
      const topic = (await pool().query(`SELECT step_rubric FROM training_topics WHERE id = $1`, [req.params.id])).rows[0];
      if (!topic) return res.json({ success: false, error: '知识点不存在' });
      res.json({ success: true, rubric: topic.step_rubric || null });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
