/**
 * KB analyze-rubric + edit-history routes.
 */
import path from 'path';
import fs from 'fs';
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
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'routes-rubric-analyze' });

export function registerTrainingRubricAnalyzeRoutes(app, authMiddleware, _uploadMiddleware) {
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
      ).catch((e) => log.error({ msg: 'training_edit_history_rubric_failed', err: e?.message || String(e) }));
      res.json({ success: true, rubric });
    } catch (e) {
      log.error({ msg: 'training_analyze_rubric_failed', err: e?.message || String(e) });
      res.json({ success: false, error: e?.message });
    }
  });

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
}
