-- Tier 2: strip questionSets blob（167 表回填后执行）
-- questionBank 仍保留在 blob。
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'questionSets',
       updated_at = NOW()
 WHERE data ? 'questionSets';
