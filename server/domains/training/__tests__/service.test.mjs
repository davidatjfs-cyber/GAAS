import test from 'node:test';
import assert from 'node:assert/strict';
import { __setPoolForTests } from '../shared.js';
import {
  getPromotionRequiredTopics,
  getPromotionTrackProgress,
  getMyDevelopmentMap,
  getCrossTrackTechnicianStatus,
} from '../service.js';

function makePool(handler) {
  return {
    query: async (sql, params) => {
      if (handler) return handler(sql, params);
      return { rows: [] };
    },
  };
}

test.afterEach(() => {
  __setPoolForTests(null);
});

test('getPromotionRequiredTopics: empty position → []', async () => {
  __setPoolForTests(makePool());
  assert.deepEqual(await getPromotionRequiredTopics(''), []);
  assert.deepEqual(await getPromotionRequiredTopics(null), []);
});

test('getPromotionRequiredTopics: level filter passes level param to query', async () => {
  const queries = [];
  __setPoolForTests(
    makePool(async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM training_topics/i.test(sql)) {
        return {
          rows: [{ id: 1, title: 'T1 基础', position: '炒锅', level: 'T1' }],
        };
      }
      return { rows: [] };
    })
  );
  const topics = await getPromotionRequiredTopics('炒锅', 'T1');
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, 'T1 基础');
  const topicQuery = queries.find((q) => /FROM training_topics/i.test(q.sql));
  assert.ok(topicQuery);
  assert.ok(/level = \$5/i.test(topicQuery.sql));
  assert.equal(topicQuery.params[4], 'T1');
});

test('getPromotionTrackProgress: empty username / empty ids', async () => {
  __setPoolForTests(makePool());
  const emptyUser = await getPromotionTrackProgress('', [1, 2]);
  assert.deepEqual(emptyUser, { total: 2, certifiedCount: 0, passed: false, items: [] });

  const emptyIds = await getPromotionTrackProgress('alice', []);
  assert.deepEqual(emptyIds, { total: 0, certifiedCount: 0, passed: true, items: [] });

  const bothEmpty = await getPromotionTrackProgress('', []);
  assert.deepEqual(bothEmpty, { total: 0, certifiedCount: 0, passed: true, items: [] });
});

