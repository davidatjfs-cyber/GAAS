import { handleApprovalDecide } from './decide-handler.js';
import { bindOnboardingPayloadDeps } from './onboarding-payload.js';

export { buildOnboardingEmployeeRecordFromPayload } from './onboarding-payload.js';
export { registerApprovalLifecycleRoutes } from './routes-lifecycle.js';

/**
 * 审批决定路由（P0-A1：从 index.js 拆出）。
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerApprovalDecideRoutes(app, authRequired, deps) {
  if (typeof deps?.hrmsNowISO === 'function') {
    bindOnboardingPayloadDeps({ hrmsNowISO: deps.hrmsNowISO });
  }
  app.post('/api/approvals/:id/decide', authRequired, (req, res) => handleApprovalDecide(req, res, deps));
}
