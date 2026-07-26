/**
 * Agent-config admin routes composer (P4 peel from agent-config-manager.js).
 */
import { registerAgentConfigCoreRoutes } from './routes-core.js';
import { registerAgentTemplateRoutes } from './routes-templates.js';
import { registerAgentDomainConfigRoutes } from './routes-domain-config.js';
import { registerAgentRulesRoutes } from './routes-rules.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerAgentConfigRoutes(app, authRequired, deps) {
  registerAgentConfigCoreRoutes(app, authRequired, deps);
  registerAgentTemplateRoutes(app, authRequired, deps);
  registerAgentDomainConfigRoutes(app, authRequired, deps);
  registerAgentRulesRoutes(app, authRequired, deps);
}
