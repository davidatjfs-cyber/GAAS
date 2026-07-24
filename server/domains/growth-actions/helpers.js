export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export const PLATFORM_CHANNELS = [
  'wecom',
  'xiaohongshu',
  'dianping',
  'miniprogram',
  'douyin',
  'pengyouquan',
];

/** Map execution-log row + delivery aggregates → reach label. */
export function deriveReach(log) {
  if (log.decision === 'ignored') return 'ignored';
  if (Number(log.delivery_total) === 0) return 'internal_only';
  if (Number(log.delivery_delivered) > 0) return 'reached';
  if (Number(log.delivery_failed) > 0) return 'failed';
  if (Number(log.delivery_skipped) > 0) return 'skipped';
  return 'internal_only';
}

/**
 * Auto-score feedback against expected_kpi.
 * @returns {null|{actual, expected_kpi, actual_redemption_rate, achievement, effectiveness_score, effectiveness, scored_at}}
 */
export function scoreActionFeedback(b, expected = {}) {
  const hasResult =
    b.actual_reach != null || b.actual_redemptions != null || b.actual_revenue_fen != null;
  if (!hasResult) return null;

  const actual = {
    reach: b.actual_reach != null ? Math.max(0, Math.floor(Number(b.actual_reach) || 0)) : null,
    redemptions:
      b.actual_redemptions != null
        ? Math.max(0, Math.floor(Number(b.actual_redemptions) || 0))
        : null,
    revenue_fen:
      b.actual_revenue_fen != null
        ? Math.max(0, Math.floor(Number(b.actual_revenue_fen) || 0))
        : null,
  };

  const parts = [];
  if (Number(expected.reach) > 0 && actual.reach != null) {
    parts.push(Math.min(2, actual.reach / Number(expected.reach)));
  }
  const actualRate =
    actual.reach && actual.reach > 0 && actual.redemptions != null
      ? (actual.redemptions / actual.reach) * 100
      : null;
  if (Number(expected.redemption_rate) > 0 && actualRate != null) {
    parts.push(Math.min(2, actualRate / Number(expected.redemption_rate)));
  }
  if (Number(expected.revenue_fen) > 0 && actual.revenue_fen != null) {
    parts.push(Math.min(2, actual.revenue_fen / Number(expected.revenue_fen)));
  }
  const achievement = parts.length ? parts.reduce((a, c) => a + c, 0) / parts.length : null;
  const score = achievement != null ? Math.round(Math.min(100, achievement * 80)) : null;
  const effectiveness =
    score == null ? '已回填' : score >= 70 ? '有效' : score >= 40 ? '部分有效' : '无效';

  return {
    actual,
    expected_kpi: expected,
    actual_redemption_rate: actualRate != null ? Number(actualRate.toFixed(1)) : null,
    achievement: achievement != null ? Number(achievement.toFixed(2)) : null,
    effectiveness_score: score,
    effectiveness,
    scored_at: new Date().toISOString(),
  };
}
