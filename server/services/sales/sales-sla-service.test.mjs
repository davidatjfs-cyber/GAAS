import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySlaStatus } from './sales-sla-service.js';

test('SLA status transitions are deterministic', () => {
  const now = new Date('2026-07-14T00:00:00Z');
  assert.equal(classifySlaStatus({}, now), 'not_required');
  assert.equal(classifySlaStatus({ slaDueAt: '2026-07-14T00:05:00Z', now }), 'open');
  assert.equal(classifySlaStatus({ slaDueAt: '2026-07-14T00:05:00Z', firstHumanResponseAt: '2026-07-14T00:04:00Z', now }), 'met');
  assert.equal(classifySlaStatus({ slaDueAt: '2026-07-13T23:59:00Z', now }), 'breached');
});
