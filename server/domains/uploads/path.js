/**
 * Safe relative path resolution for GET /uploads/* (path-traversal guard).
 */
import path from 'path';

/**
 * @param {unknown} rawRelParam - req.params[0] style path under /uploads/
 * @returns {string|null} normalized relative path, or null if invalid
 */
export function resolveUploadRelPath(rawRelParam) {
  const rawRel = String(rawRelParam || '').replace(/^\/+/, '');
  const normalizedRel = path.normalize(rawRel);
  if (!rawRel || normalizedRel.startsWith('..') || path.isAbsolute(normalizedRel)) {
    return null;
  }
  return normalizedRel;
}
