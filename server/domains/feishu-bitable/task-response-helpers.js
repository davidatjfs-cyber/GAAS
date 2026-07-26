/**
 * Task-response Bitable helpers (P2 peel; named exports for function-size ratchet).
 */
import {
  DEFAULT_TASK_RESP_FORM_URL,
  DEFAULT_TASK_RESP_HOST,
  DEFAULT_TASK_RESP_VIEW_ID,
  TASK_RESPONSE_CONFIG_KEY,
  TASK_RESPONSE_FIELDS,
  TASK_RESPONSE_TABLE_NAME,
} from './task-response-constants.js';

export async function ensureTaskResponseFormView(deps, state, configKey) {
  const {
    axios,
    bitableConfigs,
    getBitableTenantToken,
    log,
    getEnvFormUrl = () => process.env.BITABLE_TASK_RESP_FORM_URL || DEFAULT_TASK_RESP_FORM_URL,
    getEnvHost = () =>
      String(process.env.BITABLE_TASK_RESP_HOST || DEFAULT_TASK_RESP_HOST).trim() || DEFAULT_TASK_RESP_HOST,
    getEnvViewId = () => String(process.env.BITABLE_TASK_RESP_VIEW_ID || DEFAULT_TASK_RESP_VIEW_ID).trim(),
  } = deps;
  const config = bitableConfigs[configKey];
  const tableId = state.tableId;
  if (!tableId) return;

  const envFormUrl = getEnvFormUrl();
  if (envFormUrl) {
    state.formUrl = envFormUrl;
    log.info('[task_response] Using form URL from env:', envFormUrl);
    return;
  }

  const host = getEnvHost();
  const forcedViewId = getEnvViewId();
  if (forcedViewId) {
    state.formViewId = forcedViewId;
    state.formUrl = `https://${host}/base/${config.appToken}?table=${tableId}&view=${forcedViewId}`;
    log.info('[task_response] Using view ID from env, form URL:', state.formUrl);
    return;
  }

  const token = await getBitableTenantToken(configKey);
  if (!token) return;

  try {
    const viewsResp = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${tableId}/views`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    const views = viewsResp.data?.data?.items || [];
    let formView = views.find((v) => v.view_type === 'form');

    if (!formView) {
      try {
        const cvResp = await axios.post(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${tableId}/views`,
          { view_name: '任务回复表单', view_type: 'form' },
          {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 10000,
          }
        );
        formView = cvResp.data?.data?.view || null;
      } catch (e) {
        log.info('[task_response] Could not create form view:', e?.response?.data?.msg || e?.message);
      }
    }

    const viewId = formView?.view_id || state.formViewId;
    if (viewId) {
      state.formViewId = viewId;
      state.formUrl = `https://${host}/base/${config.appToken}?table=${tableId}&view=${viewId}`;
    } else {
      state.formUrl = `https://${host}/base/${config.appToken}?table=${tableId}`;
    }
    log.info('[task_response] Form URL:', state.formUrl);
  } catch (e) {
    state.formUrl = `https://${host}/base/${config.appToken}?table=${tableId}`;
    log.info('[task_response] Fallback to table URL:', state.formUrl);
  }
}

