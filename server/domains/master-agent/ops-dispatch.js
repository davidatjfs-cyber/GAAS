/**
 * Ops Agent — Part 1: dispatch notify (Bitable + Feishu card).
 */

export function createOpsDispatchState() {
  return {
    bitableWrittenTaskIds: new Set(),
    dispatchRetryCount: new Map(),
  };
}

export async function processOpsDispatchNotify(deps, state, tenantId = 'default') {
  const {
    pool,
    log,
    transitionTask,
    lookupFeishuUserByUsername,
    writeTaskToBitable,
    getTaskResponseFormUrl,
    buildTaskDispatchCard,
    sendLarkCard,
  } = deps;

  let actions = 0;
  const r = await pool().query(
    `SELECT * FROM master_tasks WHERE status = 'dispatched' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
    [tenantId]
  );

  for (const task of r.rows || []) {
    if (!state.bitableWrittenTaskIds.has(task.task_id)) {
      const bitableRecord = await writeTaskToBitable(task);
      if (bitableRecord?.record_id) {
        try {
          await pool().query(
            `UPDATE master_tasks
             SET source_data = COALESCE(source_data, '{}'::jsonb) || $1::jsonb,
                 updated_at = NOW()
             WHERE task_id = $2 AND tenant_id = $3`,
            [
              JSON.stringify({ task_response_record_id: bitableRecord.record_id }),
              task.task_id,
              tenantId,
            ]
          );
        } catch (e) {
          log.error('[master:ops] persist task_response_record_id failed:', e?.message);
        }
      }
      state.bitableWrittenTaskIds.add(task.task_id);
    }

    if (!task.assignee_username) continue;

    const fu = await lookupFeishuUserByUsername(task.assignee_username);
    if (!fu?.open_id) {
      const retries = (state.dispatchRetryCount.get(task.task_id) || 0) + 1;
      state.dispatchRetryCount.set(task.task_id, retries);
      if (retries <= 1) {
        log.warn(
          `[master:ops] No Feishu user for ${task.assignee_username} (task ${task.task_id}), will auto-transition after 3 retries`
        );
      }
      if (retries >= 3) {
        log.warn(
          `[master:ops] Forcing ${task.task_id} to pending_response (no Feishu user after ${retries} retries)`
        );
        await transitionTask(task.task_id, 'pending_response', 'ops_supervisor', {
          note: `Auto-transitioned: no Feishu user found for ${task.assignee_username}`,
        }, tenantId);
        state.dispatchRetryCount.delete(task.task_id);
        actions++;
      }
      continue;
    }

    const formUrl = getTaskResponseFormUrl(task);

    let isFirstDispatch = true;
    try {
      const evR = await pool().query(
        `SELECT COUNT(*) as cnt FROM master_events WHERE task_id = $1 AND event_type = 'status_change' AND status_after = 'dispatched' AND tenant_id = $2`,
        [task.task_id, tenantId]
      );
      isFirstDispatch = parseInt(evR.rows[0]?.cnt || '0', 10) === 0;
    } catch (_e) {
      /* ignore */
    }

    const card = buildTaskDispatchCard(task, formUrl, { isFirstDispatch });
    const sendResult = await sendLarkCard(fu.open_id, card);

    if (sendResult?.ok) {
      log.info('[master:ops] sendLarkCard result:', JSON.stringify(sendResult.data));
      const msgId = sendResult.data?.data?.message_id || sendResult.data?.message_id || '';
      log.info('[master:ops] extracted message_id:', msgId);
      await transitionTask(task.task_id, 'pending_response', 'ops_supervisor', {
        feishu_msg_id: msgId,
      }, tenantId);

      try {
        await pool().query(
          `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, routed_to, content_type, content, tenant_id)
           VALUES ('out','feishu',$1,'system','Master Agent','ops_supervisor','card',$2,$3)`,
          [fu.open_id, `异常通知卡片 [${task.task_id}] - 回复表单已发送`, tenantId]
        );
      } catch (_e) {
        /* ignore */
      }
      actions++;
    }
  }

  return actions;
}
