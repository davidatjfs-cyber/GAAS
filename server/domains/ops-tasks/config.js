export const OPS_BRAND_STORE_MAP = {
  '洪潮大宁久光店': '洪潮传统潮汕菜',
  '马己仙上海音乐广场店': '马己仙广东小馆'
};

export const OPS_BRAND_RULES = {
  '洪潮传统潮汕菜': {
    lunchDeadline: '11:00',
    dinnerDeadline: '17:00',
    reviewDeadline: '22:30',
    tableVisitDeadline: '22:00'
  },
  '马己仙广东小馆': {
    lunchDeadline: '11:00',
    dinnerDeadline: '17:00',
    reviewDeadline: '22:30',
    tableVisitDeadline: '22:00'
  }
};

export const OPS_ROLE_ALIASES = {
  store_product_manager: 'store_production_manager'
};

export function normalizeOpsRole(input) {
  const raw = String(input || '').trim();
  return OPS_ROLE_ALIASES[raw] || raw;
}
