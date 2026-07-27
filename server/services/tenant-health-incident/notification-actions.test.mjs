import assert from 'node:assert/strict';
import test from 'node:test';
import {
  healAuditDeliveryFailures,
  healNotifyCustomer,
  healNotifyOps,
} from './notification-actions.js';

function makePool({ users = [{ username: 'admin_t1' }], deliveryRows = [] } = {}) {
  const notifications = [];
  return {
    notifications,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM users')) return { rows: users };
      if (text.includes('FROM employees')) return { rows: [{ username: 'employee_t1' }] };
      if (text.includes('hrms_user_notifications')) {
        if (text.includes('information_schema.tables')) return { rows: [{ ok: 1 }] };
        notifications.push({ username: params[0], title: params[1], message: params[2], meta: JSON.parse(params[3]) });
        return { rows: [{ id: notifications.length }] };
      }
      if (text.includes('growth_delivery_logs')) {
        if (text.includes('information_schema.tables')) return { rows: [{ ok: 1 }] };
        return { rows: deliveryRows };
      }
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    },
  };
}

const customerIncident = {
  id: 11,
  tenant_id: 't1',
  item_key: 'manager_confirmed_tasks',
  item_name: '门店负责人确认',
  severity: 'P1',
  suggestion: '请店长确认',
  queue: 'customer',
};

test('通知客户：写入站内通知并按飞书账户去重', async () => {
  const pool = makePool({ users: [{ username: 'admin_t1' }, { username: 'admin_t2' }] });
  const sent = [];
  const result = await healNotifyCustomer(pool, customerIncident, {
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_same' }),
    sendLarkMessage: async (openId, text, options) => {
      sent.push({ openId, text, options });
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.notified, 2);
  assert.equal(result.feishu_sent, 1);
  assert.equal(pool.notifications.length, 2);
  assert.match(pool.notifications[0].message, /客户可处理/);
  assert.deepEqual(sent[0].options, { skipDedup: true });
});

test('通知值班：按队列选择客服受众', async () => {
  const sent = [];
  const result = await healNotifyOps(makePool(), {
    ...customerIncident,
    queue: 'third_party',
  }, {
    sendOpsAlert: async (text, options) => {
      sent.push({ text, options });
      return { ok: true, feishuSent: 1 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.audience, 'cs');
  assert.equal(sent[0].options.audience, 'cs');
  assert.match(sent[0].text, /第三方/);
});

test('汇总触达失败：只读统计并提醒值班', async () => {
  const pool = makePool({
    deliveryRows: [
      { status: 'failed', cnt: 3, last_at: '2026-07-27T00:00:00.000Z', sample_error: 'timeout' },
      { status: 'sent', cnt: 1, last_at: '2026-07-27T00:00:00.000Z', sample_error: '' },
    ],
  });
  const result = await healAuditDeliveryFailures(pool, {
    ...customerIncident,
    item_key: 'sms_wecom_sent',
  }, {
    sendOpsAlert: async () => ({ ok: true }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.failed, 3);
  assert.equal(result.summary.fail_rate_pct, 75);
  assert.match(result.message, /75%/);
});
