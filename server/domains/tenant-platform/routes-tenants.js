import { registerTenantPlatformTenantsCreateRoutes } from './routes-tenants-create.js';
import { registerTenantPlatformTenantsListRoutes } from './routes-tenants-list.js';
import { registerTenantPlatformTenantsOverviewRoutes } from './routes-tenants-overview.js';
import { registerTenantPlatformTenantsProfileRoutes } from './routes-tenants-profile.js';

export function registerTenantPlatformTenantsRoutes(app, deps) {
  registerTenantPlatformTenantsCreateRoutes(app, deps);
  registerTenantPlatformTenantsListRoutes(app, deps);
  registerTenantPlatformTenantsOverviewRoutes(app, deps);
  registerTenantPlatformTenantsProfileRoutes(app, deps);
}
