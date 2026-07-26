/**
 * 审批生命周期路由（Wave 4c：create / return / resubmit + repair-onboarding）。
 * 行为保持：从 index.js 原样迁出；通过 deps 注入 index 闭包符号，禁止反向 import index。
 */
import {
  bindOnboardingPayloadDeps,
  buildOnboardingEmployeeRecordFromPayload,
} from './onboarding-payload.js';
import {
  bindApprovalCreateRoute,
  bindApprovalReturnRoute,
  bindApprovalResubmitRoute,
  bindRepairOnboardingRoute,
} from './routes-lifecycle-bind.js';


/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerApprovalLifecycleRoutes(app, authRequired, deps) {
  const { hrmsNowISO } = deps;

  bindOnboardingPayloadDeps({ hrmsNowISO });

  bindApprovalCreateRoute(app, authRequired, deps);
  bindRepairOnboardingRoute(app, authRequired, { ...deps, buildOnboardingEmployeeRecordFromPayload });
  bindApprovalReturnRoute(app, authRequired, deps);
  bindApprovalResubmitRoute(app, authRequired, deps);
}
