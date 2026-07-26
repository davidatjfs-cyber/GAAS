import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnifiedCustomerTimeline } from './sales-timeline.js';

function makePool({ lead = null, events = [], stages = [], messages = [], incidents = [] } = {}) {
  return {
    query: async (sql) => {
      const s = String(sql);
      if (s.includes('FROM sales_leads WHERE id=$1')) {
        return { rows: lead ? [lead] : [] };
      }
      if (s.includes('FROM sales_lead_events')) return { rows: events };
      if (s.includes('FROM sales_stage_history')) return { rows: stages };
      if (s.includes('FROM sales_messages')) return { rows: messages };
      if (s.includes('FROM tenant_health_incidents')) return { rows: incidents };
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    },
  };
}

test('getUnifiedCustomerTimeline returns not_found when lead missing', async () => {
  const r = await getUnifiedCustomerTimeline(makePool({ lead: null }), 1);
  assert.deepEqual(r, { ok: false, error: 'not_found' });
});

test('getUnifiedCustomerTimeline merges pre-sale and post-sale events sorted', async () => {
  const pool = makePool({
    lead: { id: 9, lead_key: 'L1', tenant_id: 'tenant-1' },
    events: [{ event_type: 'ASK_PRICE', summary: '询价', priority: 'high', created_at: '2026-07-02T10:00:00Z' }],
    stages: [{ from_stage: 'new', to_stage: 'qualified', reason: 'ok', created_at: '2026-07-03T10:00:00Z' }],
    messages: [
      { direction: 'in', sender: 'customer', content: '你好', created_at: '2026-07-01T10:00:00Z' },
      { direction: 'out', sender: 'human', content: '您好', created_at: '2026-07-01T11:00:00Z' },
      { direction: 'out', sender: 'ai', content: 'AI回复', created_at: '2026-07-01T12:00:00Z' },
    ],
    incidents: [
      {
        item_name: 'POS断联',
        item_key: 'pos_data_connected',
        severity: 'P0',
        status: 'resolved',
        created_at: '2026-07-04T10:00:00Z',
        resolved_at: '2026-07-05T10:00:00Z',
      },
    ],
  });
  const r = await getUnifiedCustomerTimeline(pool, 9);
  assert.equal(r.ok, true);
  assert.equal(r.lead_key, 'L1');
  assert.equal(r.has_post_sale_data, true);
  assert.ok(r.timeline.length >= 6);
  assert.equal(r.timeline[0].kind, 'message');
  assert.ok(r.timeline.some((x) => x.kind === 'stage_change'));
  assert.ok(r.timeline.some((x) => x.kind === 'health_incident_opened'));
  assert.ok(r.timeline.some((x) => x.kind === 'health_incident_resolved'));
  for (let i = 1; i < r.timeline.length; i += 1) {
    assert.ok(new Date(r.timeline[i - 1].at) <= new Date(r.timeline[i].at));
  }
});

test('getUnifiedCustomerTimeline skips post-sale when no tenant', async () => {
  let incidentQueried = false;
  const pool = {
    query: async (sql) => {
      const s = String(sql);
      if (s.includes('FROM sales_leads WHERE id=$1')) {
        return { rows: [{ id: 2, lead_key: 'L2', tenant_id: null }] };
      }
      if (s.includes('tenant_health_incidents')) {
        incidentQueried = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const r = await getUnifiedCustomerTimeline(pool, 2);
  assert.equal(r.has_post_sale_data, false);
  assert.equal(r.timeline.length, 0);
  assert.equal(incidentQueried, false);
});
