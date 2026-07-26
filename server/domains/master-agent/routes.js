/**
 * Master Agent HTTP routes (extracted from master-agent.js).
 */
import { registerHqPlannerRoutes } from '../../hq-planner-agent.js';
import {
  createDataSourceHealthHandler,
  createEvidenceExportHandler,
  createManualMasterTaskHandler,
  createMasterDashboardHandler,
  createMasterEventsHandler,
  createMasterTaskDetailHandler,
  createMasterTaskListHandler,
} from './route-handlers.js';

export function registerMasterRoutes(app, deps) {
  const { authRequired } = deps;

  app.get('/api/master/dashboard', authRequired, createMasterDashboardHandler(deps));
  app.get('/api/master/tasks', authRequired, createMasterTaskListHandler(deps));
  app.get('/api/master/data-source-health', authRequired, createDataSourceHealthHandler(deps));
  app.get('/api/master/evidence/export', authRequired, createEvidenceExportHandler(deps));
  app.get('/api/master/tasks/:taskId', authRequired, createMasterTaskDetailHandler(deps));
  app.get('/api/master/events', authRequired, createMasterEventsHandler(deps));
  app.post('/api/master/tasks', authRequired, createManualMasterTaskHandler(deps));

  registerHqPlannerRoutes(app, authRequired);
}
