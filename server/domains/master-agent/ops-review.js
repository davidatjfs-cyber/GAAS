/**
 * Ops Agent — Part 2: pending_review feedback review.
 */
import {
  buildReviewNotificationMessage,
  buildReviewResultPayload,
  buildTextReviewSystemPrompt,
  buildVisionReviewPrompt,
  decideReviewOutcome,
  formatSopContext,
  parseLlmValidReview,
} from './ops-review-helpers.js';

export async function processOpsReview(deps, tenantId = 'default') {
  const {
    pool,
    transitionTask,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    prefixWithAgentName,
    callLLM,
    callVisionLLM,
    queryKnowledgeBase,
  } = deps;

  let actions = 0;
  const r = await pool().query(
    `SELECT * FROM master_tasks WHERE status = 'pending_review' AND tenant_id = $1 ORDER BY responded_at ASC LIMIT 5`,
    [tenantId]
  );

  for (const task of r.rows || []) {
    const responseText = task.response_text || '';
    const responseImages = Array.isArray(task.response_images) ? task.response_images : [];

    if (!responseText && !responseImages.length) continue;

    let reviewNotes = '';

    let imageReviewOk = true;
    if (responseImages.length) {
      for (const imgUrl of responseImages) {
        const vr = await callVisionLLM(imgUrl, buildVisionReviewPrompt(task));
        const parsed = parseLlmValidReview(vr.content, ['不合格', '无效', 'false']);
        if (!parsed.valid) {
          imageReviewOk = false;
          reviewNotes += `图片不合格: ${parsed.reason}; `;
        }
      }
    }

    let textReviewOk = true;
    if (responseText) {
      let sopContext = '';
      try {
        const sopResults = await queryKnowledgeBase(['sop', '整改', '标准'], task.category || '', 2);
        sopContext = formatSopContext(sopResults);
      } catch (_e) {
        /* ignore */
      }

      const llm = await callLLM([
        { role: 'system', content: buildTextReviewSystemPrompt(task, sopContext) },
        { role: 'user', content: `员工回复：${responseText}` },
      ], { skipCache: true, temperature: 0.05 });

      const parsed = parseLlmValidReview(llm.content);
      if (!parsed.valid) {
        textReviewOk = false;
        reviewNotes += `回复不足: ${parsed.reason}; `;
      }
      if (parsed.suggestion) reviewNotes += `建议: ${parsed.suggestion}; `;
    }

    const reviewDecision = decideReviewOutcome(imageReviewOk, textReviewOk);

    const result = await transitionTask(task.task_id, reviewDecision, 'ops_supervisor', {
      review_result: buildReviewResultPayload({
        reviewDecision,
        imageReviewOk,
        textReviewOk,
        reviewNotes,
      }).review_result,
    }, tenantId);

    if (result) {
      if (task.assignee_username) {
        const fu = await lookupFeishuUserByUsername(task.assignee_username);
        if (fu?.open_id) {
          const message = buildReviewNotificationMessage({
            task,
            reviewDecision,
            imageReviewOk,
            textReviewOk,
            reviewNotes,
            responseImages,
            responseText,
          });
          await sendLarkMessage(fu.open_id, prefixWithAgentName('ops_supervisor', message));
        }
      }
      actions++;
    }
  }

  return actions;
}

export async function runOpsReviewCycle(deps, tenantId = 'default') {
  try {
    return await processOpsReview(deps, tenantId);
  } catch (e) {
    deps.log.error('[master:ops] review error:', e?.message);
    return 0;
  }
}
