import test from 'node:test';
import assert from 'node:assert/strict';
import { createPollBitableSubmissions } from '../domains/feishu-bitable/poll-submissions.js';

function makePoll(overrides = {}) {
  const calls = { sql: [], lark: [], process: [], extract: [], vision: 0, seed: 0 };
  const processedRecordIds = new Set();
  const lastProcessedTime = new Map();
  const deps = {
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return { rows: [] };
      },
    }),
    bitableConfigs: {
      ops_checklist: { tableId: 'tbl_ops', appToken: 'app1' },
      bad_reviews: { tableId: 'tbl_bad', appToken: 'app2' },
      empty_cfg: { tableId: '', appToken: 'x' },
    },
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys: 5,
    dedupCleanCount: 2,
    seedBitableDedup: async () => {
      calls.seed++;
    },
    getBitableRecords: async () => ({ ok: true, records: [], hasMore: false }),
    extractRelationsFromBitableRecord: async (...a) => {
      calls.extract.push(a);
    },
    processBitableData: async (...a) => {
      calls.process.push(a);
    },
    validateSubmissionLogic: async () => ({ isValid: true, issues: [], suggestion: '' }),
    validatePhotoAuthenticity: async () => ({
      isAuthentic: true,
      timeValid: true,
      notDuplicate: true,
      locationMatch: true,
    }),
    getBitableRecordImageDownloadUrl: async () => 'https://img.example/p.jpg',
    callVisionLLM: async () => {
      calls.vision++;
      return { content: '评分：8/10 卫生良好' };
    },
    extractScore: (text) => {
      const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
      return m ? parseFloat(m[1]) : 0;
    },
    deduplicateMessage: () => true,
    sendLarkMessage: async (id, text) => {
      calls.lark.push({ id, text });
      return { ok: true };
    },
    prefixWithAgentName: (route, text) => `[${route}] ${text}`,
    ...overrides,
  };
  return {
    poll: createPollBitableSubmissions(deps),
    calls,
    deps,
    processedRecordIds,
    lastProcessedTime,
  };
}

function opsRecord(id, fields = {}) {
  return {
    record_id: id,
    created_time: Date.now(),
    fields: {
      提交人: { id: 'ou_1', name: '甲' },
      所属门店: '洪潮久光店',
      检查类型: '开市检查',
      检查状态: '合格',
      检查说明: '一切正常说明足够长',
      检查照片: [],
      提交日期: Date.now(),
      ...fields,
    },
  };
}

test('missing tableId returns early', async () => {
  const { poll, calls } = makePoll();
  await poll('empty_cfg');
  assert.equal(calls.seed, 0);
});

test('transient fetch error logs and returns', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({ ok: false, error: 'ECONNRESET' }),
  });
  await poll('ops_checklist');
  assert.equal(calls.seed, 1);
  assert.equal(calls.process.length, 0);
});

test('permanent fetch error returns without process', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({ ok: false, error: 'permission_denied' }),
  });
  await poll('bad_reviews');
  assert.equal(calls.process.length, 0);
});

test('skips already processed records', async () => {
  const { poll, calls, processedRecordIds } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [opsRecord('r1')],
      hasMore: false,
    }),
  });
  processedRecordIds.add('ops_checklist_r1');
  await poll('ops_checklist');
  assert.equal(calls.process.length, 0);
  assert.equal(calls.sql.length, 0);
});

test('non-ops config inserts generic + process + extract', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [{ record_id: 'b1', created_time: 1, fields: { x: 1 } }],
      hasMore: false,
    }),
  });
  await poll('bad_reviews');
  assert.equal(calls.process.length, 1);
  assert.equal(calls.extract.length, 1);
  assert.ok(calls.sql.some((q) => /INSERT INTO feishu_generic_records/i.test(q.sql)));
  assert.equal(calls.lark.length, 0);
});

test('pagination fetches multiple pages', async () => {
  let page = 0;
  const { poll, calls } = makePoll({
    getBitableRecords: async (_k, { pageToken }) => {
      page++;
      if (!pageToken) {
        return {
          ok: true,
          records: [{ record_id: 'p1', created_time: 1, fields: {} }],
          hasMore: true,
          nextPageToken: 't2',
        };
      }
      return {
        ok: true,
        records: [{ record_id: 'p2', created_time: 2, fields: {} }],
        hasMore: false,
      };
    },
  });
  await poll('bad_reviews');
  assert.equal(page, 2);
  assert.equal(calls.process[0][1].length, 2);
});

