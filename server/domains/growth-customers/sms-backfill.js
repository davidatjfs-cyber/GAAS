/**
 * T+7 SMS auto-backfill for growth_actions (P4 peel from growth-api.js).
 */
import { confidenceFromReach, scoreSmsBackfillOutcome } from './sms-backfill-helpers.js';

/**
 * @param {{ query: Function }} pool
 * @param {{
 *   cleanText: Function,
 *   resolveTenantIdDefault: Function,
 *   log: { warn: Function },
 * }} deps
 */
export async function autoBackfillSmsActions(pool, deps) {
  const { cleanText, resolveTenantIdDefault, log } = deps;
  const candidates = await pool.query(`
    SELECT a.action_key, a.store_id, a.payload
    FROM growth_actions a
    WHERE a.payload->>'channel' = 'sms'
      AND (a.payload->'outcome_summary') IS NULL
      AND a.updated_at <= NOW() - INTERVAL '7 days'
      AND EXISTS (
        SELECT 1 FROM growth_delivery_logs dl
        WHERE dl.action_key = a.action_key AND dl.status = 'sent'
      )
      AND NOT EXISTS (
        SELECT 1 FROM growth_learnings gl
        WHERE gl.source_type = 'ai_suggestion' AND gl.source_id = a.action_key
      )
    LIMIT 50
  `);
  let count = 0;
  for (const action of candidates.rows) {
    try {
      const { action_key, store_id, payload } = action;
      const reachR = await pool.query(
        `SELECT COUNT(*)::int AS reach, MIN(created_at) AS first_sent
         FROM growth_delivery_logs WHERE action_key=$1 AND status='sent'`,
        [action_key]
      );
      const reach = reachR.rows[0]?.reach || 0;
      const firstSent = reachR.rows[0]?.first_sent;
      if (reach === 0 || !firstSent) continue;

      const redR = await pool.query(
        `SELECT COUNT(*)::int AS redemptions, COALESCE(SUM(gr.amount_fen),0)::bigint AS revenue_fen
         FROM growth_redemptions gr
         WHERE gr.customer_id IN (
           SELECT customer_id FROM growth_delivery_logs WHERE action_key=$1 AND status='sent' AND customer_id IS NOT NULL
         )
         AND gr.store_id = $2
         AND gr.redeemed_at BETWEEN $3::timestamptz AND $3::timestamptz + INTERVAL '7 days'`,
        [action_key, store_id, firstSent]
      );
      const redemptions = redR.rows[0]?.redemptions || 0;
      const revenue_fen = Number(redR.rows[0]?.revenue_fen || 0);

      const expected = (payload.expected_kpi && typeof payload.expected_kpi === 'object') ? payload.expected_kpi : {};
      const scored = scoreSmsBackfillOutcome({ reach, redemptions, revenue_fen, expected });

      const scorePayload = {
        actual: { reach: scored.reach, redemptions: scored.redemptions, revenue_fen: scored.revenue_fen },
        actual_redemption_rate: scored.reach > 0 ? Number((scored.redemptions / scored.reach * 100).toFixed(1)) : 0,
        achievement: scored.achievement != null ? Number(scored.achievement.toFixed(2)) : null,
        effectiveness_score: scored.score,
        effectiveness: scored.effectiveness,
        scored_at: new Date().toISOString(),
        auto_backfill: true
      };
      await pool.query(
        `UPDATE growth_actions SET payload = COALESCE(payload,'{}') || $2::jsonb, updated_at=NOW() WHERE action_key=$1`,
        [action_key, JSON.stringify({ outcome_summary: scorePayload })]
      );

      const approach = cleanText(payload.ready_copy || payload.execution_action || '', 500);
      if (approach) {
        const isWin = scored.score != null && scored.score >= 70;
        const effectDesc = cleanText(
          `${scored.effectiveness}｜核销率${Number(scored.actualRate.toFixed(1))}%，实收¥${Math.round(scored.revenue_fen / 100)}，达成${scored.achievement != null ? Math.round(scored.achievement * 100) + '%' : '-'}(自动回填)`,
          255
        );
        await pool.query(
          `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified, tenant_id)
           VALUES ('ai_suggestion',$1,$2,'sms',NULL,$3,'AI建议方案有效性',$4,$5,$6,$7,$8,$9,true,$10)
           ON CONFLICT DO NOTHING`,
          [
            action_key,
            cleanText(store_id, 128),
            cleanText(payload.target_audience || '', 120) || null,
            isWin ? approach : '换其它方向（避免重复）',
            isWin ? null : approach,
            effectDesc,
            Math.min(scored.reach, 99999),
            confidenceFromReach(scored.reach),
            new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
            resolveTenantIdDefault()
          ]
        ).catch(() => {});
      }
      count++;
    } catch (e) {
      log.warn({ msg: 'sms_backfill_action_error', action_key: action.action_key, err: e?.message });
    }
  }
  return count;
}
