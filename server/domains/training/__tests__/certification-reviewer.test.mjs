import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_ASSIGN_SOURCES,
  canUserReviewCertification,
  resolveCertificationReviewers,
  resolveStoreTrainingReviewer,
} from '../certification-reviewer.js';

function mockPool(handlers) {
  return {
    query: async (sql, params) => {
      for (const h of handlers) {
        const out = h(sql, params);
        if (out !== undefined) return out;
      }
      return { rows: [] };
    },
  };
}

test('AUTO_ASSIGN_SOURCES includes promotion_qualification', () => {
  assert.ok(AUTO_ASSIGN_SOURCES.has('promotion_qualification'));
});

test('resolveStoreTrainingReviewer returns store production manager', async () => {
  const pool = mockPool([
    (sql) => {
      if (/SELECT store FROM employees/i.test(sql)) {
        return { rows: [{ store: '洪潮大宁久光店' }] };
      }
      if (/role IN/i.test(sql)) {
        return { rows: [{ username: 'NNYXWSB39', position: '出品经理' }] };
      }
    },
  ]);
  const u = await resolveStoreTrainingReviewer(pool, 'NNYXTZ23', 'default');
  assert.equal(u, 'NNYXWSB39');
});

test('canUserReviewCertification: assigned_by match', async () => {
  const pool = mockPool([
    (sql) => {
      if (/FROM training_assignments/i.test(sql)) {
        return {
          rows: [{
            assigned_by: 'NNYXWSB39',
            source: 'promotion_qualification',
            related_track_id: 't1',
          }],
        };
      }
    },
  ]);
  const ok = await canUserReviewCertification(pool, {
    reviewerUsername: 'NNYXWSB39',
    reviewerRole: 'store_production_manager',
    employeeUsername: 'NNYXTZ23',
    topicId: 27,
    tenantId: 'default',
  });
  assert.equal(ok, true);
});

test('canUserReviewCertification: auto-assign fallback to same-store manager', async () => {
  const pool = mockPool([
    (sql, params) => {
      if (/FROM training_assignments/i.test(sql)) {
        return { rows: [{ assigned_by: null, source: 'promotion_qualification' }] };
      }
      if (/SELECT store FROM employees/i.test(sql) && params?.[0] === 'NNYXTZ23') {
        return { rows: [{ store: '洪潮大宁久光店' }] };
      }
      if (/role IN/i.test(sql) && /LIMIT 1/.test(sql) && params?.[0] === '洪潮大宁久光店') {
        return { rows: [{ username: 'NNYXWSB39' }] };
      }
      if (/JOIN employees re ON re.store = ce.store/i.test(sql)) {
        return { rows: [{ '?column?': 1 }] };
      }
    },
  ]);
  const ok = await canUserReviewCertification(pool, {
    reviewerUsername: 'NNYXWSB39',
    reviewerRole: 'store_production_manager',
    employeeUsername: 'NNYXTZ23',
    topicId: 28,
  });
  assert.equal(ok, true);
});

test('resolveCertificationReviewers merges assigned_by and fallback', async () => {
  const pool = mockPool([
    (sql, _params) => {
      if (/FROM training_assignments/i.test(sql)) {
        return { rows: [{ assigned_by: 'mentor1', source: 'promotion_qualification' }] };
      }
      if (/SELECT store FROM employees/i.test(sql)) {
        return { rows: [{ store: '测试店' }] };
      }
      if (/role IN/i.test(sql)) {
        return { rows: [{ username: 'pm1' }] };
      }
    },
  ]);
  const out = await resolveCertificationReviewers(pool, {
    employeeUsername: 'emp1',
    topicId: 1,
  });
  assert.deepEqual(out.reviewers.sort(), ['mentor1', 'pm1'].sort());
});
