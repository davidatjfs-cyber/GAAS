/**
 * Pure scoring helpers for T+7 SMS auto-backfill.
 */

/**
 * @param {{
 *   reach: number,
 *   redemptions: number,
 *   revenue_fen: number,
 *   expected?: object,
 * }} input
 */
export function scoreSmsBackfillOutcome(input) {
  const reach = Number(input.reach || 0);
  const redemptions = Number(input.redemptions || 0);
  const revenue_fen = Number(input.revenue_fen || 0);
  const expected = (input.expected && typeof input.expected === 'object') ? input.expected : {};

  const parts = [];
  if (Number(expected.reach) > 0) parts.push(Math.min(2, reach / Number(expected.reach)));
  const actualRate = reach > 0 ? (redemptions / reach) * 100 : 0;
  if (Number(expected.redemption_rate) > 0) parts.push(Math.min(2, actualRate / Number(expected.redemption_rate)));
  if (Number(expected.revenue_fen) > 0) parts.push(Math.min(2, revenue_fen / Number(expected.revenue_fen)));
  const achievement = parts.length ? parts.reduce((a, c) => a + c, 0) / parts.length : null;
  const score = achievement != null ? Math.round(Math.min(100, achievement * 80)) : null;
  const effectiveness = score == null ? '已回填' : score >= 70 ? '有效' : score >= 40 ? '部分有效' : '无效';

  return {
    reach,
    redemptions,
    revenue_fen,
    actualRate,
    achievement,
    score,
    effectiveness,
  };
}

export function confidenceFromReach(reach) {
  const n = Number(reach || 0);
  return n >= 100 ? 'high' : n >= 30 ? 'medium' : 'low';
}
