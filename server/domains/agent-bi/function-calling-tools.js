export const BI_FUNCTION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_sales_ranking',
      description: '查询门店菜品销售排行（可查询TOP或倒数，支持堂食/外卖，支持按销量/折前金额/实收金额排序）',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-90', minimum: 1, maximum: 90 },
          limit: { type: 'integer', description: '返回条数，建议1-20', minimum: 1, maximum: 20 },
          sort_order: { type: 'string', enum: ['desc', 'asc'], description: 'desc=TOP最高，asc=倒数最低' },
          metric: { type: 'string', enum: ['sales_amount', 'revenue', 'qty'], description: 'sales_amount=折前金额，revenue=实收金额，qty=销量' },
          biz_type: { type: 'string', enum: ['all', 'dinein', 'takeaway'], description: 'all=全部，dinein=堂食，takeaway=外卖' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_complaint_product_ranking',
      description: '查询门店被投诉/差评最多或最少的产品排行',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-90', minimum: 1, maximum: 90 },
          limit: { type: 'integer', description: '返回条数，建议1-20', minimum: 1, maximum: 20 },
          sort_order: { type: 'string', enum: ['desc', 'asc'], description: 'desc=投诉最多，asc=投诉最少' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_revenue_summary',
      description: '查询门店在指定天数内的营业额与达成率汇总',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议1-60', minimum: 1, maximum: 60 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_revenue_forecast_next_day',
      description: '预测门店下一日营业额（优先使用营业日报，缺失时回退销售明细）',
      parameters: {
        type: 'object',
        properties: {
          lookback_days: { type: 'integer', description: '回看天数，建议7-30', minimum: 3, maximum: 60 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_table_visit',
      description: '查询门店桌访记录（不满意菜品、桌巡记录等）',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-30', minimum: 1, maximum: 90 }
        }
      }
    }
  }
];

export function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  try {
    const parsed = JSON.parse(String(rawArgs));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

export function tryParseJsonObjectFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = parseToolArgs(raw);
  if (direct && Object.keys(direct).length) return direct;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const parsed = parseToolArgs(m[0]);
  return parsed && Object.keys(parsed).length ? parsed : null;
}

export function normalizeIntentPlan(rawPlan = {}) {
  const intent = String(rawPlan.intent || 'other').trim();
  const confidence = Math.max(0, Math.min(1, Number(rawPlan.confidence) || 0));
  const params = rawPlan.params && typeof rawPlan.params === 'object' ? rawPlan.params : {};
  return { intent, confidence, params };
}
