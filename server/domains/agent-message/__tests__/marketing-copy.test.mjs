import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeishuMarketingCopyAckMessage,
  buildFeishuMarketingCopyHeadings,
  clampFeishuMarketingCopySetCount,
  parseFeishuMarketingCopySetRaw,
  parseFeishuMarketingCopyTemplate,
} from '../marketing-copy-helpers.js';
import { runFeishuMarketingCopyGeneration } from '../marketing-copy-io.js';
import { createTryFeishuMarketingCopyRound } from '../marketing-copy.js';

test('parse / clamp set count', () => {
  assert.equal(parseFeishuMarketingCopySetRaw('3套'), 3);
  assert.equal(parseFeishuMarketingCopySetRaw(''), null);
  assert.equal(clampFeishuMarketingCopySetCount(null), 2);
  assert.equal(clampFeishuMarketingCopySetCount(99), 12);
  assert.equal(clampFeishuMarketingCopySetCount(0), 1);
});

test('headings scale with set count', () => {
  const { lines, totalBlocks, setCount } = buildFeishuMarketingCopyHeadings(2);
  assert.equal(setCount, 2);
  assert.equal(totalBlocks, 8);
  assert.equal(lines[0], '【大众点评｜第1套】');
  assert.equal(lines[3], '【抖音｜第1套】');
  assert.equal(lines[4], '【大众点评｜第2套】');
});

test('parseFeishuMarketingCopyTemplate', () => {
  assert.equal(parseFeishuMarketingCopyTemplate('随便问问'), null);
  const parsed = parseFeishuMarketingCopyTemplate(
    '营销文案\n菜名：红烧肉\n品牌：洪潮\n推荐理由：肥而不腻\n文案套数：3'
  );
  assert.deepEqual(parsed, {
    dishNames: '红烧肉',
    brand: '洪潮',
    reason: '肥而不腻',
    copySetCount: 3,
  });
  const legacy = parseFeishuMarketingCopyTemplate('营销文案\n内容：烤鱼\n备注：香');
  assert.equal(legacy.dishNames, '烤鱼');
  assert.equal(legacy.reason, '香');
  assert.equal(legacy.copySetCount, 2);
});

test('ack message includes set count', () => {
  const msg = buildFeishuMarketingCopyAckMessage({
    dishNames: '烤鱼',
    brand: '洪潮',
    reason: '香',
    copySetCount: 2,
  });
  assert.match(msg, /烤鱼/);
  assert.match(msg, /文案套数：\*\*2\*\*/);
});

test('runFeishuMarketingCopyGeneration without images', async () => {
  const calls = [];
  const out = await runFeishuMarketingCopyGeneration(
    {
      callVisionLLM: async () => {
        throw new Error('should not call vision');
      },
      callLLM: async (messages, opts) => {
        calls.push({ messages, opts });
        return { content: '【大众点评｜第1套】\nok' };
      },
    },
    {
      params: { dishNames: '烤鱼', brand: '洪潮', reason: '香', copySetCount: 1 },
      imageUrls: [],
      role: 'hq_manager',
    },
    { role: 'hq_manager' }
  );
  assert.match(out, /大众点评/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.max_tokens, Math.min(8192, 900 + 4 * 280));
});

test('tryFeishuMarketingCopyRound start / cancel / generate', async () => {
  const sent = [];
  const tryRound = createTryFeishuMarketingCopyRound({
    callLLM: async () => ({ content: '生成结果正文' }),
    callVisionLLM: async () => ({ content: '' }),
    sendLarkMessage: async (openId, text) => {
      sent.push({ openId, text });
    },
    prefixWithAgentName: (_agent, text) => text,
    log: { error() {} },
  });

  assert.equal(await tryRound({ openId: '', feishuUser: { role: 'admin' }, text: 'x' }), null);

  const denied = await tryRound({
    openId: 'ou_a',
    feishuUser: { role: 'waiter' },
    text: '营销文案\n菜名：鱼',
  });
  assert.equal(denied.body.marketingCopy, 'denied');

  const started = await tryRound({
    openId: 'ou_b',
    feishuUser: { role: 'admin', username: 'u1' },
    text: '营销文案\n菜名：鱼\n品牌：洪潮',
  });
  assert.equal(started.body.marketingCopy, 'started');

  const cancelled = await tryRound({
    openId: 'ou_b',
    feishuUser: { role: 'admin' },
    text: '取消',
  });
  assert.equal(cancelled.body.marketingCopy, 'cancelled');

  await tryRound({
    openId: 'ou_c',
    feishuUser: { role: 'hq_manager' },
    text: '营销文案\n菜名：虾',
  });
  const photos = await tryRound({
    openId: 'ou_c',
    feishuUser: { role: 'hq_manager' },
    text: '',
    imageUrls: ['https://img/1.jpg'],
  });
  assert.equal(photos.body.marketingCopy, 'photos');

  const done = await tryRound({
    openId: 'ou_c',
    feishuUser: { role: 'hq_manager' },
    text: '生成文案',
  });
  assert.equal(done.body.marketingCopy, 'done');
  assert.ok(sent.some((s) => String(s.text).includes('生成结果正文')));
});
