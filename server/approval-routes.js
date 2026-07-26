/**
 * 审批模块的简单路由（架构拆分阶段B，第一批：只拆低风险的部分）。
 *
 * create / return / resubmit / repair-onboarding 已拆至 domains/approvals/routes-lifecycle.js（Wave 4c）；
 * decide 在 domains/approvals/（P0-A1）。
 */
import {
  bindApprovalListRoute,
  bindApprovalDetailRoute,
  bindApprovalReadRoute,
  bindApprovalDeleteRoute,
} from './domains/approvals/approval-routes-bind.js';

export function registerApprovalRoutes(app, authRequired, deps) {
  bindApprovalListRoute(app, authRequired, deps);
  bindApprovalDetailRoute(app, authRequired, deps);
  bindApprovalReadRoute(app, authRequired, deps);
  bindApprovalDeleteRoute(app, authRequired, deps);
}
