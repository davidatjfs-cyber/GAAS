/**
 * Agent Feishu / table-visit HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 * getFeishuAccessToken / createFeishuBitableRecord / findConfigKeyByTableInfo / upsertFeishuGenericRecord:
 * index 本地函数，接线时从 index 注入 deps。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-data', handler: 'routes' });

export function registerAgentDataFeishuRoutes(app, authRequired, deps) {
  const {
    pool,
    safeErrMessage,
    getFeishuAccessToken,
    createFeishuBitableRecord,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
  } = deps;

  // ─── Agent API - 通用查询飞书多维表数据（已落库的 generic records）
  // H1-FIX: 添加认证保护

  app.get('/api/agent/feishu-table-data', authRequired, async (req, res) => {
    try {
      const appToken = String(req.query?.appToken || '').trim();
      const tableId = String(req.query?.tableId || '').trim();
      const q = String(req.query?.q || '').trim();
      const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);

      if (!appToken || !tableId) {
        return res.status(400).json({ error: 'missing_params', message: 'appToken/tableId required' });
      }

      const where = ['app_token = $1', 'table_id = $2'];
      const params = [appToken, tableId];
      if (q) {
        params.push(`%${q}%`);
        where.push(`fields::text ilike $${params.length}`);
      }
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      where.push(`tenant_id = $${params.length}`);

      const whereSql = where.length ? `where ${where.join(' and ')}` : '';

      const countR = await pool.query(
        `select count(*)::int as cnt from feishu_generic_records ${whereSql}`,
        params
      );
      const total = Number(countR.rows?.[0]?.cnt || 0) || 0;

      params.push(limit, offset);
      const r = await pool.query(
        `select app_token, table_id, record_id, fields, updated_at
       from feishu_generic_records
       ${whereSql}
       order by updated_at desc
       limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return res.json({
        items: r.rows || [],
        pagination: { limit, offset, total },
        query: { appToken, tableId, q: q || '' },
      });
    } catch (e) {
      log.error({ msg: 'agent_feishu_table_data_failed', request_id: req.requestId, err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // Agent/API: 直接写入飞书多维表格（单条或批量）
  app.post('/api/agent/feishu-table-write', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const { appToken, tableId, appId, appSecret, fields, records } = req.body || {};
      if (!appToken || !tableId) {
        return res.status(400).json({ error: 'missing_app_token_or_table_id' });
      }

      const items = Array.isArray(records) ? records : fields && typeof fields === 'object' ? [fields] : [];

      if (!items.length) {
        return res.status(400).json({ error: 'missing_fields_or_records' });
      }
      if (items.length > 50) {
        return res.status(400).json({ error: 'too_many_records', message: 'max 50 records per request' });
      }

      const accessToken = await getFeishuAccessToken({ appId, appSecret });
      const createdRecordIds = [];
      const failedDetails = [];

      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        try {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new Error('invalid_fields');
          }

          const created = await createFeishuBitableRecord({
            appToken,
            tableId,
            fields: row,
            accessToken,
          });

          if (created?.record_id) {
            createdRecordIds.push(created.record_id);
          }

          try {
            if (created) {
              const configKey = findConfigKeyByTableInfo(appToken, tableId);
              await upsertFeishuGenericRecord({ appToken, tableId, record: created, configKey });
            }
          } catch (e) {
            // best effort local mirror; should not fail write call
          }
        } catch (err) {
          failedDetails.push({
            index: i,
            error: err?.message || String(err),
          });
        }
      }

      return res.json({
        success: true,
        total: items.length,
        created: createdRecordIds.length,
        failed: failedDetails.length,
        recordIds: createdRecordIds,
        failedDetails,
      });
    } catch (error) {
      log.error({ msg: 'agent_feishu_table_write_failed', request_id: req.requestId, err: error?.message || String(error) });
      return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  // Agent API - 查询桌访记录数据
  // H1-FIX: 添加认证保护
}
