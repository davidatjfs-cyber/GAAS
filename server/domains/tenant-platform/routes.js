/**
 * Platform tenant admin routes (domain entry).
 * registerTenantPlatformRoutes(app, deps) — behavior-preserving split from tenant-platform-routes.js.
 */
import { registerTenantPlatformAuthRoutes } from './routes-auth.js';
import { registerTenantPlatformTenantsRoutes } from './routes-tenants.js';
import { registerTenantPlatformBillingRoutes } from './routes-billing.js';
import { registerTenantPlatformBrandingRoutes } from './routes-branding.js';
import { registerTenantPlatformLifecycleRoutes } from './routes-lifecycle.js';
import { registerTenantPlatformIntegrationsRoutes } from './routes-integrations.js';
import { registerTenantPlatformAgentCenterRoutes } from './routes-agent-center.js';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformRoutes(app, deps) {
  registerTenantPlatformAuthRoutes(app, deps);
  registerTenantPlatformTenantsRoutes(app, deps);
  registerTenantPlatformBillingRoutes(app, deps);
  registerTenantPlatformBrandingRoutes(app, deps);
  registerTenantPlatformLifecycleRoutes(app, deps);
  registerTenantPlatformIntegrationsRoutes(app, deps);
  registerTenantPlatformAgentCenterRoutes(app, deps);
}
