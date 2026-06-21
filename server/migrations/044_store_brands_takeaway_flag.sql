-- 给 store_brands 加 has_takeaway 列，收编 bi-weekly-report.js 里硬编码的
-- STORE_NO_TAKEAWAY = new Set(['洪潮大宁久光店']) —— 洪潮大宁久光店仅堂食无外卖业务，
-- 其余门店默认有外卖。新品牌/新店接入时按实际业务模式插入即可，不用改代码。

ALTER TABLE store_brands ADD COLUMN IF NOT EXISTS has_takeaway BOOLEAN NOT NULL DEFAULT true;

UPDATE store_brands SET has_takeaway = false WHERE store_name = '洪潮大宁久光店';
