/**
 * Training routes composer — registerTrainingRoutes(app, authMiddleware, uploadMiddleware).
 */
import { registerTrainingTopicsRoutes } from './routes-topics.js';
import { registerTrainingRubricRoutes } from './routes-rubric.js';
import { registerTrainingAssignmentsRoutes } from './routes-assignments.js';
import { registerTrainingDashboardRoutes } from './routes-dashboard.js';
import { registerTrainingCertificationsRoutes } from './routes-certifications.js';
import { registerTrainingSessionsRoutes } from './routes-sessions.js';

export function registerTrainingRoutes(app, authMiddleware, uploadMiddleware) {
  registerTrainingTopicsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingRubricRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingAssignmentsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingDashboardRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingCertificationsRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingSessionsRoutes(app, authMiddleware, uploadMiddleware);
}
