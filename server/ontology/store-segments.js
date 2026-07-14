/**
 * 门店多维分类体系：AI诊断"跟谁比"的核心资产。
 * 设计目标：不是给今天几十家店用的，是给未来几千几万家店用的行业标准分类。
 *
 * 五个独立维度，互不耦合：
 *   business_type  一级经营模型(单选) —— 决定用哪套KPI权重
 *   business_traits 经营特征(多选)   —— 补充business_type没覆盖的横切属性
 *   cuisine        菜系(单选，描述性，不参与基准分组，只做检索/展示)
 *   scale          规模档位(单选，按座位数/营收粗分)
 *   price_band     价格带(单选，按客单价分)
 *
 * 基准库(growth_ontology_benchmarks)按 business_type + scale + price_band 分组统计；
 * business_traits/cuisine/region 是分组之外的过滤/展示维度，样本量足够时可以进一步细分。
 */

export const BUSINESS_TYPES = [
  { id: 'fine_dining', name: '高端餐厅', keywords: ['高端', '米其林', '西餐厅', 'fine dining'] },
  { id: 'banquet', name: '宴请型正餐', keywords: ['粤菜', '潮汕菜', '私房菜', '宴请', '本帮菜', '淮扬菜'] },
  { id: 'casual_dining', name: '家庭聚餐', keywords: ['家常菜', '连锁中餐', '川菜', '湘菜', '云南菜', '西北菜', '东北菜'] },
  { id: 'fast_casual', name: '快餐简餐', keywords: ['快餐简餐', '真功夫', '老乡鸡', '简餐'] },
  { id: 'qsr', name: '快速服务', keywords: ['快餐', '炸鸡', '汉堡', '麦当劳', '肯德基'] },
  { id: 'hotpot', name: '火锅', keywords: ['火锅', '海底捞'] },
  { id: 'bbq', name: '烧烤', keywords: ['烧烤', '烤肉', '串串'] },
  { id: 'buffet', name: '自助', keywords: ['自助餐', '自助'] },
  { id: 'cafe', name: '咖啡', keywords: ['咖啡', 'cafe'] },
  { id: 'tea', name: '茶饮', keywords: ['茶饮', '奶茶', '喜茶'] },
  { id: 'bakery', name: '烘焙', keywords: ['烘焙', '面包'] },
  { id: 'dessert', name: '甜品', keywords: ['甜品', '冰淇淋'] },
  { id: 'seafood', name: '海鲜专门店', keywords: ['海鲜', '海鲜酒楼'] },
  { id: 'japanese', name: '日料', keywords: ['日料', '寿司'] },
  { id: 'korean', name: '韩餐', keywords: ['韩餐', '韩料'] },
  { id: 'western', name: '西餐', keywords: ['西餐', 'bistro'] },
  { id: 'bar', name: '酒吧', keywords: ['酒吧', 'bar'] },
  { id: 'pub', name: '餐酒馆', keywords: ['餐酒馆', 'pub', '小酒馆'] },
  { id: 'delivery', name: '外卖店', keywords: ['纯外卖', '外卖店'] },
  { id: 'cloud_kitchen', name: '云厨房', keywords: ['云厨房', '外卖厨房'] },
  { id: 'mixed', name: '综合', keywords: [] }, // 兜底，永远放最后
];

export const BUSINESS_TRAITS = [
  'high_ticket', 'high_frequency', 'reservation', 'walk_in', 'private_room', 'family',
  'business', 'dating', 'tourism', 'delivery', 'nightlife', 'mall', 'community',
  'office', 'pet_friendly', 'buffet', 'all_day', 'lunch_focus', 'dinner_focus',
  'late_night', 'alcohol',
];

export const CUISINES = [
  'chaoshan', 'cantonese', 'sichuan', 'hunan', 'jiangzhe', 'beijing', 'northeast',
  'xinjiang', 'yunnan', 'guizhou', 'hotpot', 'bbq', 'western', 'italian', 'french',
  'japanese', 'korean', 'thai', 'vietnamese', 'indian', 'mexican', 'fusion', 'vegetarian',
];

// 规模档位：优先按座位数分，没有座位数据时用日均营收做代理指标(见 classifyScale)
export const SCALE_TIERS = [
  { id: 'XS', seatMin: 0, seatMax: 40, dailyRevenueMax: 3000 },
  { id: 'S', seatMin: 40, seatMax: 80, dailyRevenueMax: 8000 },
  { id: 'M', seatMin: 80, seatMax: 150, dailyRevenueMax: 20000 },
  { id: 'L', seatMin: 150, seatMax: 300, dailyRevenueMax: 50000 },
  { id: 'XL', seatMin: 300, seatMax: 600, dailyRevenueMax: 120000 },
  { id: 'XXL', seatMin: 600, seatMax: Infinity, dailyRevenueMax: Infinity },
];

