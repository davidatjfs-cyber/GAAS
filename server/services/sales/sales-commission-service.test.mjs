import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommissionRule, generateCommissionForDeal, listCommissions, updateCommissionStatus } from './sales-commission-service.js';

function makeMockPool() {
  const commissionRules = [];
  const commissions = new Map();
  let nextId = 1;
  const deal = { id: 1, amount: 50000, deal_date: '2026-07-01', owner_username: 'rep_a' };
  const rep = { id: 7, rep_key: 'rep_a', display_name: '销售A' };

  return {
    async query(sql, params = []) {
      if (/INSERT INTO sales_commission_rules/.test(sql)) {
        const rule = { rep_id: params[0], rate_percent: params[1], effective_from: params[2] || '2026-01-01' };
        commissionRules.push(rule);
        return { rows: [rule] };
      }
      if (/SELECT rate_percent FROM sales_commission_rules WHERE rep_id = \$1/.test(sql)) {
        const [repId, date] = params;
        const match = commissionRules.filter((r) => r.rep_id === repId && r.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
        return { rows: match ? [{ rate_percent: match.rate_percent }] : [] };
      }
      if (/SELECT rate_percent FROM sales_commission_rules WHERE rep_id IS NULL/.test(sql)) {
        const [date] = params;
        const match = commissionRules.filter((r) => r.rep_id == null && r.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
        return { rows: match ? [{ rate_percent: match.rate_percent }] : [] };
      }
      if (/SELECT d\.id, d\.amount, d\.deal_date/.test(sql)) {
        return { rows: [{ ...deal, owner_username: rep.rep_key, rep_id: rep.id }] };
      }
      if (/SELECT \* FROM sales_commissions WHERE deal_id = \$1/.test(sql)) {
        return { rows: [...commissions.values()].filter((c) => c.deal_id === params[0]) };
      }
      if (/INSERT INTO sales_commissions/.test(sql)) {
        const row = {
          id: nextId++, deal_id: params[0], rep_id: params[1],
          base_amount_fen: params[2], rate_percent: params[3], commission_amount_fen: params[4],
          status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        commissions.set(row.id, row);
        return { rows: [row] };
      }
      if (/SELECT c\.\*, r\.display_name/.test(sql)) {
        return { rows: [...commissions.values()] };
      }
      if (/UPDATE sales_commissions SET status/.test(sql)) {
        const [status, id] = params;
        const row = commissions.get(id);
        if (!row) return { rows: [] };
        row.status = status;
        commissions.set(id, row);
        return { rows: [row] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

test('generateCommissionForDeal converts deal.amount(yuan) to fen and applies rep-specific rate over global default', async () => {
  const pool = makeMockPool();
  await setCommissionRule(pool, { repId: null, ratePercent: 3, effectiveFrom: '2026-01-01' });
  await setCommissionRule(pool, { repId: 7, ratePercent: 8, effectiveFrom: '2026-06-01' });

  const result = await generateCommissionForDeal(pool, 1);
  assert.equal(result.ok, true);
  // deal.amount=50000元 -> 5,000,000分；rep 7 有专属8%规则(优先于全员3%默认规则)
  assert.equal(result.commission.base_amount_fen, 5000000);
  assert.equal(Number(result.commission.rate_percent), 8);
  assert.equal(result.commission.commission_amount_fen, 400000); // 5,000,000 * 8% = 400,000分 = 4000元
});

test('generateCommissionForDeal is idempotent — calling twice for same deal does not duplicate', async () => {
  const pool = makeMockPool();
  await setCommissionRule(pool, { repId: null, ratePercent: 5 });
  const first = await generateCommissionForDeal(pool, 1);
  const second = await generateCommissionForDeal(pool, 1);
  assert.equal(second.already, true);
  assert.equal(second.commission.id, first.commission.id);
});

test('updateCommissionStatus rejects invalid status values', async () => {
  const pool = makeMockPool();
  await assert.rejects(() => updateCommissionStatus(pool, 1, { status: 'not_a_real_status' }), /invalid_status/);
});
