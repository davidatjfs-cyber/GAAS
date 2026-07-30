/**
 * Growth actions engine routes — thin handlers over service.js.
 * Signature preserved: registerGrowthActionsRoutes(app, pool).
 */
import { tenantContext, resolveTenantIdDefault } from '../../utils/database.js';
import {
  requireGrowthAuth,
  requireGrowthAdminRole,
  getGrowthOperator,
  getGrowthTenantId,
  runTouchRuleEngine,
  executeGrowthActionRecord,
  appendExecutionLog,
} from '../../growth-api.js';
import { resolveAgentCanonicalStore } from '../../v2-store-alignment.js';
import {
  runRuleEngine,
  listActions,
  setPllmExperimentStatus,
  listExecutionLogs,
  upsertAction,
  executeAction,
  assignMarketingActionTask,
  ignoreAction,
  editAndExecuteAction,
  submitActionFeedback,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    resolveTenantIdDefault,
    runTouchRuleEngine,
    executeGrowthActionRecord,
    appendExecutionLog,
    resolveAgentCanonicalStore,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthActionsRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.post('/api/growth/rule-engine/run', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await runRuleEngine(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listActions(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/pllm-experiment/:code/approve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    return send(
      res,
      await setPllmExperimentStatus(ctx, getGrowthTenantId(req), req.params.code, 'approved')
    );
  });

  app.post('/api/growth/pllm-experiment/:code/reject', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    return send(
      res,
      await setPllmExperimentStatus(ctx, getGrowthTenantId(req), req.params.code, 'rejected')
    );
  });

  app.get('/api/growth/execution-logs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listExecutionLogs(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertAction(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.post('/api/growth/actions/:actionKey/execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await executeAction(ctx, getGrowthTenantId(req), req.params.actionKey, getGrowthOperator(req), req.body)
    );
  });

  // 2026-07-30：营销活动建议"执行"必须先分配责任人（该门店店长/前厅主管），生成任务，
  // 责任人任务栏能看到、需要提交证据、发起人确认才算真正执行完成——见service.js里的注释。
  app.post('/api/growth/actions/:actionKey/assign-and-execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await assignMarketingActionTask(ctx, getGrowthTenantId(req), req.params.actionKey, req.body?.assigneeUsername, getGrowthOperator(req), req.body)
    );
  });

  app.post('/api/growth/actions/:actionKey/ignore', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await ignoreAction(ctx, getGrowthTenantId(req), req.params.actionKey, getGrowthOperator(req), req.body)
    );
  });

  app.post('/api/growth/actions/:actionKey/edit-and-execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await editAndExecuteAction(
        ctx,
        getGrowthTenantId(req),
        req.params.actionKey,
        getGrowthOperator(req),
        req.body
      )
    );
  });

  app.post('/api/growth/actions/:actionKey/feedback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await submitActionFeedback(
        ctx,
        getGrowthTenantId(req),
        req.params.actionKey,
        getGrowthOperator(req),
        req.body || {}
      )
    );
  });
}
