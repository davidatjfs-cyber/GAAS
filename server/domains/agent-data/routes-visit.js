import { registerAgentDataVisitDataRoutes } from './routes-visit-data.js';
import { registerAgentDataVisitSummaryRoutes } from './routes-visit-summary.js';

export function registerAgentDataVisitRoutes(app, authRequired, deps) {
  registerAgentDataVisitDataRoutes(app, authRequired, deps);
  registerAgentDataVisitSummaryRoutes(app, authRequired, deps);
}