export async function ensureTaskResponseBitable(deps, state) {
  if (state.initialized && state.tableId) return true;
  if (state.disabled) return false;

  const { axios, bitableConfigs, getBitableTenantToken, log } = deps;
  const configKey = TASK_RESPONSE_CONFIG_KEY;
  const config = bitableConfigs[configKey];

  if (config?.tableId) {
    state.tableId = config.tableId;
    state.initialized = true;
    log.info('[task_response] Using configured table:', config.tableId);
    await ensureTaskResponseFormView(deps, state, configKey);
    return true;
  }

  const token = await getBitableTenantToken(configKey);
  if (!token) {
    log.error('[task_response] No tenant token');
    return false;
  }

  try {
    const createResp = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables`,
      {
        table: {
          name: TASK_RESPONSE_TABLE_NAME,
          default_view_name: '默认视图',
          fields: TASK_RESPONSE_FIELDS,
        },
      },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );
    const newId = createResp.data?.data?.table_id;
    if (!newId) {
      log.error('[task_response] Table creation returned no ID:', createResp.data);
      return false;
    }
    state.tableId = newId;
    config.tableId = newId;
    state.failCount = 0;
    log.info('[task_response] Created new table:', newId);

    await ensureTaskResponseFormView(deps, state, configKey);
    state.initialized = true;
    return true;
  } catch (e) {
    state.failCount++;
    const errCode = e?.response?.data?.code;
    const errMsg = e?.response?.data?.msg || e?.message;
    if (state.failCount <= 2) {
      log.error(
        `[task_response] ensureTaskResponseBitable failed (${state.failCount}/3): code=${errCode} msg=${errMsg}`
      );
    }
    if (state.failCount >= 3) {
      if (errCode === 1254302) {
        log.error(
          '[task_response] ⚠️ Feishu app lacks bitable:app permission — Bitable task response DISABLED. Tasks will still be sent via Feishu messages. To enable: grant permission in Feishu Developer Console or set BITABLE_TASK_RESP_TABLE_ID env var.'
        );
      } else {
        log.error(
          `[task_response] Bitable task response DISABLED after 3 failures. Last error: code=${errCode} msg=${errMsg}`
        );
      }
      state.disabled = true;
    }
    return false;
  }
}

export async function createBitableRecord(deps, configKey, fields) {
  const { axios, bitableConfigs, getBitableTenantToken, log } = deps;
  const config = bitableConfigs[configKey];
  if (!config?.tableId) {
    log.error(`[bitable] createBitableRecord: no table_id for ${configKey}`);
    return null;
  }

  const token = await getBitableTenantToken(configKey);
  if (!token) return null;

  try {
    const resp = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`,
      { fields },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const record = resp.data?.data?.record;
    if (!record?.record_id) {
      log.warn(
        `[bitable][${configKey}] createBitableRecord: no record_id in response. code=${resp.data?.code} msg=${resp.data?.msg} keys=${Object.keys(resp.data?.data || {}).join(',')}`
      );
    } else {
      log.info(`[bitable][${configKey}] created record: ${record.record_id}`);
    }
    return record;
  } catch (e) {
    log.error(`[bitable][${configKey}] createBitableRecord failed:`, e?.response?.data || e?.message);
    return null;
  }
}

