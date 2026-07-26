import { registerNewScoringTargetWriteRoutes } from './new-scoring-target-write-routes.js';
import { registerNewScoringDailyWriteRoutes } from './new-scoring-daily-write-routes.js';

export function registerNewScoringWriteRoutes(app, authRequired) {
  registerNewScoringTargetWriteRoutes(app, authRequired);
  registerNewScoringDailyWriteRoutes(app, authRequired);
}
