/**
 * Training routes composer — registerTrainingRoutes(app, authMiddleware, uploadMiddleware, deps?).
 * deps.getSharedState：legacy POST /api/training/tasks/batch（Wave 4e）。
 */
import { registerTrainingTopicsRoutes } from './routes-topics.js';
import { registerTrainingRubricRoutes } from './routes-rubric.js';
import { registerTrainingAssignmentsRoutes } from './routes-assignments.js';
import { registerTrainingDashboardRoutes } from './routes-dashboard.js';
import { registerTrainingCertificationsRoutes } from './routes-certifications.js';
import { registerTrainingSessionsRoutes } from './routes-sessions.js';
import { registerTrainingBatchTasksRoutes } from './routes-batch-tasks.js';

export function registerTrainingRoutes(app, authMiddleware, uploadMiddleware, deps = {}) {
  registerTrainingTopicsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingRubricRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingAssignmentsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingDashboardRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingCertificationsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingSessionsRoutes(app, authMiddleware, uploadMiddleware);
  if (typeof deps.getSharedState === 'function') {
    registerTrainingBatchTasksRoutes(app, authMiddleware, deps);
  }
}