test('getPromotionTrackProgress: certified rows with manager_verdict passed', async () => {
  __setPoolForTests(
    makePool(async (sql) => {
      if (/FROM training_topics t/i.test(sql)) {
        return {
          rows: [
            {
              topic_id: 10,
              title: '刀工基础',
              manager_verdict: 'passed',
              review_status: 'done',
              valid_until: '2027-01-01',
              cert_status: 'valid',
              legacy_accepted: false,
              certified_at: '2026-06-01',
            },
            {
              topic_id: 11,
              title: '火候控制',
              manager_verdict: 'failed',
              review_status: 'done',
              valid_until: null,
              cert_status: 'valid',
              legacy_accepted: false,
              certified_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    })
  );
  const prog = await getPromotionTrackProgress('chef1', [10, 11]);
  assert.equal(prog.total, 2);
  assert.equal(prog.certifiedCount, 1);
  assert.equal(prog.passed, false);
  assert.equal(prog.items[0].certified, true);
  assert.equal(prog.items[0].title, '刀工基础');
  assert.equal(prog.items[1].certified, false);
});

test('getPromotionTrackProgress: all certified → passed true', async () => {
  __setPoolForTests(
    makePool(async (sql) => {
      if (/FROM training_topics t/i.test(sql)) {
        return {
          rows: [
            {
              topic_id: 20,
              title: '出品标准',
              manager_verdict: 'passed',
              cert_status: 'valid',
              legacy_accepted: false,
              valid_until: null,
              certified_at: '2026-07-01',
            },
          ],
        };
      }
      return { rows: [] };
    })
  );
  const prog = await getPromotionTrackProgress('chef2', [20]);
  assert.equal(prog.certifiedCount, 1);
  assert.equal(prog.passed, true);
});

test('getMyDevelopmentMap: empty username → null', async () => {
  __setPoolForTests(makePool());
  assert.equal(await getMyDevelopmentMap(''), null);
  assert.equal(await getMyDevelopmentMap(null), null);
});

test('getMyDevelopmentMap: kitchen position with ladder progress', async () => {
  __setPoolForTests(
    makePool(async (sql, params) => {
      if (/FROM employees WHERE username/i.test(sql)) {
        return {
          rows: [{ position: '炒锅', extra_json: { level: 'T1' } }],
        };
      }
      if (/FROM training_topics/i.test(sql) && /promotion_required/i.test(sql)) {
        const level = params[params.length - 1];
        if (level === 'T1') {
          return { rows: [{ id: 101, title: 'T1 能力A' }, { id: 102, title: 'T1 能力B' }] };
        }
        if (level === 'T2') {
          return { rows: [{ id: 201, title: 'T2 能力A' }] };
        }
        return { rows: [] };
      }
      if (/FROM training_topics t/i.test(sql)) {
        const ids = params[1];
        if (ids.includes(101) && ids.includes(102)) {
          return {
            rows: [
              { topic_id: 101, title: 'T1 能力A', manager_verdict: 'passed', cert_status: 'valid', legacy_accepted: false, valid_until: null, certified_at: '2026-06-01' },
              { topic_id: 102, title: 'T1 能力B', manager_verdict: 'passed', cert_status: 'valid', legacy_accepted: false, valid_until: null, certified_at: '2026-06-02' },
            ],
          };
        }
        if (ids.includes(201)) {
          return {
            rows: [
              { topic_id: 201, title: 'T2 能力A', manager_verdict: null, cert_status: 'valid', legacy_accepted: false, valid_until: null, certified_at: null },
            ],
          };
        }
      }
      return { rows: [] };
    })
  );
  const map = await getMyDevelopmentMap('wok-chef');
  assert.ok(map);
  assert.equal(map.position, '炒锅');
  assert.equal(map.currentLevel, 'T1');
  assert.equal(map.ladder.length, 2);
  assert.equal(map.ladder[0].level, 'T1');
  assert.equal(map.ladder[0].complete, true);
  assert.equal(map.ladder[0].isCurrent, true);
  assert.equal(map.ladder[1].level, 'T2');
  assert.equal(map.ladder[1].complete, false);
  assert.equal(map.path.type, 'kitchen');
  assert.ok(map.nextStep.includes('T2'));
  assert.deepEqual(map.cta, { text: '要升职，先培训', action: 'promotion' });
});

test('getCrossTrackTechnicianStatus: tracks progress and eligibility', async () => {
  const passedTop = new Set(['炒锅']);
  const passedL2 = new Set(['砧板']);
  __setPoolForTests(
    makePool(async (sql, params) => {
      if (/FROM training_topics/i.test(sql) && /promotion_required/i.test(sql)) {
        const track = params[0];
        const level = params[params.length - 1];
        const idBase = track.charCodeAt(0) * 10 + (level === 'T2' ? 2 : 1);
        return { rows: [{ id: idBase, title: `${track}-${level}`, position: track, level }] };
      }
      if (/FROM training_topics t/i.test(sql)) {
        const username = params[0];
        const ids = params[1];
        assert.equal(username, 'cross-chef');
        const id = ids[0];
        let track = '';
        for (const t of ['炒锅', '砧板', '烧味/卤水', '刺身']) {
          if (id === t.charCodeAt(0) * 10 + 1 || id === t.charCodeAt(0) * 10 + 2) track = t;
        }
        const isTop = id % 10 === 2;
        const passed = isTop ? passedTop.has(track) : passedL2.has(track);
        return {
          rows: [{
            topic_id: id,
            title: `topic-${id}`,
            manager_verdict: passed ? 'passed' : null,
            cert_status: 'valid',
            legacy_accepted: false,
            valid_until: null,
            certified_at: passed ? '2026-07-01' : null,
          }],
        };
      }
      return { rows: [] };
    })
  );
  const status = await getCrossTrackTechnicianStatus('cross-chef');
  assert.ok(status.tracks);
  assert.ok(Array.isArray(status.topTracks));
  assert.deepEqual(status.topTracks, ['炒锅']);
  assert.equal(status.tracks['炒锅'].topPassed, true);
  assert.equal(status.tracks['砧板'].l2Passed, true);
  assert.equal(status.eligible, true);
});