export async function updateBitableRecord(deps, configKey, recordId, fields) {
  const { axios, bitableConfigs, getBitableTenantToken, log } = deps;
  const config = bitableConfigs[configKey];
  if (!config?.tableId) return null;

  const token = await getBitableTenantToken(configKey);
  if (!token) return null;

  try {
    const resp = await axios.put(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${recordId}`,
      { fields },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return resp.data?.data?.record || null;
  } catch (e) {
    log.error(`[bitable][${configKey}] updateBitableRecord failed:`, e?.response?.data || e?.message);
    return null;
  }
}

export async function writeTaskToBitable(deps, state, processedIds, task) {
  const { log } = deps;
  const ready = await ensureTaskResponseBitable(deps, state);
  if (!ready) {
    log.warn('[task_response] Bitable not ready, skipping write');
    return null;
  }

  const fields = {
    任务编号: String(task.task_id || ''),
    异常类型: String(task.category || ''),
    门店: String(task.store || ''),
    品牌: String(task.brand || ''),
    严重程度: String(task.severity || 'medium'),
    异常描述: String(task.title || '') + (task.detail ? '\n' + task.detail : ''),
    回复说明: '',
    处理状态: '待回复',
  };

  const record = await createBitableRecord(deps, TASK_RESPONSE_CONFIG_KEY, fields);
  if (record) {
    processedIds.add(`${TASK_RESPONSE_CONFIG_KEY}_${record.record_id}`);
  }
  return record;
}

export function getTaskResponseFormUrl(state, task) {
  const baseUrl = state.formUrl;
  if (!baseUrl) return '';

  const params = new URLSearchParams();
  if (task?.task_id) params.set('prefill_任务编号', task.task_id);
  if (task?.category) params.set('prefill_异常类型', task.category);
  if (task?.store) params.set('prefill_门店', task.store);
  if (task?.brand) params.set('prefill_品牌', task.brand);
  if (task?.severity) params.set('prefill_严重程度', task.severity);
  const desc = String(task?.title || '') + (task?.detail ? '\n' + task.detail : '');
  if (desc.trim()) params.set('prefill_异常描述', desc.trim().slice(0, 500));

  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${params.toString()}`;
}

export function mapGenericRowsToBitableRecords(rows) {
  return (rows || []).map((r) => {
    const raw = (() => {
      try {
        return typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw || {};
      } catch {
        return {};
      }
    })();
    const fields = (() => {
      try {
        return typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields || {};
      } catch {
        return {};
      }
    })();
    return { record_id: r.record_id, fields, ...raw };
  });
}

export function trimProcessedTaskResponseIds(processedIds, maxSize = 5000, trimCount = 2000) {
  if (processedIds.size <= maxSize) return;
  const old = Array.from(processedIds).slice(0, trimCount);
  old.forEach((k) => processedIds.delete(k));
}

export async function collectPhotoUrlsFromFields(deps, fields) {
  const { getBitableRecordImageDownloadUrl } = deps;
  const photos = fields['整改照片'];
  const photoUrls = [];
  if (!Array.isArray(photos)) return photoUrls;
  for (const p of photos) {
    if (p?.file_token) {
      const url = await getBitableRecordImageDownloadUrl(TASK_RESPONSE_CONFIG_KEY, p.file_token);
      if (url) photoUrls.push(url);
    }
  }
  return photoUrls;
}

export async function applyTaskResponse(deps, task, taskId, responseText, photoUrls) {
  const hook = deps.getTaskResponseHook?.();
  if (hook) {
    await hook(task.assignee_username, responseText, photoUrls);
    return;
  }
  await deps.pool().query(
    `UPDATE master_tasks SET response_text = $1, response_images = $2::jsonb, status = 'pending_review', responded_at = NOW(), updated_at = NOW() WHERE task_id = $3`,
    [responseText, JSON.stringify(photoUrls), taskId]
  );
}

export async function pollTaskResponseBitable(deps, state, processedIds) {
  const { pool, bitableConfigs, extractBitableFieldText, log } = deps;
  const ready = await ensureTaskResponseBitable(deps, state);
  if (!ready) return;

  log.info('[task_response] polling for responses...');

  try {
    const config = bitableConfigs[TASK_RESPONSE_CONFIG_KEY];
    if (!config?.tableId) return;

    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const result = await pool().query(
      `SELECT record_id, fields, raw, created_at, updated_at
       FROM feishu_generic_records
       WHERE table_id = $1
         AND (created_at > $2 OR updated_at > $2)
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 100`,
      [config.tableId, cutoff]
    );

    const records = mapGenericRowsToBitableRecords(result.rows);
    let processed = 0;

    for (const record of records) {
      const recordId = record.record_id;
      const fields = record.fields || {};
      const processedKey = `${TASK_RESPONSE_CONFIG_KEY}_${recordId}`;

      if (processedIds.has(processedKey)) continue;

      const taskId = extractBitableFieldText(fields['任务编号']);
      const responseText = extractBitableFieldText(fields['回复说明']);
      const status = extractBitableFieldText(fields['处理状态']);

      if (!taskId || !responseText || status === '已处理') {
        processedIds.add(processedKey);
        continue;
      }

      log.info(`[task_response] Found response for task ${taskId}: ${responseText.slice(0, 80)}...`);

      try {
        const taskResult = await pool().query(
          `SELECT * FROM master_tasks WHERE task_id = $1 AND status = 'pending_response' LIMIT 1`,
          [taskId]
        );
        const task = taskResult.rows?.[0];

        if (!task) {
          log.info(`[task_response] Task ${taskId} not found or not in pending_response`);
          processedIds.add(processedKey);
          continue;
        }

        const photoUrls = await collectPhotoUrlsFromFields(deps, fields);
        await applyTaskResponse(deps, task, taskId, responseText, photoUrls);
        await updateBitableRecord(deps, TASK_RESPONSE_CONFIG_KEY, recordId, { 处理状态: '已处理' });
        processed++;
        log.info(`[task_response] Processed response for ${taskId}`);
      } catch (e) {
        log.error(`[task_response] Error processing ${taskId}:`, e?.message);
      }

      processedIds.add(processedKey);
    }

    if (processed > 0) log.info(`[task_response] Processed ${processed} new responses`);
    trimProcessedTaskResponseIds(processedIds);
  } catch (e) {
    log.error('[task_response] poll error:', e?.message);
  }
}
