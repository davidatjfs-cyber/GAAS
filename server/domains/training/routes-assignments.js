/**
 * Training assignments routes composer.
 */
import { registerTrainingAssignmentsSearchRoutes } from './routes-assignments-search.js';
import { registerTrainingAssignmentsCrudRoutes } from './routes-assignments-crud.js';

export function registerTrainingAssignmentsRoutes(app, authMiddleware, uploadMiddleware) {
  registerTrainingAssignmentsSearchRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingAssignmentsCrudRoutes(app, authMiddleware, uploadMiddleware);
}
