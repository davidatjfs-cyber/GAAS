/**
 * Inventory forecast HTTP routes — thin handlers.
 * Business logic lives in service.js; multer upload stays here.
 */
import { registerInventoryForecastHistoryRoutes } from './routes-history.js';
import { registerInventoryForecastAliasRoutes } from './routes-aliases.js';
import { registerInventoryForecastAnalyticsRoutes } from './routes-analytics.js';
import { registerInventoryForecastPredictRoutes } from './routes-predict.js';

export function registerInventoryForecastRoutes(app, deps) {
  registerInventoryForecastHistoryRoutes(app, deps);
  registerInventoryForecastAliasRoutes(app, deps);
  registerInventoryForecastAnalyticsRoutes(app, deps);
  registerInventoryForecastPredictRoutes(app, deps);
}
