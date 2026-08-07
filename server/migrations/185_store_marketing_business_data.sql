-- 门店营销画像/约束业务数据（2026-08-07 业务方提供）
-- 马己仙：拉新优先、充值/短信有效、不投小红书/大众点评费用、烧鹅不打折
-- 洪潮：拉升中午、复购优先、点评套餐/霸王餐/小红书品宣有效、禁低价引流/短信/海鲜打折
-- 不用 ON CONFLICT：各环境唯一约束形态不一致（channel_key 或 channel_key+tenant_id 曾踩坑），
-- 统一用「先 UPDATE，再 WHERE NOT EXISTS INSERT」，与约束无关且天然幂等。

UPDATE store_marketing_profiles SET
  brand = '马己仙',
  avg_ticket_fen = 9500,
  primary_audience = '平日中午上班族(2人/3-4人为主)、晚上周边家庭客与逛商场客人(2人为主)、周末家庭客与逛商场(2-3人为主)',
  signature_dishes = '["荔枝木脆皮烧鹅"]'::jsonb,
  peak_hours = '["12:00-13:00","18:00-19:30"]'::jsonb,
  gross_margin_floor = NULL,
  suitable_offers = '["3-4人套餐","会员卡充值","短信推广"]'::jsonb,
  unsuitable_offers = '["小红书付费投放","大众点评付费投放","烧鹅打折"]'::jsonb,
  best_campaigns = '["充值梯级活动(充300送45/500送100/1000送300/2000送800)","短信推广活动"]'::jsonb,
  worst_campaigns = '["抖音58代100低价代金券"]'::jsonb,
  execution_level = 'store_ops',
  notes = '平日中午占65%/晚上35%，外卖占比40%+（订单口径）；周末中午50%/晚上50%；平日折前约2万、周末约2.5万；老客占60%+；商圈新客少，拉新是首要工作',
  updated_at = NOW()
WHERE store_id = '51866138';

INSERT INTO store_marketing_profiles (
  store_id, brand, avg_ticket_fen, primary_audience, signature_dishes, peak_hours,
  gross_margin_floor, suitable_offers, unsuitable_offers, best_campaigns, worst_campaigns,
  execution_level, notes, tenant_id
) SELECT '51866138', '马己仙', 9500,
  '平日中午上班族(2人/3-4人为主)、晚上周边家庭客与逛商场客人(2人为主)、周末家庭客与逛商场(2-3人为主)',
  '["荔枝木脆皮烧鹅"]'::jsonb, '["12:00-13:00","18:00-19:30"]'::jsonb, NULL,
  '["3-4人套餐","会员卡充值","短信推广"]'::jsonb,
  '["小红书付费投放","大众点评付费投放","烧鹅打折"]'::jsonb,
  '["充值梯级活动(充300送45/500送100/1000送300/2000送800)","短信推广活动"]'::jsonb,
  '["抖音58代100低价代金券"]'::jsonb, 'store_ops',
  '平日中午占65%/晚上35%，外卖占比40%+（订单口径）；周末中午50%/晚上50%；平日折前约2万、周末约2.5万；老客占60%+；商圈新客少，拉新是首要工作',
  'default'
WHERE NOT EXISTS (SELECT 1 FROM store_marketing_profiles WHERE store_id = '51866138');

UPDATE store_marketing_profiles SET
  brand = '洪潮',
  avg_ticket_fen = 13500,
  primary_audience = '平日中午上班族+逛商场客人(2人为主)、晚上家庭客与情侣(2人+3-4人为主)、周末家庭客',
  signature_dishes = '["潮州虾生","黑金叉烧"]'::jsonb,
  peak_hours = '["12:00-13:00","18:00-19:30"]'::jsonb,
  gross_margin_floor = NULL,
  suitable_offers = '["大众点评套餐","大众点评霸王餐","小红书品宣","储值活动","新品推广"]'::jsonb,
  unsuitable_offers = '["抖音低价代金券","直接折扣","短信营销","海鲜类打折"]'::jsonb,
  best_campaigns = '["大众点评套餐/霸王餐","小红书品宣"]'::jsonb,
  worst_campaigns = '["抖音58代100限量代金券(3天1万张核销极低)","短信营销"]'::jsonb,
  execution_level = 'store_ops',
  notes = '中午生意差需集中拉升；晚上与周末好（周末约平日2-2.5倍，商场周末新客多）；外卖占20-25%；新客留存率低，复购是主要工作而非拉新',
  updated_at = NOW()
WHERE store_id = '64822111';

