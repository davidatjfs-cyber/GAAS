import assert from 'node:assert/strict';
import {
  classifyIncidentQueue,
  suggestedHealAction,
  syncIncidentsFromInspections,
  listIncidents,
  healIncident,
  escalateIncident,
  routeInspectionItemToIncident,
  HEAL_ACTIONS,
} from './services/tenant-health-incident-service.js';

{
  assert.equal(classifyIncidentQueue({ item_key: 'manager_confirmed_tasks', responsible_party: 'store_manager', owner_role: '店长' }), 'customer');
  assert.equal(classifyIncidentQueue({ item_key: 'yesterday_orders_synced', responsible_party: 'platform_team', owner_role: '实施人员' }), 'third_party');
  assert.equal(classifyIncidentQueue({ item_key: 'ai_tasks_generated', responsible_party: 'system', owner_role: '系统' }), 'eng');
  assert.equal(classifyIncidentQueue({ item_key: 'store_business_hours', responsible_party: 'platform_team', owner_role: '实施人员' }), 'cs_ops');
  assert.equal(suggestedHealAction('manager_roles_configured', 'customer'), 'notify_customer');
  assert.ok(HEAL_ACTIONS.rerun_inspection);
  console.log('ok classify');
}

function makePool() {
  const incidents = new Map();
  let seq = 1;
  return {
    incidents,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS tenant_health_incidents') || text.includes('CREATE INDEX IF NOT EXISTS idx_thi')) {
        return { rows: [] };
      }
      if (text.includes('information_schema.tables')) return { rows: [{ ok: 1 }] };
      if (text.includes('FROM tenants')) return { rows: [{ tenant_id: 't1' }] };
      if (text.includes('FROM tenant_operation_inspection_runs')) return { rows: [{ id: 9 }] };
      if (text.includes('FROM tenant_operation_inspection_items WHERE run_id')) {
        return {
          rows: [
            {
              id: 101, run_id: 9, tenant_id: 't1', item_key: 'manager_confirmed_tasks', item_name: '门店负责人是否确认',
              status: '缺失', severity: 'P1', owner_role: '店长', responsible_party: 'store_manager',
              impact_modules: ['任务闭环'], suggestion: '请店长确认', evidence: {},
            },
            {
              id: 102, run_id: 9, tenant_id: 't1', item_key: 'ai_tasks_generated', item_name: 'AI建议是否生成',
              status: '缺失', severity: 'P0', owner_role: '系统', responsible_party: 'system_integration',
              impact_modules: ['任务闭环'], suggestion: '检查 Agent', evidence: {},
            },
          ],
        };
      }
      if (text.includes('INSERT INTO tenant_health_incidents')) {
        const fingerprint = params[12] || params[params.length - 1];
        const tenantId = params[0];
        const key = `${tenantId}::${fingerprint}`;
        const existing = [...incidents.values()].find((x) => x.tenant_id === tenantId && x.fingerprint === fingerprint);
        if (existing) {
          Object.assign(existing, { suggestion: params[10], updated_at: new Date().toISOString() });
          return { rows: [{ ...existing, inserted: false }] };
        }
        const row = {
          id: seq++,
          tenant_id: tenantId,
          inspection_item_id: params[1],
          run_id: params[2],
          item_key: params[3],
          item_name: params[4],
          severity: params[5],
          status: 'open',
          queue: params[6],
          owner_role: params[7],
          responsible_party: params[8],
          impact_modules: JSON.parse(params[9] || '[]'),
          suggestion: params[10],
          faq_id: params[11],
          fingerprint,
          heal_result: null,
        };
        incidents.set(row.id, row);
        return { rows: [{ ...row, inserted: true }] };
      }
      if (text.includes('FROM tenant_health_incidents') && text.includes('GROUP BY queue')) {
        const counts = {};
        for (const row of incidents.values()) {
          if (!['open', 'acked', 'healing', 'escalated'].includes(row.status)) continue;
          const k = `${row.queue}|${row.status}`;
          counts[k] = (counts[k] || 0) + 1;
        }
        return {
          rows: Object.entries(counts).map(([k, cnt]) => {
            const [queue, status] = k.split('|');
            return { queue, status, cnt };
          }),
        };
      }
      if (text.includes('FROM tenant_health_incidents') && text.includes('handled_today')) {
        return { rows: [{ handled_today: 0, heal_attempts_today: 0, heal_ok_today: 0, escalated_today: 0, resolved_today: 0, sla_breached_open: 0 }] };
      }
      if (text.includes('FROM tenant_health_incidents') && text.includes("INTERVAL '24 hours'") && text.includes('COUNT')) {
        return { rows: [{ cnt: 0 }] };
      }
      if (text.includes('FROM tenant_health_incidents') && text.includes('WHERE id=')) {
        const id = Number(params[0]);
        const row = incidents.get(id);
        return { rows: row ? [row] : [] };
      }
      if (text.includes('FROM tenant_health_incidents')) {
        let rows = [...incidents.values()];
        const queue = params[0];
        const status = params[1];
        const tenantId = params[2];
        if (queue) rows = rows.filter((r) => r.queue === queue);
        if (status === 'open') rows = rows.filter((r) => ['open', 'acked', 'healing', 'escalated'].includes(r.status));
        else if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
        if (tenantId) rows = rows.filter((r) => r.tenant_id === tenantId);
        return { rows };
      }
      if (text.includes('UPDATE tenant_health_incidents') && text.includes("status='escalated'")) {
        const id = Number(params[0]);
        const row = incidents.get(id);
        if (!row) return { rows: [] };
        Object.assign(row, { status: 'escalated', queue: 'eng', escalated_at: new Date().toISOString() });
        return { rows: [row] };
      }
      if (text.includes('UPDATE tenant_health_incidents') && text.includes("status='healing'")) {
        const id = Number(params[0]);
        const row = incidents.get(id);
        if (row) row.status = 'healing';
        return { rows: row ? [row] : [] };
      }
      if (text.includes('UPDATE tenant_health_incidents') && text.includes('heal_result')) {
        const id = Number(params[0]);
        const row = incidents.get(id);
        if (!row) return { rows: [] };
        row.status = params[1];
        row.heal_action = params[2];
        row.heal_result = JSON.parse(params[3] || '{}');
        return { rows: [row] };
      }
      if (text.includes('UPDATE tenant_health_incidents')) {
        const id = Number(params[0]);
        const row = incidents.get(id);
        return { rows: row ? [row] : [] };
      }
      if (text.includes('FROM users')) return { rows: [{ username: 'admin_t1' }] };
      if (text.includes('INSERT INTO hrms_user_notifications')) {
        return { rows: [{ id: 900 + seq }] };
      }
      if (text.includes('FROM growth_delivery_logs')) {
        return { rows: [{ status: 'failed', cnt: 3, last_at: null, sample_error: 'timeout' }, { status: 'sent', cnt: 1, last_at: null, sample_error: '' }] };
      }
      return { rows: [] };
    },
  };
}

