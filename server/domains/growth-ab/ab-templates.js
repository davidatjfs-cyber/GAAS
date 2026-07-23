import { cleanText } from '../growth-phase-auth.js';

// scope='bound'：绑定内部可投放规则；scope='channel'：外部渠道，胜者沉淀 growth_learnings。
export const AB_TEMPLATES = [
  {
    key: 'sms', label: '短信召回', scope: 'bound', bind_kind: 'touch_rule', channel: 'sms',
    fields: [
      { key: 'sent', label: '发送量', type: 'int' },
      { key: 'delivered', label: '成功送达', type: 'int' },
      { key: 'clicks', label: '点击/回复', type: 'int' },
      { key: 'redemptions', label: '核销', type: 'int' },
      { key: 'revenue', label: '营收', type: 'money' }
    ],
    primary: { key: 'redemption_rate', label: '核销率', num: ['redemptions'], den: 'sent', format: 'pct' },
    extra: [
      { key: 'click_rate', label: '点击率', num: ['clicks'], den: 'sent', format: 'pct' },
      { key: 'revenue_per_send', label: '人均营收', num: ['revenue'], den: 'sent', format: 'money' }
    ]
  },
  {
    key: 'coupon', label: '支付发券/券活动', scope: 'bound', bind_kind: 'payment_rule', channel: 'coupon',
    fields: [
      { key: 'issued', label: '发券量', type: 'int' },
      { key: 'redemptions', label: '核销', type: 'int' },
      { key: 'reorders', label: '复购单', type: 'int' },
      { key: 'revenue', label: '营收', type: 'money' }
    ],
    primary: { key: 'redemption_rate', label: '核销率', num: ['redemptions'], den: 'issued', format: 'pct' },
    extra: [ { key: 'revenue_per_issue', label: '人均营收', num: ['revenue'], den: 'issued', format: 'money' } ]
  },
  {
    key: 'groupbuy', label: '团购套餐', scope: 'channel', channel: '团购套餐',
    fields: [
      { key: 'views', label: '浏览/曝光', type: 'int' },
      { key: 'sold', label: '售出', type: 'int' },
      { key: 'redemptions', label: '核销', type: 'int' },
      { key: 'revenue', label: '营收', type: 'money' },
      { key: 'refunds', label: '退款', type: 'int' }
    ],
    primary: { key: 'conversion_rate', label: '转化率', num: ['sold'], den: 'views', format: 'pct' },
    extra: [
      { key: 'redemption_rate', label: '核销率', num: ['redemptions'], den: 'sold', format: 'pct' },
      { key: 'aov', label: '客单价', num: ['revenue'], den: 'sold', format: 'money' }
    ]
  },
  {
    key: 'dianping', label: '大众点评', scope: 'channel', channel: '大众点评',
    fields: [
      { key: 'impressions', label: '曝光', type: 'int' },
      { key: 'visits', label: '进店浏览', type: 'int' },
      { key: 'favorites', label: '收藏', type: 'int' },
      { key: 'coupon_sold', label: '团购售出', type: 'int' },
      { key: 'redemptions', label: '到店核销', type: 'int' },
      { key: 'revenue', label: '营收', type: 'money' }
    ],
    primary: { key: 'visit_rate', label: '进店转化率', num: ['visits'], den: 'impressions', format: 'pct' },
    extra: [
      { key: 'redemption_rate', label: '核销率', num: ['redemptions'], den: 'coupon_sold', format: 'pct' },
      { key: 'aov', label: '客单价', num: ['revenue'], den: 'redemptions', format: 'money' }
    ]
  },
  {
    key: 'xiaohongshu', label: '小红书', scope: 'channel', channel: '小红书',
    fields: [
      { key: 'impressions', label: '曝光', type: 'int' },
      { key: 'reads', label: '阅读', type: 'int' },
      { key: 'likes', label: '点赞', type: 'int' },
      { key: 'favorites', label: '收藏', type: 'int' },
      { key: 'comments', label: '评论', type: 'int' },
      { key: 'follows', label: '涨粉', type: 'int' },
      { key: 'arrivals', label: '到店核销', type: 'int' }
    ],
    primary: { key: 'engagement_rate', label: '互动率', num: ['likes', 'favorites', 'comments'], den: 'impressions', format: 'pct' },
    extra: [
      { key: 'read_rate', label: '阅读率', num: ['reads'], den: 'impressions', format: 'pct' },
      { key: 'arrival_per_read', label: '到店/阅读', num: ['arrivals'], den: 'reads', format: 'pct' }
    ]
  },
  {
    key: 'kol', label: '达人探店', scope: 'channel', channel: '达人探店',
    fields: [
      { key: 'plays', label: '播放量', type: 'int' },
      { key: 'interactions', label: '互动', type: 'int' },
      { key: 'follows', label: '涨粉', type: 'int' },
      { key: 'arrivals', label: '到店核销', type: 'int' },
      { key: 'revenue', label: '营收', type: 'money' },
      { key: 'cost', label: '投放成本', type: 'money' }
    ],
    primary: { key: 'roi', label: 'ROI', num: ['revenue'], den: 'cost', format: 'x' },
    extra: [
      { key: 'arrival_rate', label: '到店率', num: ['arrivals'], den: 'plays', format: 'pct' },
      { key: 'interaction_rate', label: '互动率', num: ['interactions'], den: 'plays', format: 'pct' }
    ]
  },
  {
    key: 'custom', label: '自定义', scope: 'channel', channel: '自定义',
    fields: [], primary: null, extra: []
  }
];

export function getAbTemplate(key) {
  return AB_TEMPLATES.find((t) => t.key === cleanText(key, 40)) || null;
}
