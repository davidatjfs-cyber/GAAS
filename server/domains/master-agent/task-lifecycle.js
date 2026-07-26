/**
 * Master task lifecycle — ID generation, events, transitions, creation.
 */
import {
  appendStatusTimestampSets,
  getAgentForStatus,
  isValidTransition,
  shouldSyncAnomalyTriggersOnClose,
} from './status-flow.js';
import { normalizeTaskSourceData } from './resolve-assignee.js';

export { STATUS_FLOW } from './status-flow.js';

let _taskSeq = 0;

export function resetTaskIdSequenceForTests() {
  _taskSeq = 0;
}

/** Seed sequence from MAX(master_tasks.id) at master startup (global, not per-tenant). */
export function seedTaskIdSequence(maxId) {
  _taskSeq = Number(maxId || 0);
}

export function generateTaskId(now = new Date()) {
  const ds = now.toISOString().slice(0, 10).replace(/-/g, '');
  _taskSeq += 1;
  return `MT-${ds}-${String(_taskSeq).padStart(4, '0')}`;
}

export async function emitEvent(
  getPool,
  log,
  taskId,
  eventType,
  fromAgent,
  toAgent,
  statusBefore,
  statusAfter,
  payload = {},
  tenantId = 'default'
) {
  try {
    await getPool().query(
      `INSERT INTO master_events (task_id, event_type, from_agent, to_agent, status_before, status_after, payload, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        taskId,
        eventType,
        fromAgent,
        toAgent,
        statusBefore,
        statusAfter,
        JSON.stringify(payload),
        tenantId,
      ]
    );
  } catch (e) {
    log.error('[master] emitEvent failed:', e?.message);
  }
}

function appendTransitionDataSets(data, sets, params, startIdx) {
  let idx = startIdx;
  const pushJson = (column, value) => {
    sets.push(`${column} = $${idx}::jsonb`);
    params.push(JSON.stringify(value));
    idx += 1;
  };
  const pushScalar = (column, value) => {
    sets.push(`${column} = $${idx}`);
    params.push(value);
    idx += 1;
  };

  if (data.audit_result) pushJson('audit_result', data.audit_result);
  if (data.dispatch_data) pushJson('dispatch_data', data.dispatch_data);
  if (data.response_text !== undefined) pushScalar('response_text', data.response_text);
  if (data.response_images) pushJson('response_images', data.response_images);
  if (data.review_result) pushJson('review_result', data.review_result);
  if (data.settlement_data) pushJson('settlement_data', data.settlement_data);
  if (data.score_impact !== undefined) pushScalar('score_impact', data.score_impact);
  if (data.assignee_username) pushScalar('assignee_username', data.assignee_username);
  if (data.assignee_role) pushScalar('assignee_role', data.assignee_role);
  if (data.title) pushScalar('title', data.title);
  if (data.detail) pushScalar('detail', data.detail);
  if (data.severity) pushScalar('severity', data.severity);
  if (data.feishu_msg_id) {
    sets.push(`feishu_msg_ids = feishu_msg_ids || $${idx}::jsonb`);
    params.push(JSON.stringify([data.feishu_msg_id]));
    idx += 1;
  }
  return idx;
}

async function syncBiAnomalyTriggersOnClose(getPool, log, task) {
  try {
    const sd = normalizeTaskSourceData(task.source_data);
    const ak = String(sd.anomaly_key || task.category || '').trim();
    const td = String(sd.bi_trigger_date || '').slice(0, 10);
    if (ak && ak !== 'food_safety' && /^\d{4}-\d{2}-\d{2}$/.test(td)) {
      await getPool().query(
        `UPDATE anomaly_triggers SET status = 'closed', updated_at = NOW()
         WHERE anomaly_key = $1 AND store = $2 AND trigger_date = $3::date
           AND COALESCE(status, 'open') IN ('open', 'pending_data')`,
        [ak, task.store, td]
      );
    }
  } catch (e) {
    log.warn('[master] sync anomaly_triggers on bi_anomaly close:', e?.message || e);
  }
}

export async function transitionTask(
  getPool,
  log,
  taskId,
  newStatus,
  agentName,
  data = {},
  tenantId = 'default'
) {
  try {
    const r = await getPool().query(
      `SELECT * FROM master_tasks WHERE task_id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );
    const task = r.rows?.[0];
    if (!task) {
      log.error('[master] task not found:', taskId);
      return null;
    }

    const currentStatus = task.status;
    if (!isValidTransition(currentStatus, newStatus)) {
      log.error(
        `[master] invalid transition: ${currentStatus} → ${newStatus} for task ${taskId}`
      );
      return null;
    }

    const sets = ['status = $2', 'current_agent = $3', 'updated_at = NOW()'];
    const params = [taskId, newStatus, agentName];
    appendTransitionDataSets(data, sets, params, 4);
    appendStatusTimestampSets(newStatus, sets);

    await getPool().query(
      `UPDATE master_tasks SET ${sets.join(', ')} WHERE task_id = $1 AND tenant_id = $${params.length + 1}`,
      [...params, tenantId]
    );

    if (shouldSyncAnomalyTriggersOnClose(newStatus, task.source)) {
      await syncBiAnomalyTriggersOnClose(getPool, log, task);
    }

    await emitEvent(
      getPool,
      log,
      taskId,
      `status_${newStatus}`,
      agentName,
      getAgentForStatus(newStatus),
      currentStatus,
      newStatus,
      data,
      tenantId
    );

    log.info(`[master] ${taskId}: ${currentStatus} → ${newStatus} (by ${agentName})`);
    return { ...task, status: newStatus };
  } catch (e) {
    log.error('[master] transitionTask failed:', e?.message);
    return null;
  }
}

export async function createTask(
  getPool,
  log,
  { extractAnomalyRelations } = {},
  {
    source,
    sourceRef,
    category,
    severity,
    store,
    brand,
    title,
    detail,
    sourceData,
  },
  tenantId = 'default'
) {
  const taskId = generateTaskId();
  try {
    await getPool().query(
      `INSERT INTO master_tasks (task_id, status, source, source_ref, current_agent, category, severity, store, brand, title, detail, source_data, tenant_id)
       VALUES ($1, 'pending_dispatch', $2, $3, 'master', $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        taskId,
        source || 'scheduled_audit',
        sourceRef || '',
        category,
        severity || 'medium',
        store,
        brand,
        title,
        detail,
        JSON.stringify(sourceData || {}),
        tenantId,
      ]
    );
    await emitEvent(
      getPool,
      log,
      taskId,
      'task_created',
      'data_auditor',
      'master',
      null,
      'pending_dispatch',
      { category, severity, store },
      tenantId
    );
    if (typeof extractAnomalyRelations === 'function') {
      try {
        await extractAnomalyRelations({
          task_id: taskId,
          category,
          severity,
          store,
          brand,
          title,
          detail,
          created_at: new Date(),
        });
      } catch (_e) {
        /* ignore */
      }
    }
    log.info(`[master] Task created: ${taskId} [${category}] ${store}`);
    return taskId;
  } catch (e) {
    log.error('[master] createTask failed:', e?.message);
    return null;
  }
}
