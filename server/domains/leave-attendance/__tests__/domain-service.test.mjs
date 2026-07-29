/**
 * domains/leave-attendance/domain-service.js — upsertLeaveDomain 并发安全性。
 * 之前是无条件整表覆盖三个字段，多店并发调用（月末结算 vs 管理员手动调整欠休余额）
 * 会互相冲掉对方的改动；现改成 SELECT ... FOR UPDATE 锁行 + 只合并 patch 里出现的字段。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertLeaveDomain } from '../domain-service.js';

/** 模拟事务连接，回收最终 UPDATE 的参数；currentRow 模拟"表里已经存在的值"。 */
async function upsertCapture({ currentRow, patch, tenantId = 'default' }) {
  let updateParams = null;
  let insertedEmptyRow = false;
  const pool = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, params) {
          const s = String(sql);
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return {};
          if (/SELECT[\s\S]*FROM hrms_leave_domain[\s\S]*FOR UPDATE/i.test(s)) {
            return { rows: currentRow ? [currentRow] : [] };
          }
          if (/UPDATE hrms_leave_domain/i.test(s)) {
            updateParams = params;
            return { rowCount: 1 };
          }
          if (/INSERT INTO hrms_leave_domain/i.test(s)) {
            insertedEmptyRow = true;
            return {};
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  await upsertLeaveDomain(pool, tenantId, patch);
  return { updateParams, insertedEmptyRow };
}

test('只 patch leaveCumulativeCloseSnapshots：leaveBalanceOverrides/leaveBalanceAdjustments 保留表里当前值不被清空', async () => {
  const { updateParams } = await upsertCapture({
    currentRow: {
      leave_balance_overrides: { 'alice|2026-07': { mode: 'remaining', value: 3 } },
      leave_balance_adjustments: [{ id: 'adj-1' }],
      leave_cumulative_close_snapshots: {},
      updated_at: 'ts1',
    },
    patch: { leaveCumulativeCloseSnapshots: { 'bob|2026-06': { value: 7.1 } } },
  });
  assert.deepEqual(JSON.parse(updateParams[1]), { 'alice|2026-07': { mode: 'remaining', value: 3 } });
  assert.deepEqual(JSON.parse(updateParams[2]), [{ id: 'adj-1' }]);
  assert.deepEqual(JSON.parse(updateParams[3]), { 'bob|2026-06': { value: 7.1 } });
});

test('并发场景：两次调用各自只 patch 自己的 key，互不冲掉——模拟月末结算与人工调整同时发生', async () => {
  // 第一次调用（管理员手动调整欠休余额）看到的表现值
  const { updateParams: p1 } = await upsertCapture({
    currentRow: {
      leave_balance_overrides: {},
      leave_balance_adjustments: [],
      leave_cumulative_close_snapshots: {},
      updated_at: 'ts1',
    },
    patch: { leaveBalanceOverrides: { 'alice|2026-07': { mode: 'remaining', value: 5 } } },
  });
  assert.deepEqual(JSON.parse(p1[1]), { 'alice|2026-07': { mode: 'remaining', value: 5 } });
  assert.deepEqual(JSON.parse(p1[3]), {}); // snapshots 没被这次调用碰过

  // 第二次调用（月末结算），"表里当前值"已经包含第一次调用刚写入的 alice 记录——
  // 模拟第一次调用已经提交之后，第二次调用重新 SELECT ... FOR UPDATE 读到的最新状态
  const { updateParams: p2 } = await upsertCapture({
    currentRow: {
      leave_balance_overrides: { 'alice|2026-07': { mode: 'remaining', value: 5 } },
      leave_balance_adjustments: [],
      leave_cumulative_close_snapshots: {},
      updated_at: 'ts2',
    },
    patch: { leaveCumulativeCloseSnapshots: { 'bob|2026-06': { value: 7.1, source: 'system_month_close' } } },
  });
  // 第二次调用只碰 snapshots，alice 的 override 必须还在
  assert.deepEqual(JSON.parse(p2[1]), { 'alice|2026-07': { mode: 'remaining', value: 5 } });
  assert.deepEqual(JSON.parse(p2[3]), { 'bob|2026-06': { value: 7.1, source: 'system_month_close' } });
});

test('leaveBalanceOverrides patch 里 key 为 null 表示删除该 key（用于清理旧格式 legacy key）', async () => {
  const { updateParams } = await upsertCapture({
    currentRow: {
      leave_balance_overrides: { 'legacy_key': { value: 1 }, 'keep_key': { value: 2 } },
      leave_balance_adjustments: [],
      leave_cumulative_close_snapshots: {},
      updated_at: 'ts1',
    },
    patch: { leaveBalanceOverrides: { legacy_key: null, 'alice|2026-07': { value: 9 } } },
  });
  assert.deepEqual(JSON.parse(updateParams[1]), { keep_key: { value: 2 }, 'alice|2026-07': { value: 9 } });
});

test('leaveBalanceAdjustments 按 id 合并：patch 里的新记录 + 表里未出现在 patch 中的记录都保留', async () => {
  const { updateParams } = await upsertCapture({
    currentRow: {
      leave_balance_overrides: {},
      leave_balance_adjustments: [{ id: 'old-1' }, { id: 'old-2' }],
      leave_cumulative_close_snapshots: {},
      updated_at: 'ts1',
    },
    patch: { leaveBalanceAdjustments: [{ id: 'new-1' }] },
  });
  const adjustments = JSON.parse(updateParams[2]);
  assert.deepEqual(adjustments, [{ id: 'new-1' }, { id: 'old-1' }, { id: 'old-2' }]);
});

test('没有传任何字段时不发起任何查询', async () => {
  let called = false;
  const pool = {
    async query() { called = true; return { rows: [] }; },
    async connect() { called = true; return { async query() { return {}; }, release() {} }; },
  };
  await upsertLeaveDomain(pool, 'default', {});
  assert.equal(called, false);
});

test('表里还没有该租户的行时：先插入空行再重试，最终仍正确合并', async () => {
  let selectCount = 0;
  let insertCount = 0;
  let updateParams = null;
  const pool = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, params) {
          const s = String(sql);
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return {};
          if (/SELECT[\s\S]*FROM hrms_leave_domain[\s\S]*FOR UPDATE/i.test(s)) {
            selectCount += 1;
            if (selectCount === 1) return { rows: [] }; // 第一次：行还不存在
            return {
              rows: [{
                leave_balance_overrides: {},
                leave_balance_adjustments: [],
                leave_cumulative_close_snapshots: {},
                updated_at: 'ts-after-insert',
              }],
            };
          }
          if (/INSERT INTO hrms_leave_domain/i.test(s)) {
            insertCount += 1;
            return {};
          }
          if (/UPDATE hrms_leave_domain/i.test(s)) {
            updateParams = params;
            return { rowCount: 1 };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  await upsertLeaveDomain(pool, 'default', { leaveCumulativeCloseSnapshots: { x: 1 } });
  assert.equal(insertCount, 1);
  assert.equal(selectCount, 2);
  assert.deepEqual(JSON.parse(updateParams[3]), { x: 1 });
});
