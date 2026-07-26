/**
 * Ops Agent task response review — pure parsing / messaging helpers.
 */

export function stripLlmJsonFences(content) {
  return String(content || '')
    .replace(/```json?\n?/g, '')
    .replace(/```/g, '')
    .trim();
}

/** Parse LLM JSON `{ valid, reason?, suggestion? }`; fall back to keyword heuristics. */
export function parseLlmValidReview(content, rejectKeywords = ['无效', '不够', 'false']) {
  const raw = stripLlmJsonFences(content);
  try {
    const parsed = JSON.parse(raw);
    return {
      valid: Boolean(parsed.valid),
      reason: String(parsed.reason || '').trim(),
      suggestion: String(parsed.suggestion || '').trim(),
    };
  } catch (_e) {
    const text = String(content || '');
    const invalid = rejectKeywords.some((kw) => text.includes(kw));
    return {
      valid: !invalid,
      reason: invalid ? text.slice(0, 100) : '',
      suggestion: '',
      heuristic: true,
    };
  }
}

export function buildVisionReviewPrompt(task) {
  return `你是小年，年年有喜餐饮集团AI助理，正在审核员工提交的整改照片。
任务：${task.title || '整改'}
要求：判断照片是否为真实有效的整改证据。
判断标准：1)照片内容与任务相关 2)能看到实际整改结果 3)非模糊/黑屏/无关图片
请回复JSON：{"valid":true/false,"reason":"具体判断理由，说明照片中看到了什么"}`;
}

export function buildTextReviewSystemPrompt(task, sopContext = '') {
  return `你是小年，年年有喜餐饮集团AI助理。请审核员工对异常问题的回复，仅判断回复是否包含了有效的事实描述和整改措施。

审核标准：
1. 回复是否包含对问题的具体调查结果（不能只说"不知道"或"好的"等无实质内容的回复）
2. 回复是否包含具体的整改措施或解决方案
3. 如有照片，是否与问题相关

重要规则：
- 你只负责判断回复是否有效，不要自己编造任何具体的调查建议或产品操作建议
- 不要在reason或suggestion中提及具体产品名称、原料名称、制作流程等你无法确认的信息
- suggestion只能是通用的格式要求，如"请提供具体的调查结果和整改措施"

异常问题：${task.title}
问题详情：${task.detail || ''}${sopContext}

请回复JSON：{"valid":true/false,"reason":"判断理由（不要编造具体建议）","suggestion":"通用改进要求（如有）"}`;
}

export function formatSopContext(sopResults) {
  if (!Array.isArray(sopResults) || !sopResults.length) return '';
  return (
    '\n\n参考SOP标准：\n' +
    sopResults
      .map(
        (r) =>
          `【${r.title}】${String(r.content || '').slice(0, 200)}`
      )
      .join('\n')
  );
}

export function decideReviewOutcome(imageReviewOk, textReviewOk) {
  return imageReviewOk && textReviewOk ? 'resolved' : 'rejected';
}

export function buildReviewResultPayload({
  reviewDecision,
  imageReviewOk,
  textReviewOk,
  reviewNotes,
}) {
  return {
    review_result: {
      decision: reviewDecision,
      imageReviewOk,
      textReviewOk,
      notes: String(reviewNotes || '').trim(),
      reviewedAt: new Date().toISOString(),
    },
  };
}

export function buildReviewNotificationMessage({
  task,
  reviewDecision,
  imageReviewOk,
  textReviewOk,
  reviewNotes,
  responseImages = [],
  responseText = '',
}) {
  const lines = [];
  lines.push(`📋 任务审核结果\n`);
  lines.push(`任务编号：${task.task_id}`);
  if (reviewDecision === 'resolved') {
    lines.push(`审核结论：✅ 通过`);
    if (responseImages.length) {
      lines.push(`照片审核：合格（${responseImages.length}张）`);
    }
    if (responseText) lines.push(`文字回复：已确认有效`);
    lines.push(`\n${reviewNotes || '整改措施已确认，感谢配合。'}`);
  } else {
    lines.push(`审核结论：❌ 未通过`);
    lines.push(`\n未通过原因：`);
    if (!imageReviewOk) lines.push(`· 照片不符合要求`);
    if (!textReviewOk) lines.push(`· 文字回复不满足整改标准`);
    if (reviewNotes) lines.push(`\n详细说明：${reviewNotes}`);
    lines.push(`\n请根据以上反馈重新提交整改结果。`);
  }
  return lines.join('\n');
}
