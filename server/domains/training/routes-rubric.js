/**
 * Training rubric routes composer.
 */
import { registerTrainingRubricAnalyzeRoutes } from './routes-rubric-analyze.js';
import { registerTrainingRubricTopicRoutes } from './routes-rubric-topic.js';
import { registerTrainingRubricMiscRoutes } from './routes-rubric-misc.js';

export function registerTrainingRubricRoutes(app, authMiddleware, uploadMiddleware) {
  registerTrainingRubricAnalyzeRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingRubricTopicRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingRubricMiscRoutes(app, authMiddleware, uploadMiddleware);
}
