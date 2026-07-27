/**
 * 兼容入口：实现已迁至 growth-phase-auth/service.js。
 * 存量 domains/growth-* 仍从此路径 import，勿删。
 */
export {
  cleanText,
  cleanPhone,
  authPhaseApi,
  getPhaseApiTenantId,
  requirePhaseAuth,
} from './growth-phase-auth/service.js';