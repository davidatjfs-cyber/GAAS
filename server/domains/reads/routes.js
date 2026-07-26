/**
 * Reads / unread-counts (Wave 4m — behavior-preserving extract from index.js).
 */
import { registerReadsBatchRoute } from './routes-batch.js';
import { registerUnreadCountsRoute } from './routes-unread.js';

export function registerReadsRoutes(app, authRequired, deps) {
  registerReadsBatchRoute(app, authRequired, deps);
  registerUnreadCountsRoute(app, authRequired, deps);
}
