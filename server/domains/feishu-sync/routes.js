/**
 * Feishu sync HTTP routes (Wave 4p — behavior-preserving extract from index.js).
 */
import { runManualFeishuBitableSync } from './manual-bitable-sync.js';

export function registerFeishuSyncRoutes(app, authRequired, deps) {
  const {
    pool,
    safeErrMessage,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
    notifyAdminsDualWriteFailure,
    syncDishLibraryCosts,
    syncSopSteps,
    lookupFeishuUserByUsername,
    sendLarkMessage
  } = deps;

  const manualSyncCtx = {
    pool,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
    notifyAdminsDualWriteFailure
  };

  app.get('/api/feishu/sync-status', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const limit = Math.min(Number(req.query?.limit) || 50, 200);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);
      const status = String(req.query?.status || '').trim();

      let query = 'select * from feishu_sync_logs';
      const params = [];

      if (status) {
        query += ' where sync_status = $1';
        params.push(status);
      }

      query += ' order by created_at desc limit $' + (params.length + 1) + ' offset $' + (params.length + 2);
      params.push(limit, offset);

      const result = await pool.query(query, params);

      res.json({
        items: result.rows,
        pagination: {
          limit,
          offset,
          total: result.rowCount
        }
      });
    } catch (error) {
      console.error('[Feishu Sync Status] Error:', error);
      res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  app.post('/api/feishu/sync-manual', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const { appToken, tableId, appId, appSecret } = req.body;
      if (!appToken || !tableId) {
        return res.status(400).json({ error: 'missing_app_token_or_table_id' });
      }
      const result = await runManualFeishuBitableSync(manualSyncCtx, {
        appToken,
        tableId,
        appId,
        appSecret
      });
      res.json(result);
    } catch (error) {
      console.error('[Manual Sync] Error:', error);
      void notifyAdminsDualWriteFailure('飞书多维表手动同步（整次失败）', error);
      res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  app.post('/api/feishu/sync-dish-library', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const result = await syncDishLibraryCosts();
      if (!result?.ok) {
        return res.status(500).json({ error: 'server_error', message: result?.error || 'sync_failed' });
      }
      res.json({
        message: 'Dish library sync completed',
        records: Number(result.records || 0),
        upserted: Number(result.upserted || 0)
      });
    } catch (error) {
      console.error('[Dish Library Sync] Error:', error);
      void notifyAdminsDualWriteFailure('菜品库成本同步（HTTP 接口抛错）', error);
      res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  app.post('/api/feishu/sync-sop-steps', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager', 'store_production_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const result = await syncSopSteps();
      if (!result?.ok) {
        return res.status(500).json({ error: 'sync_failed', message: result?.error });
      }
      res.json({ message: 'SOP步骤库同步完成', ...result });
    } catch (error) {
      console.error('[SOP Steps Sync] Error:', error);
      res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  app.post('/api/feishu/test-connection', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const { appId, appSecret } = req.body;

      if (!appId || !appSecret) {
        return res.status(400).json({ error: 'missing_app_id_or_secret' });
      }

      const accessToken = await getFeishuAccessToken({ appId, appSecret });
      res.json({ success: true, message: '连接成功', accessToken: accessToken ? 'valid' : 'invalid' });
    } catch (error) {
      console.error('[Feishu Test Connection] Error:', error);
      res.status(500).json({ success: false, message: safeErrMessage(error) });
    }
  });

  app.post('/api/feishu/send-test-message', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const username = String(req.body?.username || '').trim();
      const openIdDirect = String(req.body?.openId || '').trim();
      const message = String(req.body?.message || 'HRMS 连通性测试消息').trim();

      let openId = openIdDirect;
      if (!openId && username) {
        const u = await lookupFeishuUserByUsername(username);
        openId = String(u?.open_id || '').trim();
        if (!openId) {
          const r = await pool.query(
            `SELECT open_id FROM feishu_users WHERE lower(username)=lower($1) LIMIT 1`,
            [username]
          );
          openId = String(r.rows?.[0]?.open_id || '').trim();
        }
      }

      if (!openId) {
        return res.status(400).json({ error: 'missing_open_id_or_bind_user' });
      }

      const result = await sendLarkMessage(openId, message, { skipDedup: true });
      return res.json({ ok: Boolean(result?.ok), openId, result });
    } catch (error) {
      console.error('[Feishu Test Message] Error:', error);
      return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });
}
