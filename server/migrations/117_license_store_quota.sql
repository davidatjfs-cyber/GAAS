-- 117: 门店数量配额——按店计费的关键控制点。
-- 之前 licenses 表没有门店数量上限字段，POST /api/stores 也只做了登录校验，
-- 任何登录用户都能无限建店，跟计费完全脱钩。

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS max_stores INTEGER;

COMMENT ON COLUMN licenses.max_stores IS '已购买的门店数量上限；NULL=不限制(兼容历史租户)。POST /api/stores 建店前会校验此值。';
