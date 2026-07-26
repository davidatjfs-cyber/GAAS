export { registerAnnouncementExtraRoutes } from './routes-announcement-extra.js';

import { registerRemainingStateAnnouncementRoutes } from './routes-announcements.js';
import { registerRemainingStateExamTrainingRoutes } from './routes-exam-training.js';
import { registerRemainingStateHrmsUserRoutes } from './routes-hrms-users.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerRemainingStateRoutes(app, authRequired, deps) {
  registerRemainingStateAnnouncementRoutes(app, authRequired, deps);
  registerRemainingStateExamTrainingRoutes(app, authRequired, deps);
  registerRemainingStateHrmsUserRoutes(app, authRequired, deps);
}
