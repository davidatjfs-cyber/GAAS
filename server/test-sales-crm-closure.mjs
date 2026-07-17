import assert from 'node:assert/strict';
import pg from 'pg';
import { getCreditRisk, scanCreditRisks } from './services/sales/sales-credit-risk.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function makeLead(label) {
  const r = await pool.query(
    `INSERT INTO sales_leads (lead_key,name,company,stage,controller)
     VALUES ($1,$2,$3,'proposal','human') RETURNING id`,
    [`crm_test_${label}_${suffix}`, `测试${label}`, `测试公司${label}`]
  );
  return r.rows[0].id;
}

try {
  await pool.query('BEGIN');

  const cashLead = await makeLead('现金');
  const cashContract = await pool.query(
    `INSERT INTO sales_contracts (lead_id,contract_no,status,amount_fen,created_by,customer_signed_at,our_signed_at,effective_at)
     VALUES ($1,$2,'effective',100000,'test',NOW(),NOW(),NOW()) RETURNING id`,
    [cashLead, `CASH-${suffix}`]
  );
  await pool.query(`INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status) VALUES ($1,'cash',0,'active')`, [cashLead]);
  let cashRisk = await getCreditRisk(pool, cashLead);
  assert.equal(cashRisk.outstanding_fen, 100000);
  assert.equal(cashRisk.can_provision, false);
  assert.equal(cashRisk.can_open_store, false);
  await pool.query(
    `INSERT INTO sales_payments (contract_id,amount_fen,status,submitted_by,confirmed_by,confirmed_at)
     VALUES ($1,100000,'confirmed','test','finance',NOW())`,
    [cashContract.rows[0].id]
  );
  cashRisk = await getCreditRisk(pool, cashLead);
  assert.equal(cashRisk.outstanding_fen, 0);
  assert.equal(cashRisk.can_provision, true);
  assert.equal(cashRisk.can_open_store, true);

  const creditLead = await makeLead('帐期');
  await pool.query(
    `INSERT INTO sales_contracts (lead_id,contract_no,status,amount_fen,created_by,customer_signed_at,our_signed_at,effective_at)
     VALUES ($1,$2,'effective',150000,'test',NOW(),NOW(),NOW())`,
    [creditLead, `CREDIT-${suffix}`]
  );
  await pool.query(`INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status,approved_by,approved_at) VALUES ($1,'credit',100000,'active','gm',NOW())`, [creditLead]);
  let creditRisk = await getCreditRisk(pool, creditLead);
  assert.equal(creditRisk.exceeded, true);
  assert.equal(creditRisk.status, 'locked');
  assert.equal(creditRisk.can_provision, false);
  assert.equal(creditRisk.can_open_store, false);
  const alert = await pool.query(`SELECT * FROM sales_credit_alerts WHERE lead_id=$1 AND status='open'`, [creditLead]);
  assert.equal(alert.rowCount, 1);
  let notifications = 0;
  const locked = await scanCreditRisks(pool, async () => { notifications += 1; });
  assert.ok(locked.some((x) => Number(x.lead_id) === Number(creditLead)));
  assert.equal(notifications, 1);

  await pool.query(`UPDATE sales_credit_accounts SET credit_limit_fen=200000,status='active',lock_reason=NULL,approved_by='gm',approved_at=NOW() WHERE lead_id=$1`, [creditLead]);
  creditRisk = await getCreditRisk(pool, creditLead);
  assert.equal(creditRisk.exceeded, false);
  assert.equal(creditRisk.can_provision, true);
  assert.equal(creditRisk.can_open_store, true);
  const resolved = await pool.query(`SELECT * FROM sales_credit_alerts WHERE lead_id=$1 AND status='resolved'`, [creditLead]);
  assert.equal(resolved.rowCount, 1);

  await pool.query('ROLLBACK');
  console.log('sales CRM closure test passed');
} catch (error) {
  await pool.query('ROLLBACK').catch(() => null);
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
