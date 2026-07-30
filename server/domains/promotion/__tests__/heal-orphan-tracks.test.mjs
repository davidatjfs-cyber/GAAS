import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrphanPromotionTracks,
  healMissingPromotionTracks,
} from '../heal-orphan-tracks.js';

function makePool(handlers) {
  return {
    async query(sql, params) {
      const s = String(sql);
      for (const h of handlers) {
        if (h.match(s)) return h.run(sql, params);
      }
      return { rows: [] };
    },
  };
}

test('buildOrphanPromotionTracks: no orphans → empty', async () => {
  const pool = makePool([
    {
      match: (s) => /FROM training_assignments/i.test(s),
      run: () => ({
        rows: [
          {
            track_id: 'already-there',
            employee_username: 'emp1',
            topic_ids: [1, 2],
            due_date: '2026-07-01',
            created_at: new Date('2026-06-29T13:49:45Z'),
          },
        ],
      }),
    },
  ]);
  const healed = await buildOrphanPromotionTracks({
    pool,
    existingTracks: [{ id: 'already-there', approvalId: 'a1' }],
    hrmsNowISO: () => '2026-07-29T12:00:00+08:00',
  });
  assert.deepEqual(healed, []);
});

test('buildOrphanPromotionTracks: rebuilds lost track from assignment + approval', async () => {
  const pool = makePool([
    {
      match: (s) => /FROM training_assignments/i.test(s),
      run: () => ({
        rows: [
          {
            track_id: '99d0979f-7ae8-43f6-8b5e-3d0b10e90ca6',
            employee_username: 'NNYXTZ23',
            topic_ids: [27, 28, 29],
            due_date: '2026-07-01',
            created_at: new Date('2026-06-29T13:49:45Z'),
          },
        ],
      }),
    },
    {
      match: (s) => /FROM approval_requests/i.test(s),
      run: () => ({
        rows: [
          {
            id: '72dab011-1047-4507-b8be-cf27759e3e30',
            applicant_username: 'NNYXTZ23',
            updated_at: new Date('2026-06-29T13:49:45Z'),
            created_at: new Date('2026-06-29T13:43:25Z'),
            payload: {
              store: '洪潮大宁久光店',
              promoTier: 'skill_bump',
              department: '后厨',
              mentorName: '王世波',
              targetLevel: 'T1',
              currentLevel: 'T1',
              trainingDays: 3,
              promotionType: 'same',
              mentorUsername: 'NNYXWSB39',
              targetPosition: '砧板',
              currentPosition: '砧板',
              selectedTopicIds: [27, 28, 29],
              trainingStartDate: '2026-06-30',
            },
          },
        ],
      }),
    },
    {
      match: (s) => /FROM employees/i.test(s),
      run: () => ({
        rows: [
          {
            name: '田震',
            role: 'store_employee',
            position: '砧板',
            store: '洪潮大宁久光店',
            department: '后厨',
          },
        ],
      }),
    },
  ]);

  const healed = await buildOrphanPromotionTracks({
    pool,
    existingTracks: [],
    hrmsNowISO: () => '2026-07-29T12:00:00+08:00',
  });
  assert.equal(healed.length, 1);
  assert.equal(healed[0].id, '99d0979f-7ae8-43f6-8b5e-3d0b10e90ca6');
  assert.equal(healed[0].applicantUsername, 'NNYXTZ23');
  assert.equal(healed[0].applicantName, '田震');
  assert.equal(healed[0].status, 'qualification_approved');
  assert.equal(healed[0].formalApplied, false);
  assert.deepEqual(healed[0].requiredTopicIds, [27, 28, 29]);
  assert.equal(healed[0].targetPosition, '砧板');
  assert.equal(healed[0].mentorUsername, 'NNYXWSB39');
});

test('healMissingPromotionTracks: merges healed tracks', async () => {
  const mergeCalls = [];
  const pool = makePool([
    {
      match: (s) => /FROM training_assignments/i.test(s),
      run: () => ({
        rows: [
          {
            track_id: 'trk-new',
            employee_username: 'u1',
            topic_ids: [9],
            due_date: '2026-07-10',
            created_at: new Date('2026-07-01T00:00:00Z'),
          },
        ],
      }),
    },
    {
      match: (s) => /FROM approval_requests/i.test(s),
      run: () => ({
        rows: [
          {
            id: 'appr-1',
            applicant_username: 'u1',
            payload: { targetPosition: '炒锅', targetLevel: 'T2', promoTier: 'skill_bump' },
            updated_at: new Date(),
            created_at: new Date(),
          },
        ],
      }),
    },
    {
      match: (s) => /FROM employees/i.test(s),
      run: () => ({ rows: [{ name: '甲', role: 'store_employee', position: '炒锅', store: 'A', department: '后厨' }] }),
    },
  ]);

  const next = await healMissingPromotionTracks({
    pool,
    state: { promotionTracks: [{ id: 'old' }] },
    mergeSharedStateFields: async (fields, keys) => {
      mergeCalls.push({ fields, keys });
    },
    hrmsNowISO: () => '2026-07-29T12:00:00+08:00',
  });
  assert.equal(next.length, 2);
  assert.equal(next[0].id, 'trk-new');
  assert.equal(mergeCalls.length, 1);
  assert.equal(mergeCalls[0].keys.promotionTracks, 'id');
});

test('healMissingPromotionTracks: skips when approval already has track', async () => {
  const pool = makePool([
    {
      match: (s) => /FROM training_assignments/i.test(s),
      run: () => ({
        rows: [
          {
            track_id: 'orphan-old-id',
            employee_username: 'u2',
            topic_ids: [1],
            due_date: '2026-07-01',
            created_at: new Date(),
          },
        ],
      }),
    },
    {
      match: (s) => /FROM approval_requests/i.test(s),
      run: () => ({
        rows: [{ id: 'appr-existing', applicant_username: 'u2', payload: {}, updated_at: new Date(), created_at: new Date() }],
      }),
    },
  ]);
  const healed = await buildOrphanPromotionTracks({
    pool,
    existingTracks: [{ id: 'current-track', approvalId: 'appr-existing', applicantUsername: 'u2' }],
    hrmsNowISO: () => '2026-07-29T12:00:00+08:00',
  });
  assert.deepEqual(healed, []);
});
