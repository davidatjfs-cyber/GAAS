/**
 * Default growth touch-rule seeds (P4 peel from growth-api.js#ensureGrowthTables).
 */

export const DEFAULT_TOUCH_RULES = [
    {
      rule_key: 'dormant_vip_winback',
      name: '沉睡VIP老客大钩子召回',
      priority: 10,
      auto_execute: true,
      criteria: { lifecycle_stage: 'dormant', value_tier: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 5000,
        valid_days: 7,
        coupon_name: 'VIP专属回归礼',
        title_template: 'VIP老客专属回归礼遇',
        content_template: '{customer_name}，好久不见。给老朋友留了一份招牌菜，本周到店即赠，另附{coupon_value_text}专属礼券，7天内有效，期待你回来。'
      }
    },
    {
      rule_key: 'dormant_normal_winback',
      name: '沉睡普通老客召回券',
      priority: 12,
      auto_execute: true,
      criteria: { lifecycle_stage: 'dormant', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 3000,
        valid_days: 7,
        coupon_name: '老客召回券',
        title_template: '老朋友召回券',
        content_template: '{customer_name}，已有{days_since_last_visit}天没见啦，这张{coupon_value_text}召回券为你保留7天，欢迎回来尝尝 {favorite_dishes_text}。'
      }
    },
    {
      rule_key: 'new_customer_welcome',
      name: '新客72小时黄金窗口问候',
      priority: 15,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 4, max_days_since_last_visit: 7, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '新客欢迎问候',
        content_template: '{customer_name}，谢谢你的光临。不知道菜品是否合口味？下次想试试 {favorite_dishes_text}，提前说一声我们帮你留位。'
      }
    },
    {
      rule_key: 'active_vip_privilege',
      name: '活跃VIP专属感运营',
      priority: 20,
      auto_execute: true,
      criteria: { lifecycle_stage: 'active', value_tier: 'vip' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: 'VIP专属新品预告',
        content_template: '{customer_name}，本周到了一批限量时令好货，给你优先留着。想安排包厢或预留座位随时招呼。'
      }
    },
    {
      rule_key: 'at_risk_winback',
      name: '临界客温和提醒',
      priority: 30,
      auto_execute: true,
      criteria: { lifecycle_stage: 'at_risk' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '临界客推荐菜提醒',
        content_template: '{customer_name}，已经{days_since_last_visit}天没见你啦，最近上了新菜，下次来试试 {favorite_dishes_text}，需要留位提前说。'
      }
    },
    {
      rule_key: 'loyal_birthday_month',
      name: '忠诚客户生日月礼遇',
      priority: 35,
      auto_execute: true,
      criteria: { min_visit_count: 3, max_visit_interval_days: 10 },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 1800,
        valid_days: 7,
        coupon_name: '生日月礼券',
        title_template: '忠诚客户生日月礼遇',
        content_template: '{customer_name}，感谢一直以来的喜爱，生日月为你准备了一张{coupon_value_text}专享礼券，7天内到店可用。'
      }
    },
    {
      rule_key: 'lost_lowfreq_lastcall',
      name: '流失低频客一次性小券',
      priority: 40,
      auto_execute: true,
      criteria: { lifecycle_stage: 'churned' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 1200,
        valid_days: 7,
        coupon_name: '回归小券',
        title_template: '我们想念你',
        content_template: '{customer_name}，好久没见啦，这张{coupon_value_text}小券为你保留7天，欢迎回来坐坐。'
      }
    },
    {
      rule_key: 'prospect_light_touch',
      name: '潜在新客轻触达',
      priority: 50,
      auto_execute: true,
      criteria: { lifecycle_stage: 'prospect' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '潜在新客推荐菜',
        content_template: '{customer_name}，欢迎关注我们。下次到店推荐你试试 {favorite_dishes_text}，提前说一声帮你安排好。'
      }
    },
    {
      rule_key: 'seven_days_no_visit',
      name: '7天未到店关怀',
      priority: 35,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 8, max_days_since_last_visit: 20, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '7天未到店关怀',
        content_template: '{customer_name}，好久不见，已经{days_since_last_visit}天没见到你了，最近有空来坐坐？'
      }
    },
    {
      rule_key: 'bad_review_compensation',
      name: '差评补偿关怀',
      priority: 5,
      auto_execute: false,
      criteria: { manual_trigger: true },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 2000,
        valid_days: 14,
        coupon_name: '差评补偿券',
        title_template: '差评补偿关怀',
        content_template: '{customer_name}，非常抱歉上次的用餐体验未能达到您的预期，为表歉意特送上{coupon_value_text}补偿券，期待您的再次光临。'
      }
    },
    {
      rule_key: 'new_dish_launch_notify',
      name: '新品上线通知',
      priority: 45,
      auto_execute: true,
      criteria: { min_visit_count: 4, min_days_since_last_visit: 5, max_days_since_last_visit: 20 },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '新品上线通知',
        content_template: '{customer_name}，我们新菜上线啦！作为老朋友第一时间告诉你，欢迎来尝鲜～'
      }
    },
    // 长期流失客召回（90天以上）：渠道走短信(企微/订阅触达率为0)，钩子随流失时长递增；
    // 默认未审批(approved_at 为空→不自动发)，需在 HRMS 审批并备好对应短信报备模板后再启用。
    {
      rule_key: 'lost_90_winback',
      name: '流失客(3-6月)召回券',
      priority: 42,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_90', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 2000,
        valid_days: 15,
        coupon_name: '老客回归券',
        title_template: '好久不见召回',
        content_template: '{customer_name}，好久没见啦，这张{coupon_value_text}回归券为你保留15天，欢迎回来尝尝。'
      }
    },
    {
      rule_key: 'lost_180_winback',
      name: '流失客(6-12月)召回券',
      priority: 43,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_180', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 3000,
        valid_days: 15,
        coupon_name: '老客回归券',
        title_template: '想念你召回',
        content_template: '{customer_name}，很久没见到你啦，这张{coupon_value_text}回归券为你保留15天，期待你回来。'
      }
    },
    {
      rule_key: 'lost_365_winback',
      name: '流失客(1年+)唤醒大券',
      priority: 44,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_365', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 5000,
        valid_days: 15,
        coupon_name: '老客唤醒大券',
        title_template: '老朋友唤醒',
        content_template: '{customer_name}，太久没见啦，特地为你准备{coupon_value_text}唤醒大券，保留15天，欢迎回来坐坐。'
      }
    },
    {
      // 储值余额提醒：收编进自动营销当一条规则。channel='balance' → 引擎跳过逐人触达，
      // 由 enqueueAutoStoredValueReminds 触发器按门店每日冻结余额提醒任务(无券无码)。
      // 默认未审核(approved_at=null) → 治理门拦住，需在面板「审核通过 + 启用」才会自动跑。
      rule_key: 'stored_value_remind',
      name: '储值余额提醒',
      priority: 15,
      auto_execute: true,
      criteria: { dormant_days: 30, min_balance_yuan: 1 },
      action_type: 'send_message',
      action_payload: { channel: 'balance' }
    },
    {
      // 新客二次召回·21-60天：到店仅1次、首访后21-60天未回头(非VIP；VIP另走VIP维护)。
      // 现金券(value/date/code)，券面额/有效期在「自动营销」面板按效果调整(coupon_value_fen=0时不发)。
      rule_key: 'newcomer_recall_21_60',
      name: '新客二次召回·21-60天',
      priority: 28,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 21, max_days_since_last_visit: 60, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'newcomer_recall', valid_days: 14, coupon_value_fen: 0 }
    },
    {
      // 常客降温唤醒·21-60天：到店≥2次、21-60天未回头(排除VIP与"活跃"阶段，避免与VIP维护/活跃经营重叠)。
      // 赠品券(date/code，复用活跃模板)，有效期在面板调整。
      rule_key: 'regular_cooling_21_60',
      name: '常客降温唤醒·21-60天',
      priority: 29,
      auto_execute: true,
      criteria: { min_visit_count: 2, min_days_since_last_visit: 21, max_days_since_last_visit: 60, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'regular_cooling', valid_days: 14 }
    },
    {
      // VIP专属召回·61-365天：VIP客在61-365天未到店，单独走专属现金券召回(SMS_507220292/SMS_507240296)。
      // 与 dormant_vip_winback(VIP·0-60天)衔接，与沉睡/长期阶梯互斥(后者已加 value_tier_not:'vip')。
      // 现金券(value/date/code)，券面额/有效期在「自动营销」面板按效果调整(coupon_value_fen=0时不发)。
      rule_key: 'vip_winback_61_365',
      name: 'VIP专属召回·61-365天',
      priority: 26,
      auto_execute: true,
      criteria: { value_tier: 'vip', min_days_since_last_visit: 61, max_days_since_last_visit: 365 },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'vip_winback', valid_days: 14, coupon_value_fen: 0 }
    },
    {
      // 到店未买单潜客召回：扫码/陪客但从未下单(lifecycle=prospect)。先赠券(¥30/¥50/2×¥50)后赠菜，
      // 走 ABC 轮换，用现金券钩子促成首次消费。复用 ABC 6模板，无需新报备模板。
      rule_key: 'prospect_recall',
      name: '到店未买单潜客召回',
      priority: 52,
      auto_execute: true,
      criteria: { lifecycle_stage: 'prospect' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'prospect_recall', valid_days: 14 }
    }
];

/** Retired rule keys deleted on ensureGrowthTables seed. */
export const REMOVED_TOUCH_RULE_KEYS = [
  'churn_21_return_coupon',
  'churn_45_return_coupon',
  'birthday_month_touch',
  'high_frequency_upgrade',
  'high_risk_churn_voucher',
  'lost_customer_miss_you',
  'silent_new_customer_activate',
];
