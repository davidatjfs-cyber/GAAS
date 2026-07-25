/**
 * L1：客户授信 / 品牌授信池 — 正常、边界、超授信锁定、扫描告警。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCreditRisk, scanCreditRisks } from '../services/sales/sales-credit-risk.js';
import { brandKey, getCreditPoolRisk } from '../services/sales/sales-order-credit.js';

function mockPool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params: params || [] });
      return handler(String(sql), params || []);
    },
  };
}

test('brandKey normalizes whitespace/case', () => {
  assert.equal(brandKey('  Hong Chao '), 'hongchao');
  assert.equal(brandKey(null), '');
  assert.equal(brandKey(''), '');
});

test('getCreditRisk: 无授信账户 → cash 默认且不可开通', async () => {
  const pool = mockPool(() => ({ rows: [] }));
  const r = await getCreditRisk(pool, 1);
  assert.equal(r.ok, true);
  assert.equal(r.payment_type, 'cash');
  assert.equal(r.can_provision, false);
  assert.equal(r.outstanding_fen, 0);
  assert.equal('can_open_store' in r, false);
});

test('getCreditRisk: cash 已付清 → 可开通', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_accounts ca WHERE ca.lead_id=$1')) {
      return {
        rows: [{
          lead_id: 9,
          payment_type: 'cash',
          credit_limit_fen: 0,
          status: 'active',
          contracted_fen: 10000,
          paid_fen: 10000,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditRisk(pool, 9);
  assert.equal(r.outstanding_fen, 0);
  assert.equal(r.exceeded, false);
  assert.equal(r.can_provision, true);
  assert.equal(r.can_open_store, true);
  assert.ok(pool.calls.some((c) => c.sql.includes("status='resolved'")));
});

test('getCreditRisk: credit 超授信 → 锁定 + 告警 + 禁止开通', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_accounts ca WHERE ca.lead_id=$1')) {
      return {
        rows: [{
          lead_id: 3,
          payment_type: 'credit',
          credit_limit_fen: 5000,
          status: 'active',
          contracted_fen: 20000,
          paid_fen: 1000,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditRisk(pool, 3);
  assert.equal(r.exceeded, true);
  assert.equal(r.outstanding_fen, 19000);
  assert.equal(r.status, 'locked');
  assert.equal(r.can_provision, false);
  assert.equal(r.can_open_store, false);
  assert.ok(pool.calls.some((c) => c.sql.includes("SET status='locked'")));
  assert.ok(pool.calls.some((c) => c.sql.includes('sales_credit_alerts')));
});

test('getCreditRisk: lockWhenExceeded=false 超授信不写锁定', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_accounts ca WHERE ca.lead_id=$1')) {
      return {
        rows: [{
          lead_id: 4,
          payment_type: 'credit',
          credit_limit_fen: 100,
          status: 'active',
          contracted_fen: 500,
          paid_fen: 0,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditRisk(pool, 4, { lockWhenExceeded: false });
  assert.equal(r.exceeded, true);
  assert.equal(r.status, 'active');
  assert.ok(!pool.calls.some((c) => c.sql.includes("SET status='locked'")));
});

test('getCreditRisk: credit 未超授信且 active → 可开通门店', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_accounts ca WHERE ca.lead_id=$1')) {
      return {
        rows: [{
          lead_id: 5,
          payment_type: 'credit',
          credit_limit_fen: 50000,
          status: 'active',
          contracted_fen: 10000,
          paid_fen: 2000,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditRisk(pool, 5);
  assert.equal(r.exceeded, false);
  assert.equal(r.outstanding_fen, 8000);
  assert.equal(r.can_provision, true);
  assert.equal(r.can_open_store, true);
});

test('scanCreditRisks: 仅收集超授信并 notify', async () => {
  const notes = [];
  const pool = mockPool((sql, params) => {
    if (sql.includes("FROM sales_credit_accounts WHERE payment_type='credit'")) {
      return { rows: [{ lead_id: 11 }, { lead_id: 12 }] };
    }
    if (sql.includes('FROM sales_credit_accounts ca WHERE ca.lead_id=$1')) {
      const id = params[0];
      if (id === 11) {
        return {
          rows: [{
            lead_id: 11,
            payment_type: 'credit',
            credit_limit_fen: 1000,
            status: 'active',
            contracted_fen: 5000,
            paid_fen: 0,
          }],
        };
      }
      return {
        rows: [{
          lead_id: 12,
          payment_type: 'credit',
          credit_limit_fen: 10000,
          status: 'active',
          contracted_fen: 1000,
          paid_fen: 1000,
        }],
      };
    }
    return { rows: [] };
  });
  const locked = await scanCreditRisks(pool, async (msg) => {
    notes.push(msg);
  });
  assert.equal(locked.length, 1);
  assert.equal(locked[0].lead_id, 11);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes('超授信'));
});

test('scanCreditRisks: notify 抛错不中断扫描', async () => {
  const pool = mockPool((sql, params) => {
    if (sql.includes("WHERE payment_type='credit'")) {
      return { rows: [{ lead_id: 21 }] };
    }
    if (sql.includes('ca.lead_id=$1')) {
      return {
        rows: [{
          lead_id: 21,
          payment_type: 'credit',
          credit_limit_fen: 1,
          status: 'active',
          contracted_fen: 100,
          paid_fen: 0,
        }],
      };
    }
    return { rows: [] };
  });
  const locked = await scanCreditRisks(pool, async () => {
    throw new Error('notify down');
  });
  assert.equal(locked.length, 1);
});

test('getCreditPoolRisk: 无池 → null；超授信锁定', async () => {
  const empty = mockPool(() => ({ rows: [] }));
  assert.equal(await getCreditPoolRisk(empty, 1), null);

  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_pools')) {
      return {
        rows: [{
          id: 7,
          payment_type: 'credit',
          credit_limit_fen: 1000,
          status: 'active',
          approved_fen: 5000,
          paid_fen: 0,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditPoolRisk(pool, 7);
  assert.equal(r.exceeded, true);
  assert.equal(r.status, 'locked');
  assert.equal(r.can_approve_order, false);
  assert.ok(pool.calls.some((c) => c.sql.includes('sales_credit_pools') && c.sql.includes("status='locked'")));
});

test('getCreditPoolRisk: cash 池不按授信超额锁定', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM sales_credit_pools')) {
      return {
        rows: [{
          id: 8,
          payment_type: 'cash',
          credit_limit_fen: 0,
          status: 'active',
          approved_fen: 99999,
          paid_fen: 0,
        }],
      };
    }
    return { rows: [] };
  });
  const r = await getCreditPoolRisk(pool, 8);
  assert.equal(r.exceeded, false);
  assert.equal(r.can_approve_order, true);
  assert.ok(!pool.calls.some((c) => c.sql.includes("SET status='locked'")));
});
