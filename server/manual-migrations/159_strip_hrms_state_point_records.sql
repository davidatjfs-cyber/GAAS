-- Tier 1: pointRecords — point_records 表为权威
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'pointRecords',
       updated_at = NOW()
 WHERE data ? 'pointRecords';
