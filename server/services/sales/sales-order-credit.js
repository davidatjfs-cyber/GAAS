function brandKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

export async function getCreditPoolRisk(pool, poolId, { lockWhenExceeded = true } = {}) {
  const r = await pool.query(
    `SELECT p.*, COALESCE((SELECT SUM(o.amount_fen) FROM sales_orders o WHERE o.credit_pool_id=p.id AND o.status IN ('credit_approved','provisioning','provisioned')),0) AS approved_fen,
            COALESCE((SELECT SUM(op.amount_fen) FROM sales_order_payments op JOIN sales_orders o ON o.id=op.order_id WHERE o.credit_pool_id=p.id AND op.status='confirmed'),0) AS paid_fen
       FROM sales_credit_pools p WHERE p.id=$1`, [poolId]
  );
  const poolRow = r.rows?.[0];
  if (!poolRow) return null;
  const outstanding = Math.max(0, Number(poolRow.approved_fen) - Number(poolRow.paid_fen));
  const exceeded = poolRow.payment_type === 'credit' && outstanding > Number(poolRow.credit_limit_fen);
  if (lockWhenExceeded && exceeded && poolRow.status !== 'locked') {
    await pool.query(`UPDATE sales_credit_pools SET status='locked',lock_reason=$2,updated_at=NOW() WHERE id=$1`, [poolId, `品牌欠款超过授信：欠款${outstanding}分，授信${poolRow.credit_limit_fen}分`]);
    poolRow.status = 'locked';
  }
  return { ...poolRow, outstanding_fen: outstanding, exceeded, can_approve_order: poolRow.status === 'active' && !exceeded };
}

export { brandKey };
