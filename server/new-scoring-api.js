import { registerNewScoringReadRoutes } from './new-scoring-read-routes.js';
import { registerNewScoringWriteRoutes } from './new-scoring-write-routes.js';

export function registerNewScoringRoutes(app, authRequired) {
  registerNewScoringReadRoutes(app, authRequired);
  registerNewScoringWriteRoutes(app, authRequired);
}
