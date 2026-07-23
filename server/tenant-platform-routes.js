/**
 * Compatibility shim — imports unchanged in index.js / tests.
 */
export {
  createPlatformAdminRequired,
  requireSuperAdmin,
  requireSalesManagerOrAbove,
} from './domains/tenant-platform/auth-guards.js';

export { registerTenantPlatformRoutes } from './domains/tenant-platform/routes.js';
