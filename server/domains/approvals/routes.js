import { handleApprovalDecide } from './decide-handler.js';

/**
 * 审批决定路由（P0-A1：从 index.js 拆出）。
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerApprovalDecideRoutes(app, authRequired, deps) {
  app.post('/api/approvals/:id/decide', authRequired, (req, res) => handleApprovalDecide(req, res, deps));
}
