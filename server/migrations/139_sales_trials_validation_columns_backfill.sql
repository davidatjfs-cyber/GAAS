-- 139: 补齐 sales_trials.validation_status/validation_report。
-- 迁移111(sales_p2_p3)在被生产标记为已执行之后又被追加编辑，加入了这两列，
-- migrate.js按文件名去重、不比对内容哈希，所以生产环境永远不会重跑111拿到这两列。
-- 用一个新迁移号显式补上，同时兼容111自身尚未跑过的环境（IF NOT EXISTS 双重保险）。
ALTER TABLE sales_trials
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_report JSONB DEFAULT '{}'::jsonb;