{
  const pool = makePool();
  const sync = await syncIncidentsFromInspections(pool, { tenantId: 't1' });
  assert.equal(sync.ok, true);
  assert.ok(sync.touched >= 2);
  const listed = await listIncidents(pool, { status: 'open' });
  assert.equal(listed.ok, true);
  assert.ok(listed.summary.open_total >= 2);
  const customer = listed.items.filter((x) => x.queue === 'customer');
  const eng = listed.items.filter((x) => x.queue === 'eng');
  assert.ok(customer.length >= 1);
  assert.ok(eng.length >= 1);
  console.log('ok sync+list');
}

{
  const pool = makePool();
  await syncIncidentsFromInspections(pool, { tenantId: 't1' });
  const listed = await listIncidents(pool, { queue: 'customer' });
  const id = listed.items[0].id;
  const healed = await healIncident(pool, id, { action: 'notify_customer' });
  assert.equal(healed.ok, true);
  assert.equal(healed.action, 'notify_customer');
  assert.equal(healed.result.notified, 1);
  assert.ok(listed.ops_stats);
  console.log('ok heal notify');
}

{
  assert.equal(suggestedHealAction('sms_wecom_sent', 'third_party'), 'audit_delivery_failures');
  assert.equal(suggestedHealAction('ai_tasks_generated', 'eng'), 'generate_report');
  assert.ok(HEAL_ACTIONS.notify_ops);
  assert.ok(HEAL_ACTIONS.audit_delivery_failures);
  const pool = makePool();
  await syncIncidentsFromInspections(pool, { tenantId: 't1' });
  // 造一条触达失败类工单
  const routed = await routeInspectionItemToIncident(pool, {
    item: {
      id: 88,
      tenant_id: 't1',
      run_id: 9,
      item_key: 'sms_wecom_sent',
      item_name: '短信发送',
      severity: 'P1',
      owner_role: '实施人员',
      responsible_party: 'platform_team',
      impact_modules: ['自动营销'],
      suggestion: '检查发送',
    },
  });
  const healed = await healIncident(pool, routed.incident.id, { action: 'audit_delivery_failures' });
  if (!healed.result?.summary) {
    console.error('audit heal debug', healed);
  }
  assert.equal(healed.ok, true);
  assert.equal(healed.action, 'audit_delivery_failures');
  assert.ok(healed.result?.summary);
  console.log('ok audit delivery');
}

{
  const { isSlaBreached } = await import('./services/tenant-health-incident-service.js');
  assert.equal(isSlaBreached({ status: 'open', acked_at: null, created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }), true);
  assert.equal(isSlaBreached({ status: 'open', acked_at: new Date().toISOString(), created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }), false);
  console.log('ok sla helper');
}

{
  const pool = makePool();
  await syncIncidentsFromInspections(pool, { tenantId: 't1' });
  const listed = await listIncidents(pool, { queue: 'eng' });
  const id = listed.items[0].id;
  const esc = await escalateIncident(pool, id, { note: 'test' });
  assert.equal(esc.ok, true);
  assert.equal(esc.incident.queue, 'eng');
  console.log('ok escalate');
}

{
  const pool = makePool();
  const routed = await routeInspectionItemToIncident(pool, {
    item: {
      id: 55,
      tenant_id: 't1',
      run_id: 9,
      item_key: 'store_business_hours',
      item_name: '营业时间',
      severity: 'P1',
      owner_role: '实施人员',
      responsible_party: 'platform_team',
      impact_modules: ['经营诊断'],
      suggestion: '配置营业时间',
    },
  });
  assert.equal(routed.ok, true);
  assert.equal(routed.queue, 'cs_ops');
  assert.equal(routed.deprecated_master_task, true);
  console.log('ok route item');
}

console.log('tenant-health-incident tests passed');
