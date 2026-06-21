-- 给 store_brands 加打卡班次窗口列，收编 index.js 里硬编码的
-- hrmsAttendanceWindowMinutesForStore：洪潮大宁久光店 9:15-21:00，其余门店默认 9:00-22:00。
-- 新店接入按实际班次插入即可，不用改代码。

ALTER TABLE store_brands ADD COLUMN IF NOT EXISTS punch_start_minutes INT NOT NULL DEFAULT 540;  -- 9:00
ALTER TABLE store_brands ADD COLUMN IF NOT EXISTS punch_end_minutes INT NOT NULL DEFAULT 1320;    -- 22:00

UPDATE store_brands SET punch_start_minutes = 555, punch_end_minutes = 1260  -- 9:15, 21:00
WHERE store_name = '洪潮大宁久光店';
