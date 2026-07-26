import { registerAgentDataFeishuRoutes } from './routes-feishu.js';
import { registerAgentDataVisitRoutes } from './routes-visit.js';

export function registerAgentDataRoutes(app, authRequired, deps) {
  registerAgentDataFeishuRoutes(app, authRequired, deps);
  registerAgentDataVisitRoutes(app, authRequired, deps);
}
