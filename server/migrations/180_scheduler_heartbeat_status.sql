-- 2026-08-05 定时任务可观测性：心跳表从"只记录跑过"升级为"记录跑得怎么样"。
--
-- 现状问题：scheduler_heartbeat 只有 last_beat/run_count，只能回答"最近有没有跳"，
-- 无法区分三种状态里的后两种——(1) 正常 (2) 该跑没跑 (3) 跑了但每次都失败。
-- (3) 是最隐蔽的：任务准时触发、心跳照跳，但内部逻辑每次抛异常，业务产出为零，
-- 从心跳角度看却完全健康。加下面四列后，beatHeartbeat 可以把执行结果一并写回，
-- 监控与面板才能把 (3) 报出来。
--
-- last_success_at 与 last_beat 分开记：last_beat 是"最近一次跑完"，
-- last_success_at 是"最近一次跑成功"，两者拉开距离即为持续失败。
ALTER TABLE scheduler_heartbeat
  ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS last_error      TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms     INTEGER,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

-- 存量行没有成功时间戳，用 last_beat 兜底：它们此前只在成功路径上打过心跳，
-- 语义上等价于"最近一次成功"，不这样回填会让所有存量任务上线即被判为持续失败。
UPDATE scheduler_heartbeat
   SET last_success_at = last_beat
 WHERE last_success_at IS NULL;
