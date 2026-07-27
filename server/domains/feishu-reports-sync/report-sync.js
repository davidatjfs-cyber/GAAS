/**
 * 飞书表格同步：开档/收档报告、例会报告、原料收货日报的同步函数。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { pool } from '../../utils/database.js';
import { inferBrandFromStoreName } from '../../agents.js';
import { childLogger } from '../../utils/logger.js';
import { fetchTableRecords } from './api.js';
import { notifyFeishuSyncFailure } from './notify.js';
import { extractClosingReportFields, extractOpeningReportFields, extractMeetingReportFields, extractMaterialReportFields } from './field-extractors.js';

const log = childLogger({ domain: 'feishu-sync' });

// 厨房报告同步函数
export async function syncKitchenReports(tableConfig, accessToken, reportType, tenantId) {
  try {
    const records = await fetchTableRecords(tableConfig, accessToken);
    let syncedCount = 0;

    for (const record of records) {
      const fields = record.fields;

      // 提取字段
      const extractedFields = reportType === 'closing'
        ? extractClosingReportFields(fields)
        : extractOpeningReportFields(fields);

      const { store, date, station, responsible, submit_time } = extractedFields;

      if (!store || !date || !station) {
        log.warn({ msg: 'skip_invalid_record', reason: 'missing_store_date_or_slot' });
        continue;
      }

      // 推断品牌
      const brand = inferBrandFromStoreName(store);
      await pool().query(`
        INSERT INTO kitchen_reports
        (store, brand, report_date, report_type, station, reporter, report_data, feishu_record_id, submitted, submit_time, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (store, report_date, report_type, station, tenant_id)
        DO UPDATE SET
          reporter = EXCLUDED.reporter,
          report_data = EXCLUDED.report_data,
          feishu_record_id = EXCLUDED.feishu_record_id,
          submitted = EXCLUDED.submitted,
          submit_time = EXCLUDED.submit_time,
          updated_at = NOW()
      `, [
        store, brand, new Date(date), reportType, station, responsible,
        JSON.stringify(extractedFields), record.record_id,
        !!submit_time, submit_time ? new Date(submit_time) : null, tenantId
      ]);

      syncedCount++;
    }

    log.info({ msg: 'table_sync_done', table: tableConfig.name, synced: syncedCount, total: records.length });

  } catch (error) {
    log.error({ msg: 'table_sync_failed', table: tableConfig.name, err: error?.message || String(error) });
    notifyFeishuSyncFailure(tableConfig?.name || '厨房报告', error);
  }
}

// 例会报告同步函数
export async function syncMeetingReports(tableConfig, accessToken, tenantId) {
  try {
    const records = await fetchTableRecords(tableConfig, accessToken);
    let syncedCount = 0;

    for (const record of records) {
      const fields = record.fields;
      const extractedFields = extractMeetingReportFields(fields);

      const { store, date, meeting_score, reporter, submit_time, meeting_content } = extractedFields;

      if (!store || !date) {
        log.warn({ msg: 'skip_invalid_record', reason: 'missing_store_or_date' });
        continue;
      }

      const brand = inferBrandFromStoreName(store);
      await pool().query(`
        INSERT INTO store_meeting_reports
        (store, brand, meeting_date, reporter, meeting_content, meeting_score, report_data, feishu_record_id, submitted, submit_time, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (store, meeting_date, tenant_id)
        DO UPDATE SET
          reporter = EXCLUDED.reporter,
          meeting_content = EXCLUDED.meeting_content,
          meeting_score = EXCLUDED.meeting_score,
          report_data = EXCLUDED.report_data,
          feishu_record_id = EXCLUDED.feishu_record_id,
          submitted = EXCLUDED.submitted,
          submit_time = EXCLUDED.submit_time,
          updated_at = NOW()
      `, [
        store, brand, new Date(date), reporter, meeting_content,
        meeting_score, JSON.stringify(extractedFields), record.record_id,
        !!submit_time, submit_time ? new Date(submit_time) : null, tenantId
      ]);

      syncedCount++;
    }

    log.info({ msg: 'table_sync_done', table: tableConfig.name, synced: syncedCount, total: records.length });

  } catch (error) {
    log.error({ msg: 'table_sync_failed', table: tableConfig.name, err: error?.message || String(error) });
    notifyFeishuSyncFailure(tableConfig?.name || '例会报告', error);
  }
}

// 原料收货日报同步函数
export async function syncMaterialReports(tableConfig, accessToken, brand, tenantId) {
  try {
    const records = await fetchTableRecords(tableConfig, accessToken);
    let syncedCount = 0;

    for (const record of records) {
      const fields = record.fields;
      const extractedFields = extractMaterialReportFields(fields);

      const { store, date, receiver, submit_time } = extractedFields;

      if (!store || !date) {
        log.warn({ msg: 'skip_invalid_record', reason: 'missing_store_or_date' });
        continue;
      }

      await pool().query(`
        INSERT INTO material_receiving_reports
        (store, brand, report_date, receiver, report_data, feishu_record_id, submitted, submit_time, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (store, brand, report_date, tenant_id)
        DO UPDATE SET
          receiver = EXCLUDED.receiver,
          report_data = EXCLUDED.report_data,
          feishu_record_id = EXCLUDED.feishu_record_id,
          submitted = EXCLUDED.submitted,
          submit_time = EXCLUDED.submit_time,
          updated_at = NOW()
      `, [
        store, brand, new Date(date), receiver,
        JSON.stringify(extractedFields), record.record_id,
        !!submit_time, submit_time ? new Date(submit_time) : null, tenantId
      ]);

      syncedCount++;
    }

    log.info({ msg: 'table_sync_done', table: tableConfig.name, synced: syncedCount, total: records.length });

  } catch (error) {
    log.error({ msg: 'table_sync_failed', table: tableConfig.name, err: error?.message || String(error) });
    notifyFeishuSyncFailure(tableConfig?.name || '原料收货日报', error);
  }
}
