import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import XLSX from 'xlsx';
import {
  analyzeOrders,
  classifyCustomer,
  dateOnly,
  hourOf,
  inferMapping,
  inferSheetKind,
  normalizeWorkbook,
} from '../workbook-analysis.js';

test('dateOnly parses common date strings', () => {
  assert.equal(dateOnly('2026-07-20'), '2026-07-20');
  assert.equal(dateOnly('2026/07/20'), '2026-07-20');
  assert.equal(dateOnly('2026年7月20日'), '2026-07-20');
  assert.equal(dateOnly(''), '');
});

test('hourOf extracts hour from time strings', () => {
  assert.equal(hourOf('2026-07-20 18:30'), 18);
  assert.equal(hourOf('12:45'), 12);
  assert.equal(hourOf(''), null);
});

test('inferMapping maps POS headers to canonical fields', () => {
  const headers = ['订单号', '手机号', '营业日期', '实收金额', '菜品名称'];
  const sampleRows = [
    ['O1001', '13812345678', '2026-07-01', '288', '招牌牛肉'],
    ['O1002', '13900001111', '2026-07-02', '168', '时蔬'],
  ];
  const { mapping } = inferMapping(headers, sampleRows);
  assert.equal(mapping.phone.header, '手机号');
  assert.equal(mapping.amount.header, '实收金额');
  assert.equal(mapping.dish.header, '菜品名称');
  assert.equal(mapping.bizDate.header, '营业日期');
});

test('inferSheetKind detects stored value sheets', () => {
  const mapping = { rechargeAmount: { header: '充值金额', col: 0, score: 10 } };
  assert.equal(inferSheetKind(mapping, '储值明细'), 'stored_value');
  assert.equal(inferSheetKind({ dish: { header: '菜品', col: 1, score: 5 } }, 'POS消费'), 'pos_consumption');
});

test('classifyCustomer lifecycle and tags', () => {
  const nowTs = new Date('2026-07-20T00:00:00Z').getTime();
  const oneTime = classifyCustomer({
    orders: [{ bizDate: '2026-06-01' }],
    lastDate: '2026-06-01',
    totalSpend: 200,
    businessSignals: 0,
    familySignals: 0,
    avgInterval: 30,
  }, nowTs);
  assert.equal(oneTime.lifecycle, 'one_time');

  const repeat = classifyCustomer({
    orders: [
      { bizDate: '2026-07-01' },
      { bizDate: '2026-07-05' },
      { bizDate: '2026-07-10' },
      { bizDate: '2026-07-15' },
    ],
    lastDate: '2026-07-15',
    totalSpend: 12000,
    businessSignals: 3,
    familySignals: 0,
    avgInterval: 5,
  }, nowTs);
  assert.equal(repeat.lifecycle, 'regular');
  assert.ok(repeat.tags.includes('high_value'));
  assert.ok(repeat.tags.includes('business'));
});

test('analyzeOrders aggregates revenue and customer profiles', () => {
  const orders = [
    {
      orderNo: 'O1',
      phone: '13812345678',
      memberName: '张三',
      store: '马己仙',
      bizDate: '2026-07-10',
      hour: 18,
      amount: 500,
      kind: 'pos_consumption',
      diners: 4,
      items: [{ dish: '招牌菜', qty: 1 }],
    },
    {
      orderNo: 'O2',
      phone: '13812345678',
      store: '马己仙',
      bizDate: '2026-07-18',
      hour: 12,
      amount: 300,
      kind: 'pos_consumption',
      diners: 2,
      items: [{ dish: '招牌菜', qty: 2 }],
    },
  ];

  const report = analyzeOrders(orders, { storeName: '马己仙' });
  assert.equal(report.store_name, '马己仙');
  assert.equal(report.business.revenue, 800);
  assert.equal(report.business.orders, 2);
  assert.equal(report.customers.length, 1);
  assert.equal(report.customers[0].phone, '13812345678');
  assert.equal(report.customers[0].order_count, 2);
  assert.equal(report.customers[0].total_spend, 800);
  assert.equal(report.customers[0].favorite_dishes[0], '招牌菜');
  assert.equal(report.customers[0].lifecycle_stage, 'occasional');
  assert.equal(report.customer_mix.lifecycle.occasional, 1);
});

test('normalizeWorkbook parses a minimal POS xlsx file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-ops-'));
  const filePath = path.join(tmpDir, 'sample.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['订单号', '手机号', '营业日期', '实收金额', '菜品名称', '门店'],
    ['O9001', '13812345678', '2026-07-01', '288', '招牌牛肉', '马己仙'],
    ['O9002', '13812345678', '2026-07-08', '168', '时蔬', '马己仙'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'POS明细');
  XLSX.writeFile(wb, filePath);

  const { orders, diagnostics } = normalizeWorkbook(filePath, { sourceFile: 'sample.xlsx' });
  assert.equal(orders.length, 2);
  assert.equal(diagnostics.confidence_score, 100);
  assert.equal(orders[0].phone, '13812345678');
  assert.ok(orders.some((o) => (o.items || []).some((it) => it.dish === '招牌牛肉')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
