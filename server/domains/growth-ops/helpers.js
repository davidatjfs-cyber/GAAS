export const CHINA_HOLIDAYS = {
  '2026-01-01': '元旦',
  '2026-01-28': '小年',
  '2026-02-12': '除夕',
  '2026-02-13': '春节',
  '2026-02-14': '初二',
  '2026-02-15': '初三',
  '2026-02-16': '初四',
  '2026-02-17': '初五',
  '2026-02-18': '初六',
  '2026-03-01': '元宵节',
  '2026-04-04': '清明节',
  '2026-04-05': '清明',
  '2026-04-06': '清明假期',
  '2026-05-01': '劳动节',
  '2026-05-02': '劳动节',
  '2026-05-03': '劳动节',
  '2026-06-20': '端午节',
  '2026-06-21': '端午',
  '2026-06-22': '端午假期',
  '2026-08-28': '七夕',
  '2026-09-17': '中秋节',
  '2026-09-18': '中秋',
  '2026-09-19': '中秋假期',
  '2026-10-01': '国庆节',
  '2026-10-02': '国庆',
  '2026-10-03': '国庆',
  '2026-10-04': '国庆',
  '2026-10-05': '国庆',
  '2026-10-06': '国庆',
  '2026-10-07': '国庆',
  '2026-12-25': '圣诞节',
};

export const CITY_COORDS = {
  上海: '31.23,121.47',
  北京: '39.90,116.40',
  广州: '23.13,113.26',
  深圳: '22.54,114.06',
};

export const WEATHER_CODES = {
  0: '晴',
  1: '多云',
  2: '多云',
  3: '多云',
  45: '雾',
  48: '雾',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '阵雨',
  82: '阵雨',
  95: '雷阵雨',
};

export function seasonFromMonth(month) {
  if (month >= 3 && month <= 5) return '春季';
  if (month >= 6 && month <= 8) return '夏季';
  if (month >= 9 && month <= 11) return '秋季';
  return '冬季';
}

/** Build marketing tips from weather/holiday context. */
export function buildWeatherTips({ holiday, isWeekend, condition, temperature, season }) {
  const tips = [];
  if (holiday) tips.push(`今天是${holiday}`);
  if (isWeekend) tips.push('周末');
  if (condition === '雨' || condition?.includes('雨')) tips.push('雨天，适合推送温暖主题');
  if (condition === '雪' || condition?.includes('雪')) tips.push('雪天，适合推送火锅/热饮');
  if (temperature && parseInt(temperature) > 30) tips.push('高温，适合推送冰饮/凉菜');
  if (temperature && parseInt(temperature) < 5) tips.push('寒冷，适合推送热汤/暖锅');
  tips.push(`${season}主题${isWeekend ? '·周末' : '·工作日'}${holiday ? '·' + holiday : ''}`);
  return tips;
}

/** Assemble active-window JSON from the four query result sets. */
export function assembleActiveWindow({ timePatterns, profileSegments, repurchaseRisk, valueTierSeg }) {
  const vipRow = valueTierSeg.find((r) => r.value_tier === 'vip') || { cnt: 0, dormant_cnt: 0 };
  const engagedTotal = valueTierSeg.reduce((s, r) => s + Number(r.cnt || 0), 0);
  const lostTotal = profileSegments
    .filter((r) => ['dormant', 'churned'].includes(r.lifecycle_stage))
    .reduce((s, r) => s + Number(r.cnt || 0), 0);
  const churnRatePct = engagedTotal ? Math.round((lostTotal / engagedTotal) * 1000) / 10 : 0;
  const topPattern = timePatterns[0];
  const prediction = topPattern
    ? `${topPattern.day_type} ${topPattern.time_segment}（基于${topPattern.event_count}次历史事件，其中成交${topPattern.conversion_count}次）`
    : '数据不足';
  return {
    ok: true,
    predicted_window: prediction,
    time_patterns: timePatterns.slice(0, 5),
    segments: profileSegments,
    profile_segments: profileSegments,
    value_tier_segments: valueTierSeg,
    churn_rate: churnRatePct,
    repurchase_risk: repurchaseRisk,
    recommendations: [
      prediction !== '数据不足' ? `📅 预测最佳触达: ${prediction}` : '',
      repurchaseRisk.length
        ? `⏰ ${repurchaseRisk[0].at_risk_count || 0}位客户处于临界/沉睡/流失，建议尽快触达`
        : '',
      Number(vipRow.dormant_cnt) > 0
        ? `👑 ${vipRow.dormant_cnt}位VIP高价值客已沉睡，优先用招牌菜/专属券召回（勿用小券）`
        : '',
      Number(vipRow.cnt) > 0
        ? `💎 当前VIP客群${vipRow.cnt}人，建议走专属感运营（新品预告/留位），避免打折掉价`
        : '',
      churnRatePct > 0
        ? `📉 客户流失率 ${churnRatePct}%（沉睡+流失占曾消费客户比例）`
        : '',
      ...profileSegments
        .filter((r) => r.cnt > 0)
        .map(
          (r) =>
            `📊 ${r.lifecycle_stage}客群(${r.cnt}人) 最佳触达:${r.top_window || '未设定'} 价格敏感度:${r.avg_price_sens || 'N/A'} 折扣响应:${r.avg_discount_resp || 'N/A'}`
        ),
    ].filter(Boolean),
  };
}
