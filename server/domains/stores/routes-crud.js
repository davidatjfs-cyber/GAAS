import { registerStoreUpdateRoute } from './routes-crud-update.js';
import { registerStoreListRoute } from './routes-crud-list.js';
import { registerStoreCreateRoute } from './routes-crud-create.js';
import { registerStoreLocationRoute } from './routes-crud-location.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: import('pg').Pool,
 *   getSharedState: () => Promise<object>,
 *   saveSharedState: (state: object) => Promise<void>,
 *   resolveTenantIdDefault: (tenantId?: string) => string,
 *   getCreditRisk: (pool: import('pg').Pool, leadId: unknown) => Promise<{ can_open_store?: boolean, payment_type?: string } | null>,
 *   hrmsNowISO: () => string,
 *   normalizeBrandId: (v: unknown) => string,
 *   getBrandsFromState: (state: object) => Array<object>,
 * }} deps
 */
export function registerStoresCrudRoutes(app, authRequired, deps) {
  registerStoreUpdateRoute(app, authRequired, deps);
  registerStoreListRoute(app, authRequired, deps);
  registerStoreCreateRoute(app, authRequired, deps);
  registerStoreLocationRoute(app, authRequired, deps);
}