INSERT INTO store_marketing_profiles (
  store_id, brand, avg_ticket_fen, primary_audience, signature_dishes, peak_hours,
  gross_margin_floor, suitable_offers, unsuitable_offers, best_campaigns, worst_campaigns,
  execution_level, notes, tenant_id
) SELECT '64822111', '洪潮', 13500,
  '平日中午上班族+逛商场客人(2人为主)、晚上家庭客与情侣(2人+3-4人为主)、周末家庭客',
  '["潮州虾生","黑金叉烧"]'::jsonb, '["12:00-13:00","18:00-19:30"]'::jsonb, NULL,
  '["大众点评套餐","大众点评霸王餐","小红书品宣","储值活动","新品推广"]'::jsonb,
  '["抖音低价代金券","直接折扣","短信营销","海鲜类打折"]'::jsonb,
  '["大众点评套餐/霸王餐","小红书品宣"]'::jsonb,
  '["抖音58代100限量代金券(3天1万张核销极低)","短信营销"]'::jsonb, 'store_ops',
  '中午生意差需集中拉升；晚上与周末好（周末约平日2-2.5倍，商场周末新客多）；外卖占20-25%；新客留存率低，复购是主要工作而非拉新',
  'default'
WHERE NOT EXISTS (SELECT 1 FROM store_marketing_profiles WHERE store_id = '64822111');

UPDATE store_marketing_constraints SET
  brand = '马己仙', min_discount_rate = 0.7, max_coupon_value_fen = 10000, monthly_budget_fen = 1000000,
  max_touch_per_72h = 2, cooldown_hours_after_payment = 48,
  allowed_channels = '["wecom","sms","dianping"]'::jsonb,
  disallowed_campaign_types = '["小红书付费投放","大众点评付费投放","大折扣引流","抖音低价代金券"]'::jsonb,
  disallowed_dishes = '["烧鹅"]'::jsonb,
  preferred_channels = '["sms","wecom"]'::jsonb,
  brand_voice_style = '实惠实在、让利老客',
  execution_notes = '充值活动最有效（充300送45/500送100/1000送300/2000送800，每年2-3次）；短信核销不错；拉新是首要工作；平日中午占65%；抖音58代100做过但折扣大无意义',
  active = TRUE, updated_at = NOW()
WHERE store_id = '51866138' AND tenant_id = 'default';

INSERT INTO store_marketing_constraints (
  store_id, brand, min_discount_rate, max_coupon_value_fen, monthly_budget_fen,
  max_touch_per_72h, cooldown_hours_after_payment, allowed_channels,
  disallowed_campaign_types, disallowed_dishes, preferred_channels,
  brand_voice_style, execution_notes, active, tenant_id
) SELECT '51866138', '马己仙', 0.7, 10000, 1000000, 2, 48,
  '["wecom","sms","dianping"]'::jsonb,
  '["小红书付费投放","大众点评付费投放","大折扣引流","抖音低价代金券"]'::jsonb,
  '["烧鹅"]'::jsonb, '["sms","wecom"]'::jsonb,
  '实惠实在、让利老客',
  '充值活动最有效（充300送45/500送100/1000送300/2000送800，每年2-3次）；短信核销不错；拉新是首要工作；平日中午占65%；抖音58代100做过但折扣大无意义',
  TRUE, 'default'
WHERE NOT EXISTS (SELECT 1 FROM store_marketing_constraints WHERE store_id = '51866138' AND tenant_id = 'default');

UPDATE store_marketing_constraints SET
  brand = '洪潮', min_discount_rate = 0.7, max_coupon_value_fen = 10000, monthly_budget_fen = 2000000,
  max_touch_per_72h = 1, cooldown_hours_after_payment = 48,
  allowed_channels = '["wecom","dianping","xiaohongshu","douyin"]'::jsonb,
  disallowed_campaign_types = '["低价代金券","直接折扣","短信营销"]'::jsonb,
  disallowed_dishes = '["海鲜"]'::jsonb,
  preferred_channels = '["dianping","xiaohongshu"]'::jsonb,
  brand_voice_style = '品宣质感、品质优先',
  execution_notes = '点评套餐/霸王餐与小红书品宣有效；不做低价引流；短信效果非常差禁用；方向=储值/品宣/新品；中午需拉升；代金券79代100',
  active = TRUE, updated_at = NOW()
WHERE store_id = '64822111' AND tenant_id = 'default';

INSERT INTO store_marketing_constraints (
  store_id, brand, min_discount_rate, max_coupon_value_fen, monthly_budget_fen,
  max_touch_per_72h, cooldown_hours_after_payment, allowed_channels,
  disallowed_campaign_types, disallowed_dishes, preferred_channels,
  brand_voice_style, execution_notes, active, tenant_id
) SELECT '64822111', '洪潮', 0.7, 10000, 2000000, 1, 48,
  '["wecom","dianping","xiaohongshu","douyin"]'::jsonb,
  '["低价代金券","直接折扣","短信营销"]'::jsonb,
  '["海鲜"]'::jsonb, '["dianping","xiaohongshu"]'::jsonb,
  '品宣质感、品质优先',
  '点评套餐/霸王餐与小红书品宣有效；不做低价引流；短信效果非常差禁用；方向=储值/品宣/新品；中午需拉升；代金券79代100',
  TRUE, 'default'
WHERE NOT EXISTS (SELECT 1 FROM store_marketing_constraints WHERE store_id = '64822111' AND tenant_id = 'default');
