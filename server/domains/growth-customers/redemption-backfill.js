/**
 * Match POS orders to zero-amount redemptions (P4 peel from growth-api.js).
 */

/**
 * @param {{ query: Function }} pool
 */
export async function backfillRedemptionAmounts(pool) {
  const r = await pool.query(`
    WITH matched AS (
      SELECT DISTINCT ON (gr.id) gr.id AS redemption_id, po.amount_after_discount
      FROM growth_redemptions gr
      JOIN growth_customers gc ON gc.id = gr.customer_id
      JOIN pos_orders po ON po.store_id = gr.store_id AND po.phone = gc.phone
        AND po.order_time BETWEEN gr.redeemed_at - INTERVAL '2 hours' AND gr.redeemed_at + INTERVAL '30 minutes'
      WHERE gr.amount_fen = 0
        AND NULLIF(gc.phone, '') IS NOT NULL
        AND NULLIF(gr.store_id, '') IS NOT NULL
      ORDER BY gr.id, ABS(EXTRACT(EPOCH FROM (po.order_time - gr.redeemed_at)))
    )
    UPDATE growth_redemptions gr
    SET amount_fen = GREATEST(0, ROUND(matched.amount_after_discount * 100))
    FROM matched
    WHERE gr.id = matched.redemption_id
    RETURNING gr.id
  `);
  // 同步把对应的 coupon_redeemed 事件记录一起补齐，保持两表一致。
  await pool.query(`
    UPDATE growth_events ge
    SET amount_fen = gr.amount_fen
    FROM growth_redemptions gr
    WHERE ge.event_type = 'coupon_redeemed' AND ge.amount_fen = 0 AND gr.amount_fen > 0
      AND ge.customer_id = gr.customer_id AND ge.coupon_id = gr.coupon_id AND ge.occurred_at = gr.redeemed_at
  `).catch(() => {});
  return r.rows.length;
}