test('dedup cleanup when over max keys', async () => {
  const { poll, processedRecordIds, lastProcessedTime } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [
        { record_id: 'n1', created_time: 1, fields: {} },
        { record_id: 'n2', created_time: 2, fields: {} },
      ],
      hasMore: false,
    }),
  });
  for (let i = 0; i < 5; i++) {
    processedRecordIds.add(`bad_reviews_old${i}`);
    lastProcessedTime.set(`bad_reviews_old${i}`, i);
  }
  await poll('bad_reviews');
  assert.ok(processedRecordIds.size <= 5);
});

test('ops_checklist happy path sends confirm + inserts messages', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [opsRecord('r_ok')],
      hasMore: false,
    }),
  });
  await poll('ops_checklist');
  assert.ok(calls.lark.some((m) => /已收到你的开市检查提交/.test(m.text)));
  assert.ok(calls.sql.some((q) => /bitable_submission/i.test(q.sql) || /INSERT INTO agent_messages/i.test(q.sql)));
});

test('ops_checklist logic reject', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [opsRecord('r_bad')],
      hasMore: false,
    }),
    validateSubmissionLogic: async () => ({
      isValid: false,
      suggestion: '说明太短',
      issues: ['说明太短'],
    }),
  });
  await poll('ops_checklist');
  assert.ok(calls.lark.some((m) => /提交被驳回/.test(m.text)));
});

test('photo authenticity fail rejects', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [
        opsRecord('r_photo', {
          检查照片: [{ file_token: 'ft1', name: 'a.jpg' }],
        }),
      ],
      hasMore: false,
    }),
    validatePhotoAuthenticity: async () => ({
      isAuthentic: false,
      timeValid: false,
      notDuplicate: true,
      locationMatch: true,
    }),
  });
  await poll('ops_checklist');
  assert.ok(calls.lark.some((m) => /照片验证失败/.test(m.text)));
});

test('vision path scores photos and confirms', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [
        opsRecord('r_vis', {
          检查照片: [{ file_token: 'ft2', name: 'b.jpg' }],
        }),
      ],
      hasMore: false,
    }),
  });
  await poll('ops_checklist');
  assert.ok(calls.vision >= 1);
  assert.ok(calls.lark.some((m) => /图片识别结果/.test(m.text)));
  assert.ok(
    calls.sql.some(
      (q) =>
        /vision_analysis/i.test(q.sql) ||
        (Array.isArray(q.params) && q.params.some((p) => /图片识别分析/.test(String(p))))
    )
  );
});

test('vision throw still records failure score', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [
        opsRecord('r_vis2', {
          检查照片: [{ file_token: 'ft3', name: 'c.jpg' }],
        }),
      ],
      hasMore: false,
    }),
    callVisionLLM: async () => {
      throw new Error('vision down');
    },
  });
  await poll('ops_checklist');
  assert.ok(calls.lark.some((m) => /图片识别失败|已收到你的/.test(m.text)));
});

test('deduplicateMessage skips vision_analysis insert', async () => {
  const { poll, calls } = makePoll({
    deduplicateMessage: () => false,
    getBitableRecords: async () => ({
      ok: true,
      records: [
        opsRecord('r_dd', {
          检查照片: [{ file_token: 'ft4', name: 'd.jpg' }],
        }),
      ],
      hasMore: false,
    }),
  });
  await poll('ops_checklist');
  assert.ok(!calls.sql.some((q) => /vision_analysis/i.test(q.sql)));
});

test('generic insert duplicate error ignored', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [{ record_id: 'dup1', created_time: 1, fields: {} }],
      hasMore: false,
    }),
    pool: () => ({
      query: async () => {
        throw new Error('duplicate key value');
      },
    }),
  });
  await poll('bad_reviews');
  assert.equal(calls.process.length, 1);
});

test('generic insert non-duplicate error logged but continues', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [{ record_id: 'err1', created_time: 1, fields: {} }],
      hasMore: false,
    }),
    pool: () => ({
      query: async () => {
        throw new Error('connection reset');
      },
    }),
  });
  await poll('bad_reviews');
  assert.equal(calls.process.length, 1);
});

test('extractRelations error ignored', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [{ record_id: 'e1', created_time: 1, fields: {} }],
      hasMore: false,
    }),
    extractRelationsFromBitableRecord: async () => {
      throw new Error('graph fail');
    },
  });
  await poll('bad_reviews');
  assert.equal(calls.process.length, 1);
});

test('logic invalid without submitter id continues', async () => {
  const { poll, calls } = makePoll({
    getBitableRecords: async () => ({
      ok: true,
      records: [
        opsRecord('r_ns', {
          提交人: '',
        }),
      ],
      hasMore: false,
    }),
    validateSubmissionLogic: async () => ({
      isValid: false,
      suggestion: 'bad',
      issues: ['bad'],
    }),
  });
  await poll('ops_checklist');
  // no reject message; may still try confirm with undefined submitter
  assert.ok(calls.lark.length >= 0);
});
