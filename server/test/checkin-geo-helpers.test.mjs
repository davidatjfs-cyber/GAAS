import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistance,
  parseCheckinRadiusMeters,
  resolveCheckinRadiusMeters,
  CHECKIN_RADIUS_DEFAULT_METERS,
} from '../domains/leave-attendance/checkin-geo.js';

test('haversineDistance is ~0 for same point', () => {
  assert.ok(haversineDistance(31.23, 121.47, 31.23, 121.47) < 1);
});

test('haversineDistance grows with separation', () => {
  const near = haversineDistance(31.23, 121.47, 31.2301, 121.47);
  const far = haversineDistance(31.23, 121.47, 31.24, 121.47);
  assert.ok(far > near);
  assert.ok(far > 100);
});

test('parseCheckinRadiusMeters clamps and rejects', () => {
  assert.equal(parseCheckinRadiusMeters(''), null);
  assert.equal(parseCheckinRadiusMeters(null), null);
  assert.equal(parseCheckinRadiusMeters(5), null);
  assert.equal(parseCheckinRadiusMeters(50), 50);
  assert.equal(parseCheckinRadiusMeters(5000), 2000);
  assert.equal(parseCheckinRadiusMeters('120.6'), 121);
});

test('resolveCheckinRadiusMeters priority: env > state > store > default', () => {
  const prev = process.env.CHECKIN_MAX_DISTANCE_METERS;
  try {
    delete process.env.CHECKIN_MAX_DISTANCE_METERS;
    assert.equal(resolveCheckinRadiusMeters(null, null), CHECKIN_RADIUS_DEFAULT_METERS);
    assert.equal(
      resolveCheckinRadiusMeters({ checkinRadiusMeters: 80 }, null),
      80
    );
    assert.equal(
      resolveCheckinRadiusMeters({ checkin_radius_meters: 90 }, { checkinMaxDistanceMeters: 150 }),
      150
    );
    process.env.CHECKIN_MAX_DISTANCE_METERS = '200';
    assert.equal(
      resolveCheckinRadiusMeters({ checkinRadiusMeters: 80 }, { checkinMaxDistanceMeters: 150 }),
      200
    );
  } finally {
    if (prev === undefined) delete process.env.CHECKIN_MAX_DISTANCE_METERS;
    else process.env.CHECKIN_MAX_DISTANCE_METERS = prev;
  }
});
