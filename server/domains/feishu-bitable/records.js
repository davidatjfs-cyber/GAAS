import { stripAttachmentLikeFields } from './map.js';

export async function upsertFeishuGenericRecord(pool, { appToken, tableId, record, configKey = null }) {
  if (!appToken || !tableId || !record) return;
  const recordId = String(record?.record_id || '').trim();
  if (!recordId) return;
  const rawFields = record?.fields || {};
  const cleanedFields = stripAttachmentLikeFields(rawFields);

  await pool.query(
    `insert into feishu_generic_records (app_token, table_id, record_id, config_key, fields, raw, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (app_token, table_id, record_id)
     do update set config_key = excluded.config_key, fields = excluded.fields, raw = excluded.raw, updated_at = now()`,
    [appToken, tableId, recordId, configKey, cleanedFields, record]
  );
}
