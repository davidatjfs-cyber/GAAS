/**
 * Training topics routes composer.
 */
import { registerTrainingTopicsPromotionRoutes } from './routes-topics-promotion.js';
import { registerTrainingTopicsCrudRoutes } from './routes-topics-crud.js';

export function registerTrainingTopicsRoutes(app, authMiddleware, uploadMiddleware) {
  registerTrainingTopicsPromotionRoutes(app, authMiddleware, uploadMiddleware);
  registerTrainingTopicsCrudRoutes(app, authMiddleware, uploadMiddleware);
}
