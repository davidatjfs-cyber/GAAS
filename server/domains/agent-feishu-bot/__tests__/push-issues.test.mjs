import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushIssuesToFeishu } from '../push-issues.js';

test('pushIssuesToFeishu sends card and marks notified', async () => {
  const updates = [];
  const inserts = [];
  const push = createPushIssuesToFeishu({
    pool: () => ({
      query: async (sql, params) => {
        if (/FROM agent_issues/i.test(sql)) {
          return {
            rows: [
              {
                id: 1,
                title: '缺货',
                detail: '蚝油',
                severity: 'high',
                store: '洪潮',
                category: '库存',
                assignee_username: 'mgr',
              },
            ],
          };
        }
        if (/UPDATE agent_issues/i.test(sql)) {
          updates.push(params);
          return { rows: [] };
        }
        if (/INSERT INTO agent_messages/i.test(sql)) {
          inserts.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      },
    }),
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_mgr' }),
    sendLarkCard: async () => ({ ok: true }),
    sendLarkMessage: async () => ({ ok: false }),
    prefixWithAgentName: (_r, t) => t,
    resolveTenantIdDefault: () => 'default',
    log: { error() {} },
  });

  assert.equal(await push('default'), 1);
  assert.equal(updates.length, 1);
  assert.equal(inserts.length, 1);
});

test('pushIssuesToFeishu falls back to text message', async () => {
  const push = createPushIssuesToFeishu({
    pool: () => ({
      query: async (sql) => {
        if (/FROM agent_issues/i.test(sql)) {
          return {
            rows: [
              {
                id: 2,
                title: '卫生',
                detail: 'd',
                severity: 'medium',
                store: '马己仙',
                category: 'c',
                assignee_username: 'a',
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_a' }),
    sendLarkCard: async () => ({ ok: false }),
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_r, t) => t,
    resolveTenantIdDefault: () => 'default',
    log: { error() {} },
  });
  assert.equal(await push(), 1);
});
