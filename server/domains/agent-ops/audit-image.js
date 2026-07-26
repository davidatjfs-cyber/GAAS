/**
 * auditImage factory (P2 peel from agents.js).
 */
import { auditImageBody } from './audit-image-helpers.js';

/**
 * @param {object} deps
 * @returns {(imageUrl: string, auditType?: string, context?: object) => Promise<object>}
 */
export function createAuditImage(deps) {
  return (imageUrl, auditType, context = {}) => auditImageBody(deps, imageUrl, auditType, context);
}
