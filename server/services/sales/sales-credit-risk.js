/** 客户授信的唯一计算入口；欠款一律由已生效合同 - 已确认回款实时计算。 */
export async function getCreditRisk(pool, leadId, { lockWhenExceeded = true } = {}) {
  const r = await pool.query(
    `SELECT ca.*, COALESCE((SELECT SUM(c.amount_fen) FROM sales_contracts c WHERE c.lead_id=ca.lead_id AND c.status='effective'),0) AS contracted_fen,
            COALESCE((SELECT SUM(p.amount_fen) FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id WHERE c.lead_id=ca.lead_id AND p.status='confirmed'),0) AS paid_fen
       FROM sales_credit_accounts ca WHERE ca.lead_id=$1`, [leadId]
  );
  const account = r.rows?.[0];
  if (!account) return { ok: true, payment_type: 'cash', credit_limit_fen: 0, outstanding_fen: 0, status: 'active', can_provision: false };
  const outstandingFen = Math.max(0, Number(account.contracted_fen) - Number(account.paid_fen));
  const exceeded = account.payment_type === 'credit' && outstandingFen > Number(account.credit_limit_fen);
  if (lockWhenExceeded && exceeded && account.status !== 'locked') {
    await pool.query(`UPDATE sales_credit_accounts SET status='locked',lock_reason=$2,updated_at=NOW() WHERE lead_id=$1`, [leadId, `欠款${outstandingFen}分超过授信${account.credit_limit_fen}分`]);
    account.status = 'locked';
  }
  if (exceeded) {
    await pool.query(
      `INSERT INTO sales_credit_alerts (lead_id,outstanding_fen,credit_limit_fen,status)
       VALUES ($1,$2,$3,'open')
       ON CONFLICT (lead_id) WHERE status='open' DO UPDATE SET outstanding_fen=EXCLUDED.outstanding_fen,credit_limit_fen=EXCLUDED.credit_limit_fen,alerted_at=NOW()`,
      [leadId, outstandingFen, account.credit_limit_fen]
    );
  } else {
    await pool.query(`UPDATE sales_credit_alerts SET status='resolved',resolved_at=NOW() WHERE lead_id=$1 AND status='open'`, [leadId]);
  }
  return {
    ok: true, ...account, outstanding_fen: outstandingFen, exceeded,
    can_provision: account.payment_type === 'cash' ? outstandingFen === 0 && Number(account.paid_fen) > 0 : !exceeded && account.status === 'active',
    can_open_store: account.payment_type === 'cash'
      ? account.status === 'active' && outstandingFen === 0 && Number(account.paid_fen) > 0
      : account.status === 'active' && !exceeded,
  };
}

export async function scanCreditRisks(pool, notify) {
  const r = await pool.query(`SELECT lead_id FROM sales_credit_accounts WHERE payment_type='credit'`);
  const locked = [];
  for (const row of r.rows || []) {
    const risk = await getCreditRisk(pool, row.lead_id);
    if (!risk.exceeded) continue;
    locked.push(risk);
    if (typeof notify === 'function') {
      await notify(
        `【销售CRM·帐期客户超授信】\n客户线索 #${row.lead_id}\n欠款 ¥${(risk.outstanding_fen / 100).toFixed(2)}，授信 ¥${(Number(risk.credit_limit_fen) / 100).toFixed(2)}\n账户已锁定，禁止自动新增门店，须总经理重新授信。`,
        { title: '帐期客户超授信告警', audience: 'sales' }
      ).catch(() => null);
    }
  }
  return locked;
}
