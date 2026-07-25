/**
 * Agent Task Board proxy routes (extracted from index.js — monolith split).
 * registerAgentTaskBoardRoutes(app, deps) — behavior-preserving move.
 */
import { agentsOutboundHeaders } from './domains/shared/agents-service-auth.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'agent-task-board' });

export function registerAgentTaskBoardRoutes(app, deps) {
  const {
    authRequired,
    axios,
    getAgentsServiceAdminToken,
    getAgentsServiceBaseUrl,
  } = deps;

  function canManageAgentTaskBoard(user) {
    const role = String(user?.role || '').trim();
    return role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
  }

  async function proxyAgentTaskBoard(req, res, method, pathSuffix, body) {
    if (!canManageAgentTaskBoard(req.user)) return res.status(403).json({ error: 'forbidden' });
    try {
      const token = await getAgentsServiceAdminToken();
      const url = getAgentsServiceBaseUrl() + '/api/agent-task-board' + pathSuffix;
      const r = await axios({
        method,
        url,
        data: body,
        timeout: 15000,
        validateStatus: () => true,
        headers: agentsOutboundHeaders(req, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      });
      if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'agent_task_board_proxy_failed' });
      return res.json(r.data || { ok: true });
    } catch (e) {
      const msg = String(e?.message || e || '');
      log.error({ msg: 'proxy_agent_task_board_failed', method, path: pathSuffix, err: msg.slice(0, 500) });
      return res.status(502).json({ error: 'internal_error', detail: msg.slice(0, 240) });
    }
  }

  app.get('/api/agent-task-board/summary', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'GET', '/summary');
  });

  app.get('/api/agent-task-board/tasks', authRequired, (req, res) => {
    const qs = new URLSearchParams();
    if (req.query?.status) qs.set('status', String(req.query.status));
    if (req.query?.limit) qs.set('limit', String(req.query.limit));
    return proxyAgentTaskBoard(req, res, 'GET', '/tasks' + (qs.toString() ? `?${qs}` : ''));
  });

  app.post('/api/agent-task-board/tasks', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', '/tasks', req.body || {});
  });

  app.post('/api/agent-task-board/tasks/bulk-close-open', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', '/tasks/bulk-close-open', req.body || {});
  });

  app.get('/api/agent-task-board/tasks/:taskId', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'GET', `/tasks/${encodeURIComponent(req.params.taskId)}`);
  });

  app.post('/api/agent-task-board/tasks/:taskId/evidences', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/evidences`, req.body || {});
  });

  app.post('/api/agent-task-board/tasks/:taskId/review', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/review`, req.body || {});
  });

  app.post('/api/agent-task-board/tasks/:taskId/derive', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/derive`, req.body || {});
  });

  app.post('/api/agent-task-board/tasks/:taskId/reassign', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/reassign`, req.body || {});
  });

  app.post('/api/agent-task-board/tasks/:taskId/comment', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/comment`, req.body || {});
  });

  app.post('/api/agent-task-board/tasks/:taskId/quality-score', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', `/tasks/${encodeURIComponent(req.params.taskId)}/quality-score`, req.body || {});
  });

  app.get('/api/agent-task-board/queue', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'GET', '/queue');
  });

  app.get('/api/agent-task-board/workloads', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'GET', '/workloads');
  });

  app.get('/api/agent-task-board/metrics', authRequired, (req, res) => {
    const qs = new URLSearchParams();
    if (req.query?.days) qs.set('days', String(req.query.days));
    return proxyAgentTaskBoard(req, res, 'GET', '/metrics' + (qs.toString() ? `?${qs}` : ''));
  });

  app.post('/api/agent-task-board/watchdog/run', authRequired, (req, res) => {
    return proxyAgentTaskBoard(req, res, 'POST', '/watchdog/run', req.body || {});
  });
}
