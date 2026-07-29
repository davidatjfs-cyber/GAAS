-- Tier 0: examResults 已表权威，strip blob 镜像
-- 运行前确认 exam_results 表已有数据；仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'examResults',
       updated_at = NOW()
 WHERE data ? 'examResults';
