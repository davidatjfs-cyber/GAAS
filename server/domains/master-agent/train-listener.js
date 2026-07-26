/**
 * Train Agent listener — SOP cases, auto-preparation, publish flow.
 */
export function createTrainAgentListener(deps) {
  const {
    pool,
    log,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    prefixWithAgentName,
    queryKnowledgeBase,
    resolveAssignee,
    getSharedState,
  } = deps;

  return async function trainAgentListener(tenantId = 'default') {
    let actions = 0;

    try {
      actions += await processDraftTrainingNeeds({
        pool,
        log,
        lookupFeishuUserByUsername,
        sendLarkMessage,
        prefixWithAgentName,
        queryKnowledgeBase,
        tenantId,
      });

      actions += await processDetailedBadReviews({
        pool,
        log,
        lookupFeishuUserByUsername,
        sendLarkMessage,
        prefixWithAgentName,
        resolveAssignee,
        tenantId,
      });

      actions += await processPendingSopConfirm({
        pool,
        lookupFeishuUserByUsername,
        sendLarkMessage,
        prefixWithAgentName,
        resolveAssignee,
        tenantId,
      });

      actions += await processConfirmedSopCases({
        pool,
        log,
        getSharedState,
        tenantId,
      });
    } catch (e) {
      log.error('[master:sop] listener error:', e?.message);
    }

    return actions;
  };
}

async function processDraftTrainingNeeds({
  pool,
  log,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  prefixWithAgentName,
  queryKnowledgeBase,
  tenantId,
}) {
  let actions = 0;
  const draftNeeds = await pool().query(
    `SELECT * FROM training_tasks WHERE status = 'draft_need' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
    [tenantId]
  );

  for (const task of draftNeeds.rows || []) {
    let trainingOutline = `培训主题：${task.title}\n培训目标：改善近期绩效扣分项，提升标准执行力\n\n`;
    try {
      const queryTerm = task.title.replace('专项提升：', '').replace('改善', '');
      const kbResults = await queryKnowledgeBase(['sop', '标准', queryTerm], queryTerm, 3, {
        brandTag: task.brand,
      });
      if (kbResults.length > 0) {
        trainingOutline += `【推荐学习资料】\n${kbResults.map((r, i) => `${i + 1}. 《${r.title}》`).join('\n')}`;
      } else {
        trainingOutline += `【需补充资料】未在知识库中找到关于"${queryTerm}"的详细资料，请管理员补充。`;
      }
    } catch (e) {
      log.error('[master:train] auto-preparation failed:', e?.message);
    }

    const progressData = {
      ...(task.progress_data || {}),
      outline: trainingOutline,
      prepared_at: new Date().toISOString(),
    };

    await pool().query(
      `UPDATE training_tasks SET status = 'pending_approval', progress_data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(progressData), task.id]
    );

    const fu = await lookupFeishuUserByUsername('admin');
    if (fu?.open_id) {
      const msg = prefixWithAgentName(
        'train_advisor',
        `📝 自动培训备课需审核 [${task.task_id}]\n\n` +
          `由于 ${task.assignee_username} 近期绩效扣分触发阈值，我已为其生成专属培训计划：\n` +
          `课程：${task.title}\n\n` +
          `【备课大纲】\n${trainingOutline}\n\n` +
          `请确认该计划是否合理，是否需要补充外部资料。确认后请回复“审核通过，准许下发”，我将推送给员工。`
      );
      await sendLarkMessage(fu.open_id, msg);
    }
    actions++;
    log.info(`[master:train] Auto-prepared training ${task.task_id} for ${task.assignee_username}`);
  }

  return actions;
}

async function processDetailedBadReviews({
  pool,
  log,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  prefixWithAgentName,
  resolveAssignee,
  tenantId,
}) {
  let actions = 0;
  const detailedReviews = await pool().query(
    `SELECT * FROM bad_reviews
     WHERE has_detailed_event = TRUE AND sop_case_id IS NULL AND status = 'open' AND tenant_id = $1
     ORDER BY created_at ASC LIMIT 5`,
    [tenantId]
  );

  for (const review of detailedReviews.rows || []) {
    const caseId = `SOP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const r = await pool().query(
      `INSERT INTO sop_cases (case_id, source_review_id, store, brand, event_detail, status, created_by, tenant_id)
       VALUES ($1, $2, $3, $4, $5, 'draft', 'train_agent', $6)
       RETURNING id`,
      [caseId, review.id, review.store, review.brand, review.event_detail || review.content, tenantId]
    );
    const sopCaseId = r.rows?.[0]?.id;

    if (sopCaseId) {
      await pool().query(
        `UPDATE bad_reviews SET status = 'processing', sop_case_id = $1 WHERE id = $2`,
        [sopCaseId, review.id]
      );

      const assignee = await resolveAssignee(
        review.review_type === 'product' ? '产品差评异常' : '服务差评异常',
        review.store
      );
      if (assignee?.username) {
        const fu = await lookupFeishuUserByUsername(assignee.username);
        if (fu?.open_id) {
          const msg = prefixWithAgentName(
            'train_advisor',
            `📚 SOP案例分析请求 [${caseId}]\n\n` +
              `门店：${review.store}\n` +
              `类型：${review.review_type === 'product' ? '产品差评' : '服务差评'}\n\n` +
              `事件详情：\n${review.event_detail || review.content}\n\n` +
              `请回复您了解到的具体事件详细过程，以及改进建议。`
          );
          await sendLarkMessage(fu.open_id, msg);
        }
      }
      actions++;
      log.info(`[master:sop] Created SOP case ${caseId} for review ${review.id}`);
    }
  }

  return actions;
}

async function processPendingSopConfirm({
  pool,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  prefixWithAgentName,
  resolveAssignee,
  tenantId,
}) {
  let actions = 0;
  const pendingCases = await pool().query(
    `SELECT * FROM sop_cases WHERE status = 'pending_confirm' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
    [tenantId]
  );

  for (const sopCase of pendingCases.rows || []) {
    const assignee = await resolveAssignee('产品差评异常', sopCase.store);
    if (assignee?.username) {
      const fu = await lookupFeishuUserByUsername(assignee.username);
      if (fu?.open_id) {
        const msg = prefixWithAgentName(
          'train_advisor',
          `✅ SOP案例分析待确认 [${sopCase.case_id}]\n\n` +
            `门店：${sopCase.store}\n\n` +
            `分析内容：\n${sopCase.analysis || ''}\n\n` +
            `改进措施：\n${sopCase.improvement_actions || ''}\n\n` +
            `请确认是否可以执行。回复"确认"通过，或回复修改意见。`
        );
        await sendLarkMessage(fu.open_id, msg);
      }
    }
    actions++;
  }

  return actions;
}

async function processConfirmedSopCases({ pool, log, getSharedState, tenantId }) {
  let actions = 0;
  const confirmedCases = await pool().query(
    `SELECT * FROM sop_cases WHERE status = 'confirmed' AND tenant_id = $1 ORDER BY confirmed_at ASC LIMIT 5`,
    [tenantId]
  );

  for (const sopCase of confirmedCases.rows || []) {
    await pool().query(
      `UPDATE sop_cases SET status = 'published', published_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [sopCase.id, tenantId]
    );

    try {
      const state = await getSharedState();
      if (state?.knowledgeBase) {
        log.info(`[master:sop] Case ${sopCase.case_id} published to SOP library`);
      }
    } catch (_e) {
      /* ignore */
    }

    actions++;
  }

  return actions;
}