// 价格带：按客单价分
export const PRICE_BANDS = [
  { id: 'budget', min: 0, max: 60 },
  { id: 'value', min: 60, max: 120 },
  { id: 'premium', min: 120, max: 250 },
  { id: 'luxury', min: 250, max: 500 },
  { id: 'ultra', min: 500, max: Infinity },
];

// KPI 权重矩阵：每个 business_type 对不同 KPI 的关注度(0-10)，用于诊断时加权算"经营健康度"，
// 而不是对所有门店一视同仁地看同一套指标。未列出的business_type用mixed的权重兜底。
export const KPI_WEIGHTS = {
  banquet: { avg_ticket_price: 10, table_turnover_rate: 4, repeat_rate_30d: 8, private_room_utilization: 10, lunch_ratio: 5, dinner_ratio: 10, beverage_ratio: 8, customer_satisfaction: 10 },
  casual_dining: { avg_ticket_price: 8, table_turnover_rate: 6, repeat_rate_30d: 10, private_room_utilization: 4, lunch_ratio: 7, dinner_ratio: 8, beverage_ratio: 4, customer_satisfaction: 9 },
  fast_casual: { avg_ticket_price: 3, table_turnover_rate: 10, repeat_rate_30d: 8, private_room_utilization: 0, lunch_ratio: 10, dinner_ratio: 5, beverage_ratio: 1, customer_satisfaction: 8 },
  qsr: { avg_ticket_price: 3, table_turnover_rate: 10, repeat_rate_30d: 8, private_room_utilization: 0, lunch_ratio: 10, dinner_ratio: 5, beverage_ratio: 1, customer_satisfaction: 8 },
  hotpot: { avg_ticket_price: 5, table_turnover_rate: 10, repeat_rate_30d: 7, private_room_utilization: 0, lunch_ratio: 6, dinner_ratio: 9, beverage_ratio: 5, customer_satisfaction: 9 },
  cafe: { avg_ticket_price: 6, table_turnover_rate: 5, repeat_rate_30d: 9, private_room_utilization: 0, lunch_ratio: 8, dinner_ratio: 6, beverage_ratio: 2, customer_satisfaction: 9 },
  delivery: { avg_ticket_price: 2, table_turnover_rate: 2, repeat_rate_30d: 8, private_room_utilization: 0, lunch_ratio: 4, dinner_ratio: 3, beverage_ratio: 0, customer_satisfaction: 7 },
  mixed: { avg_ticket_price: 6, table_turnover_rate: 6, repeat_rate_30d: 8, private_room_utilization: 3, lunch_ratio: 6, dinner_ratio: 7, beverage_ratio: 3, customer_satisfaction: 8 },
};

const BUSINESS_TYPE_BY_ID = new Map(BUSINESS_TYPES.map((s) => [s.id, s]));
const DEFAULT_BUSINESS_TYPE = 'mixed';

export function listBusinessTypes() {
  return BUSINESS_TYPES.map((s) => ({ ...s }));
}

export function getBusinessType(id) {
  return BUSINESS_TYPE_BY_ID.get(String(id || '').trim()) || null;
}

export function getKpiWeights(businessTypeId) {
  return KPI_WEIGHTS[businessTypeId] || KPI_WEIGHTS[DEFAULT_BUSINESS_TYPE];
}

/**
 * 把自由文本(business_type/cuisine原始字段)归一化成标准 business_type。
 * 命不中任何关键词时归入 mixed 兜底，而不是留空——留空的店会被踢出所有基准对比。
 */
export function classifyBusinessType(rawText = '') {
  const t = String(rawText || '').trim().toLowerCase();
  if (!t) return DEFAULT_BUSINESS_TYPE;
  for (const type of BUSINESS_TYPES) {
    if (type.keywords.some((kw) => t.includes(kw.toLowerCase()))) return type.id;
  }
  return DEFAULT_BUSINESS_TYPE;
}

/**
 * 规模档位：目前系统里没有稳定的"座位数"字段，先用日均营收做代理指标；
 * 后续如果补上座位数采集，改成优先按座位数分(见 SCALE_TIERS.seatMin/seatMax)。
 */
export function classifyScale({ seatCount, avgDailyRevenue } = {}) {
  if (Number.isFinite(seatCount) && seatCount > 0) {
    const bySeat = SCALE_TIERS.find((t) => seatCount >= t.seatMin && seatCount < t.seatMax);
    if (bySeat) return bySeat.id;
  }
  const rev = Number(avgDailyRevenue) || 0;
  const byRevenue = SCALE_TIERS.find((t) => rev < t.dailyRevenueMax);
  return (byRevenue || SCALE_TIERS[SCALE_TIERS.length - 1]).id;
}

export function classifyPriceBand(avgTicketPrice) {
  const v = Number(avgTicketPrice) || 0;
  const band = PRICE_BANDS.find((b) => v >= b.min && v < b.max);
  return (band || PRICE_BANDS[PRICE_BANDS.length - 1]).id;
}
