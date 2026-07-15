/**
 * 销售提成：按成交金额*提成比例计算，之前系统完全没有这块(没有规则、没有计算、没有发放记录)。
 * 设计：每个销售可以有自己的提成比例(sales_commission_rules)，没配置时用全员默认规则(rep_id为NULL的那条)。
 * 提成金额在生成时按当时规则冻结成快照(base_amount_fen/rate_percent/commission_amount_fen)，
 * 之后规则调整不会改变已生成的历史提成记录，只影响新成交。
 */

export async function setCommissionRule(pool, { repId, ratePercent, effectiveFrom, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_commission_rules (rep_id, rate_percent, effective_from, created_by)
     VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4)
     ON CONFLICT (rep_id, effective_from) DO UPDATE SET rate_percent = EXCLUDED.rate_percent
     RETURNING *`,
    [repId || null, ratePercent, effectiveFrom || null, createdBy || null]
  );
  return r.rows[0];
}

async function getEffectiveCommissionRate(pool, repId, onDate) {
  const date = onDate || new Date().toISOString().slice(0, 10);
  if (repId) {
    const own = await pool.query(
      `SELECT rate_percent FROM sales_commission_rules WHERE rep_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`,
      [repId, date]
    );
    if (own.rows?.[0]) return Number(own.rows[0].rate_percent);
  }
  const global = await pool.query(
    `SELECT rate_percent FROM sales_commission_rules WHERE rep_id IS NULL AND effective_from <= $1 ORDER BY effective_from DESC LIMIT 1`,
    [date]
  );
  return global.rows?.[0] ? Number(global.rows[0].rate_percent) : 0;
}

/**
 * 成交后生成一条提成记录。sales_deals.amount 是"元"(跟系统其它用_fen后缀的字段不一致，
 * 是这张表本身的历史存法)，这里统一转成分入库，跟sales_commissions._fen命名保持一致。
 */
export async function generateCommissionForDeal(pool, dealId) {
  const dealR = await pool.query(
    `SELECT d.id, d.amount, d.deal_date, l.owner_username, r.id AS rep_id
       FROM sales_deals d
       JOIN sales_leads l ON l.id = d.lead_id
       LEFT JOIN sales_reps r ON r.rep_key = l.owner_username
      WHERE d.id = $1`,
    [dealId]
  );
  const deal = dealR.rows?.[0];
  if (!deal) return { ok: false, error: 'deal_not_found' };

  const existing = await pool.query(`SELECT * FROM sales_commissions WHERE deal_id = $1`, [dealId]);
  if (existing.rows?.[0]) return { ok: true, commission: existing.rows[0], already: true };

  const baseAmountFen = Math.round(Number(deal.amount || 0) * 100);
  const ratePercent = await getEffectiveCommissionRate(pool, deal.rep_id, deal.deal_date);
  const commissionAmountFen = Math.round(baseAmountFen * ratePercent / 100);

  const r = await pool.query(
    `INSERT INTO sales_commissions (deal_id, rep_id, base_amount_fen, rate_percent, commission_amount_fen)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [dealId, deal.rep_id || null, baseAmountFen, ratePercent, commissionAmountFen]
  );
  return { ok: true, commission: r.rows[0] };
}

export async function listCommissions(pool, { repId, status, limit = 100 } = {}) {
  const params = [];
  const conds = [];
  if (repId) { params.push(repId); conds.push(`c.rep_id = $${params.length}`); }
  if (status) { params.push(status); conds.push(`c.status = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT c.*, r.display_name AS rep_name, d.deal_date, d.amount AS deal_amount, l.company, l.name AS lead_name
       FROM sales_commissions c
       LEFT JOIN sales_reps r ON r.id = c.rep_id
       LEFT JOIN sales_deals d ON d.id = c.deal_id
       LEFT JOIN sales_leads l ON l.id = d.lead_id
       ${where}
      ORDER BY c.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows || [];
}

export async function updateCommissionStatus(pool, commissionId, { status, approvedBy }) {
  if (!['approved', 'paid', 'rejected'].includes(status)) throw new Error('invalid_status');
  const extra = status === 'approved' ? `, approved_by = $3, approved_at = NOW()`
    : status === 'paid' ? `, paid_at = NOW()` : '';
  const r = await pool.query(
    `UPDATE sales_commissions SET status = $1, updated_at = NOW()${extra} WHERE id = $2 RETURNING *`,
    [status, commissionId, approvedBy || null]
  );
  return r.rows?.[0] || null;
}
