/**
 * Archive old bitable_submission rows out of agent_messages (Wave A11a peel).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'archive-old-submissions' });

/**
 * @param {object} deps
 * @returns {() => Promise<object>}
 */
export function createArchiveOldBitableSubmissions(deps) {
  const {
    pool,
    archiveThresholdDays = 7,
    deleteThresholdDays = 60,
    nowFn = () => new Date(),
    batchLimit = 5000,
  } = deps;

  return async function archiveOldBitableSubmissions() {
    log.info({ msg: 'archive_process_start' });

    try {
      await pool().query(`
      CREATE TABLE IF NOT EXISTS bitable_submissions_archive (
        LIKE agent_messages INCLUDING ALL
      )
    `);

      const cutoffDate = new Date(nowFn());
      cutoffDate.setDate(cutoffDate.getDate() - archiveThresholdDays);

      const oldRecords = await pool().query(
        `
      SELECT * FROM agent_messages 
      WHERE content_type = 'bitable_submission' 
        AND created_at < $1
        AND record_id NOT IN (SELECT record_id FROM bitable_submissions_archive)
      ORDER BY created_at ASC
      LIMIT ${Number(batchLimit) || 5000}
    `,
        [cutoffDate.toISOString()]
      );

      if (oldRecords.rows.length === 0) {
        log.info({ msg: 'no_records_to_archive' });
        return { archived: 0, deleted: 0 };
      }

      log.info({ msg: 'records_found', count: oldRecords.rows.length });

      let archivedCount = 0;
      const client = await pool().connect();
      try {
        await client.query('BEGIN');
        for (const record of oldRecords.rows) {
          try {
            await client.query(
              `
            INSERT INTO bitable_submissions_archive (
              id, direction, channel, feishu_open_id, sender_username, sender_name, 
              sender_role, routed_to, content_type, content, agent_data, 
              created_at, updated_at, feishu_message_id, image_urls
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `,
              [
                record.id,
                record.direction,
                record.channel,
                record.feishu_open_id,
                record.sender_username,
                record.sender_name,
                record.sender_role,
                record.routed_to,
                record.content_type,
                record.content,
                record.agent_data,
                record.created_at,
                record.updated_at,
                record.feishu_message_id,
                record.image_urls,
              ]
            );
            await client.query('DELETE FROM agent_messages WHERE id = $1', [record.id]);
            archivedCount++;
          } catch (e) {
            log.error({
              msg: 'archive_record_failed',
              id: record.id,
              err: String(e?.message || e),
            });
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        log.error({ msg: 'archive_transaction_failed', err: String(e?.message || e) });
        throw e;
      } finally {
        client.release();
      }

      const deleteCutoffDate = new Date(nowFn());
      deleteCutoffDate.setDate(deleteCutoffDate.getDate() - deleteThresholdDays);

      const deleteResult = await pool().query(
        `
      DELETE FROM bitable_submissions_archive 
      WHERE created_at < $1
    `,
        [deleteCutoffDate.toISOString()]
      );

      const deletedCount = deleteResult.rowCount || 0;
      log.info({ msg: 'archive_completed', archived: archivedCount, deleted: deletedCount });
      return { archived: archivedCount, deleted: deletedCount };
    } catch (e) {
      log.error({ msg: 'archive_process_failed', err: String(e?.message || e) });
      return { archived: 0, deleted: 0, error: String(e?.message) };
    }
  };
}
