/**
 * Master Agent route handlers (extracted from registerMasterRoutes).
 */
import {
  buildMasterEvidenceCsv,
  DATA_SOURCE_HEALTH_TABLES,
  DATA_SOURCE_HEALTH_TIME_COLUMNS,
  summarizeEvidenceExport,
} from './route-helpers.js';

function hqRolesForbidden(req, res) {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) {
    res.status(403).json({ error: 'forbidden' });
    return true;
  }
  return false;
}

export function createMasterDashboardHandler({ pool, statusFlow }) {
  return async (req, res) => {
    if (hqRolesForbidden(req, res)) return;
    try {
      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      const [tasksR, eventsR] = await Promise.all([
        pool().query(
          `
          SELECT status, COUNT(*) as cnt,
                 COUNT(*) FILTER (WHERE severity='high') as high_cnt
          FROM master_tasks
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND tenant_id = $1
          GROUP BY status ORDER BY status
        `,
          [tenantIdQ]
        ),
        pool().query(
          `SELECT COUNT(*) as total FROM master_events WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1`,
          [tenantIdQ]
        ),
      ]);

      const statusCounts = {};
      for (const row of tasksR.rows || []) {
        statusCounts[row.status] = {
          total: Number(row.cnt),
          high: Number(row.high_cnt),
        };
      }

      return res.json({
        tasks: statusCounts,
        events_7d: Number(eventsR.rows?.[0]?.total || 0),
        stateMachine: statusFlow,
      });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createMasterTaskListHandler({ pool }) {
  return async (req, res) => {
    const role = String(req.user?.role || '').trim();
    const username = String(req.user?.username || '').trim();
    const status = String(req.query?.status || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    try {
      const where = ['1=1'];
      const params = [];
      const push = (v) => {
        params.push(v);
        return `$${params.length}`;
      };

      if (['store_manager', 'store_production_manager'].includes(role)) {
        where.push(`assignee_username = ${push(username)}`);
      }
      if (status && status !== 'all') where.push(`status = ${push(status)}`);
      where.push(
        `tenant_id = ${push(req.tenantId || req.user?.tenant_id || 'default')}`
      );

      const r = await pool().query(
        `SELECT * FROM master_tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${push(limit)}`,
        params
      );
      return res.json({ items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createDataSourceHealthHandler({ pool }) {
  return async (req, res) => {
    if (hqRolesForbidden(req, res)) return;
    const hours = Math.max(1, Math.min(24 * 30, Number(req.query?.hours) || 24));
    const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
    try {
      const tableCounts = [];
      for (const table of DATA_SOURCE_HEALTH_TABLES) {
        const timeCol = DATA_SOURCE_HEALTH_TIME_COLUMNS[table] || 'created_at';
        const tenantClause = table === 'master_tasks' ? ' AND tenant_id = $2' : '';
        const r = await pool().query(
          `SELECT COUNT(*)::int AS cnt, MAX(${timeCol}) AS latest
             FROM ${table}
            WHERE ${timeCol} >= NOW() - ($1::text || ' hours')::interval${tenantClause}`,
          tenantClause ? [String(hours), tenantIdQ] : [String(hours)]
        );
        tableCounts.push({
          table,
          rows: Number(r.rows?.[0]?.cnt || 0),
          latest: r.rows?.[0]?.latest || null,
          ok: Number(r.rows?.[0]?.cnt || 0) > 0,
        });
      }

      const issueR = await pool().query(
        `SELECT
           COALESCE(details::jsonb->>'dataSourceType', 'unknown') AS data_source,
           COALESCE(context->>'store', '') AS store,
           COUNT(*)::int AS issue_count,
           MAX(created_at) AS latest
         FROM agent_issues_reports
         WHERE issue_type = 'DATA_SOURCE_INSUFFICIENT'
           AND created_at >= NOW() - ($1::text || ' hours')::interval
           AND tenant_id = $2
         GROUP BY COALESCE(details::jsonb->>'dataSourceType', 'unknown'), COALESCE(context->>'store', '')
         ORDER BY issue_count DESC, data_source ASC, store ASC
         LIMIT 200`,
        [String(hours), tenantIdQ]
      );

      return res.json({
        windowHours: hours,
        generatedAt: new Date().toISOString(),
        tables: tableCounts,
        insufficientIssues: issueR.rows || [],
      });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createEvidenceExportHandler({ pool }) {
  return async (req, res) => {
    if (hqRolesForbidden(req, res)) return;
    const taskLimit = Math.max(
      1,
      Math.min(20000, Number(req.query?.taskLimit) || 5000)
    );
    const eventLimit = Math.max(
      1,
      Math.min(50000, Number(req.query?.eventLimit) || 10000)
    );
    const format = String(req.query?.format || 'json').trim().toLowerCase();
    try {
      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      const [tasksR, eventsR] = await Promise.all([
        pool().query(
          `SELECT * FROM master_tasks WHERE tenant_id = $2 ORDER BY created_at DESC LIMIT $1`,
          [taskLimit, tenantIdQ]
        ),
        pool().query(
          `SELECT * FROM master_events WHERE tenant_id = $2 ORDER BY created_at DESC LIMIT $1`,
          [eventLimit, tenantIdQ]
        ),
      ]);

      const tasks = tasksR.rows || [];
      const events = eventsR.rows || [];
      const { byStatus, byEventType } = summarizeEvidenceExport(tasks, events);

      if (format === 'csv') {
        const csv = buildMasterEvidenceCsv(tasks, events);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="master-evidence-${Date.now()}.csv"`
        );
        return res.send(csv);
      }

      return res.json({
        generatedAt: new Date().toISOString(),
        limits: { taskLimit, eventLimit },
        summary: {
          taskCount: tasks.length,
          eventCount: events.length,
          byStatus,
          byEventType,
        },
        tasks,
        events,
      });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createMasterTaskDetailHandler({ pool }) {
  return async (req, res) => {
    const taskId = String(req.params?.taskId || '').trim();
    if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
    try {
      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      const [taskR, eventsR] = await Promise.all([
        pool().query(
          `SELECT * FROM master_tasks WHERE task_id = $1 AND tenant_id = $2`,
          [taskId, tenantIdQ]
        ),
        pool().query(
          `SELECT * FROM master_events WHERE task_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
          [taskId, tenantIdQ]
        ),
      ]);
      if (!taskR.rows?.length) return res.status(404).json({ error: 'not_found' });
      return res.json({ task: taskR.rows[0], events: eventsR.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createMasterEventsHandler({ pool }) {
  return async (req, res) => {
    if (hqRolesForbidden(req, res)) return;
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    try {
      const r = await pool().query(
        `SELECT * FROM master_events WHERE tenant_id = $2 ORDER BY created_at DESC LIMIT $1`,
        [limit, req.tenantId || req.user?.tenant_id || 'default']
      );
      return res.json({ items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}

export function createManualMasterTaskHandler({ pool, createTask, inferBrandFromStoreName }) {
  return async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const { category, severity, store, brand, title, detail } = req.body || {};
      if (!store || !title) {
        return res.status(400).json({ error: 'missing store or title' });
      }
      const taskId = await createTask(
        {
          source: 'manual',
          sourceRef: `manual-${req.user?.username}`,
          category: category || '手动创建',
          severity: severity || 'medium',
          store,
          brand: brand || inferBrandFromStoreName(store),
          title,
          detail: detail || '',
          sourceData: { createdBy: req.user?.username },
        },
        req.tenantId || req.user?.tenant_id || 'default'
      );
      return res.json({ ok: true, taskId });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };
}
