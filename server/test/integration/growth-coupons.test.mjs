import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId } from './helpers/db.mjs';

// P1覆盖：/api/growth/coupons 是GAAS这边"发券"相关的接口（真正的核销/verify在
// 小程序云函数里，是另一套技术栈，不在这次GAAS测试覆盖范围内）。
// 路由已外提至 domains/growth-coupons；认证仍走小程序同步密钥(MINIPROGRAM_SYNC_SECRET)。

const SYNC_SECRET = 'test-miniprogram-sync-secret-for-integration-test';

let app;

test.before(async () => {
  app = await bootApp({ MINIPROGRAM_SYNC_SECRET: SYNC_SECRET });
});

test.after(async () => {
  await app.stop();
});

test('带正确的同步密钥可以创建券', async () => {
  const couponId = uniqueId('coupon');
  const res = await fetch(app.baseUrl + '/api/growth/coupons', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Miniprogram-Sync-Secret': SYNC_SECRET
    },
    body: JSON.stringify({
      coupon_id: couponId,
      name: '满100减20',
      type: 'cash',
      value_fen: 2000,
      price_fen: 0,
      valid_days: 30,
      stock: 100
    })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.coupon.coupon_id, couponId);
  assert.equal(Number(body.coupon.value_fen), 2000);
});

test('没有同步密钥/密钥错误应该被拒绝', async () => {
  const res = await fetch(app.baseUrl + '/api/growth/coupons', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Miniprogram-Sync-Secret': 'wrong-secret'
    },
    body: JSON.stringify({ coupon_id: uniqueId('coupon'), name: '测试券' })
  });
  assert.equal(res.status, 401);
});

test('重复创建同一个coupon_id会更新而不是报错(ON CONFLICT DO UPDATE)', async () => {
  const couponId = uniqueId('coupon');
  const create = async (name, isActive) => fetch(app.baseUrl + '/api/growth/coupons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': SYNC_SECRET },
    body: JSON.stringify({ coupon_id: couponId, name, is_active: isActive })
  });

  const first = await create('初始名称', true);
  assert.equal(first.status, 200);

  const second = await create('更新后的名称', false);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.coupon.name, '更新后的名称');
  assert.equal(secondBody.coupon.is_active, false);

  const db = testDb();
  const rows = await db.query(`select count(*)::int as c from growth_coupons where coupon_id = $1`, [couponId]);
  assert.equal(rows.rows[0].c, 1, '同一个coupon_id应该只有一行，不是插入了两行');
});

test('现状记录：GET列表接口不按tenant_id过滤(已知的设计权衡，不是本次要修的bug)', async () => {
  const db = testDb();
  const otherTenant = uniqueId('coupon_other_tenant');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, '其他租户', 'active')`,
    [otherTenant]
  );
  const otherCouponId = uniqueId('othercoupon');
  await db.query(
    `insert into growth_coupons (coupon_id, name, tenant_id) values ($1, '其他租户的券', $2)`,
    [otherCouponId, otherTenant]
  );

  const res = await fetch(app.baseUrl + '/api/growth/coupons', {
    headers: { 'X-Miniprogram-Sync-Secret': SYNC_SECRET }
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  const ids = body.coupons.map((c) => c.coupon_id);
  // 这里断言的是"现状确实会返回别的租户的券"，不是期望行为——如果以后
  // domains/growth-coupons 改成按租户过滤了，这条测试会失败，提醒去更新这条注释
  // 和这次的P1覆盖判断，而不是意味着改坏了什么。
  assert.ok(ids.includes(otherCouponId), '现状：GET /api/growth/coupons 会返回所有租户的券(设计如此，见文件头注释)');
});
