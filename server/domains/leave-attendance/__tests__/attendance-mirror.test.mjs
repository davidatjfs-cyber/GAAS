import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceMirrorHelpers } from '../attendance-mirror.js';

test('upsertEmployeeAttendanceMirrorFromCheckinRow no-ops without id', async () => {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
    },
  };
  const { upsertEmployeeAttendanceMirrorFromCheckinRow } = createAttendanceMirrorHelpers({ pool });
  await upsertEmployeeAttendanceMirrorFromCheckinRow(null, 'default');
  await upsertEmployeeAttendanceMirrorFromCheckinRow({}, 'default');
  assert.equal(calls, 0);
});

test('upsertEmployeeAttendanceMirrorFromCheckinRow inserts with tenant default', async () => {
  let sql = '';
  let params = null;
  const pool = {
    async query(q, p) {
      sql = q;
      params = p;
    },
  };
  const { upsertEmployeeAttendanceMirrorFromCheckinRow } = createAttendanceMirrorHelpers({ pool });
  const rec = {
    id: 'id-1',
    username: 'alice',
    store: '马己仙',
    type: 'clock_in',
    check_time: '2026-07-24T09:00:00+08:00',
    latitude: 1,
    longitude: 2,
    distance_meters: 10,
    face_match: true,
    face_score: 0.9,
    photo_url: '/p.jpg',
    status: 'ok',
    note: null,
    confirmed_by: null,
    confirmed_at: null,
    created_at: '2026-07-24T09:00:01+08:00',
  };
  await upsertEmployeeAttendanceMirrorFromCheckinRow(rec);
  assert.match(sql, /INSERT INTO employee_attendance_records/);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.equal(params[0], 'id-1');
  assert.equal(params[1], 'alice');
  assert.equal(params[16], 'default');
});

test('upsertEmployeeAttendanceMirrorFromCheckinRow passes tenantId', async () => {
  let params = null;
  const pool = {
    async query(_q, p) {
      params = p;
    },
  };
  const { upsertEmployeeAttendanceMirrorFromCheckinRow } = createAttendanceMirrorHelpers({ pool });
  await upsertEmployeeAttendanceMirrorFromCheckinRow({ id: 'x' }, 'tenant-a');
  assert.equal(params[16], 'tenant-a');
});
