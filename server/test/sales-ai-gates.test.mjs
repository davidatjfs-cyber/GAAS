/**
 * domains/sales-ai/gates.js 角色门 + 开票副作用单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesAiGates } from '../domains/sales-ai/gates.js';

function mockRes() {
  const out = { statusCode: 200, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
}

function runGate(gate, role) {
  const req = { platformAdmin: { role } };
  const res = mockRes();
  let nextCalled = false;
  gate(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, status: res.out.statusCode, body: res.out.body };
}

test('financeGate：finance/super_admin 放行，其它 403', () => {
  const { financeGate } = createSalesAiGates({ query: async () => ({}) });
  assert.equal(runGate(financeGate, 'finance').nextCalled, true);
  assert.equal(runGate(financeGate, 'super_admin').nextCalled, true);
  const denied = runGate(financeGate, 'sales');
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.status, 403);
});

test('financeOrCsGate：客服也可处理开票提醒', () => {
  const { financeOrCsGate } = createSalesAiGates({ query: async () => ({}) });
  assert.equal(runGate(financeOrCsGate, 'customer_service').nextCalled, true);
  assert.equal(runGate(financeOrCsGate, 'sales_manager').nextCalled, false);
});

test('generalManagerGate / salesCreateCustomerGate 角色边界', () => {
  const { generalManagerGate, salesCreateCustomerGate } = createSalesAiGates({
    query: async () => ({}),
  });
  assert.equal(runGate(generalManagerGate, 'general_manager').nextCalled, true);
  assert.equal(runGate(generalManagerGate, 'finance').nextCalled, false);
  assert.equal(runGate(salesCreateCustomerGate, 'sales').nextCalled, true);
  assert.equal(runGate(salesCreateCustomerGate, 'sales_manager').nextCalled, true);
  assert.equal(runGate(salesCreateCustomerGate, 'customer_service').nextCalled, false);
});

test('contractPriceGate：finance/GM/super_admin 可看；sales_manager 不可', () => {
  const { contractPriceGate } = createSalesAiGates({ query: async () => ({}) });
  assert.equal(runGate(contractPriceGate, 'finance').nextCalled, true);
  assert.equal(runGate(contractPriceGate, 'general_manager').nextCalled, true);
  assert.equal(runGate(contractPriceGate, 'super_admin').nextCalled, true);
  const denied = runGate(contractPriceGate, 'sales_manager');
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.status, 403);
});

test('managerGate：有 middleware 则委托；缺省透传 next', () => {
  let seen = false;
  const custom = (_req, _res, next) => {
    seen = true;
    next();
  };
  const withMw = createSalesAiGates({ query: async () => ({}) }, custom);
  assert.equal(runGate(withMw.managerGate, 'sales').nextCalled, true);
  assert.equal(seen, true);

  const passthrough = createSalesAiGates({ query: async () => ({}) });
  assert.equal(runGate(passthrough.managerGate, 'sales').nextCalled, true);
});

test('ensureInvoiceRequestForOrder：成功写库；抛错吞掉', async () => {
  const calls = [];
  const okPool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  const { ensureInvoiceRequestForOrder } = createSalesAiGates(okPool);
  await ensureInvoiceRequestForOrder(
    { id: 'o1', contract_id: 'c1', amount_fen: 100 },
    'fin_user'
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sales_invoices/);
  assert.deepEqual(calls[0].params, ['c1', 'o1', 100, 'fin_user']);

  const boomPool = {
    query: async () => {
      throw new Error('db down');
    },
  };
  const gates = createSalesAiGates(boomPool);
  await assert.doesNotReject(() =>
    gates.ensureInvoiceRequestForOrder({ id: 'o2', contract_id: 'c2', amount_fen: 1 }, 'u')
  );
});

test('autoProvisionIfEligible：始终 null', async () => {
  const { autoProvisionIfEligible } = createSalesAiGates({ query: async () => ({}) });
  assert.equal(await autoProvisionIfEligible(), null);
});
