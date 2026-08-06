-- 营销建议「审核 → 推送池」闭环（2026-08-06）
-- 1) strategy_experiments：管理员拒绝详情（原因分类+备注），供生成器去重/学习/质量暂停
-- 2) strategy_variants：结构化 plan_fields，供 GAAS 采纳时直接建推送池活动草稿，
--    不再让 GAAS 侧对自由文本二次解析
ALTER TABLE strategy_experiments
  ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_reason JSONB;

ALTER TABLE strategy_variants
  ADD COLUMN IF NOT EXISTS plan_fields JSONB;

CREATE INDEX IF NOT EXISTS idx_strategy_experiments_rejected_at
  ON strategy_experiments (rejected_at);
