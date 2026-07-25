/**
 * domains/agent-message/store-resolve.js（agents 旁路已拆模块）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHqStoreFromText,
  resolveDataAuditorStore,
  maybeInheritRecentRoute,
} from '../domains/agent-message/store-resolve.js';

test('resolveHqStoreFromText：已绑非总部直接返回；总部从 known list 解析', async () => {
  assert.equal(
    await resolveHqStoreFromText({ query: async () => ({ rows: [] }) }, '洪潮', '马己仙静安店'),
    '马己仙静安店'
  );

  const pool = {
    query: async () => ({
      rows: [{ store: '洪潮大宁久光店' }, { store: '马己仙静安店' }],
    }),
  };
  assert.equal(await resolveHqStoreFromText(pool, '看看洪潮营收', '总部'), '洪潮大宁久光店');

  const boom = {
    query: async () => {
      throw new Error('db');
    },
  };
  assert.equal(await resolveHqStoreFromText(boom, '洪潮', '总部'), '总部');
});

test('resolveDataAuditorStore：跨品牌覆盖；总部文案解析', async () => {
  const infer = (s) => {
    const t = String(s || '');
    if (t.includes('马')) return '马己仙';
    if (t.includes('洪')) return '洪潮';
    return null;
  };
  const pool = {
    query: async () => ({ rows: [{ store: '洪潮大宁久光店' }] }),
  };
  const overridden = await resolveDataAuditorStore(pool, {
    text: '马己仙毛利怎么样',
    boundStore: '洪潮大宁久光店',
    inferBrandFromStoreName: infer,
  });
  assert.equal(overridden, '马己仙大宁店');

  // 总部 + 文本提及：走 canonical（品牌 infer 全 null 时走 resolved_from_text 日志分支）
  const fromHq = await resolveDataAuditorStore(pool, {
    text: '洪潮今日营收',
    boundStore: '总部',
    inferBrandFromStoreName: () => null,
  });
  assert.equal(fromHq, '洪潮大宁久光店');
});

test('maybeInheritRecentRoute：非 general 原样；general 继承最近路由', async () => {
  assert.equal(
    await maybeInheritRecentRoute({ query: async () => ({ rows: [] }) }, 'u1', 'ops'),
    'ops'
  );

  const pool = {
    query: async () => ({ rows: [{ routed_to: 'training' }] }),
  };
  assert.equal(await maybeInheritRecentRoute(pool, 'u1', 'general'), 'training');

  const empty = {
    query: async () => ({ rows: [] }),
  };
  assert.equal(await maybeInheritRecentRoute(empty, 'u1', 'general'), 'general');

  const boom = {
    query: async () => {
      throw new Error('db');
    },
  };
  assert.equal(await maybeInheritRecentRoute(boom, 'u1', 'general'), 'general');
});
