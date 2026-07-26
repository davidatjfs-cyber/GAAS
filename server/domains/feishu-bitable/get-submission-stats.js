/**
 * Bitable submission volume stats (Wave A12a peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'get-submission-stats' });

/**
 * @param {object} deps
 * @returns {() => Promise<object>}
 */
export function createGetBitableSubmissionStats(deps) {
  const { pool } = deps;

  return async function getBitableSubmissionStats() {
    try {
      const mainStats = await pool().query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as last_30_days,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM agent_messages 
      WHERE content_type = 'bitable_submission'
    `);

      const archiveStats = await pool().query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as last_30_days
      FROM bitable_submissions_archive
    `);

      return {
        main: mainStats.rows[0] || {},
        archive: archiveStats.rows[0] || {},
        total: Number(mainStats.rows[0]?.total || 0) + Number(archiveStats.rows[0]?.total || 0),
      };
    } catch (e) {
      log.error({ msg: 'get_stats_failed', err: String(e?.message || e) });
      return { main: {}, archive: {}, total: 0 };
    }
  };
}
