/**
 * Check Agent quality-gate I/O (P2 peel from agents.js).
 */
import { buildEvidencePackage, detectFactDemand } from './quality-helpers.js';
import {
  fallbackQualityAudit,
  normalizeLlmAuditResult,
  normalizePlainText,
  safeJsonParse,
  verifyNumericGrounding,
} from './check-agent-quality-helpers.js';

export async function checkAgentAuditBody(deps, userQuery, agentResponse, route, options = {}) {
  const { callLLM, log } = deps;
  const evidenceText = String(options?.evidenceText || '').trim();
  const role = String(options?.role || '').trim();
  const auditPrompt = `你是HRMS系统的质检Agent（Check Agent）。你的任务是审核子Agent的回答质量。

【用户问题】
${userQuery}

【子Agent（${route}）的回答】
${agentResponse}

请从以下3个维度评分（每项1-10分），并给出综合判断：
1. **准确性**：回答是否基于事实，有无幻觉或编造内容？
2. **相关性**：回答是否真正解决了用户的问题？
3. **语气**：语气是否专业、得当、不冷漠也不过度？

请严格输出JSON格式：
{
  "accuracy": 分数,
  "relevance": 分数,
  "tone": 分数,
  "total": 综合分数(三项平均),
  "pass": true或false（total>=7为pass）,
  "feedback": "如果不通过，给出具体的修改建议，指出哪里有问题以及如何改进"
}

补充要求：
- 如果回答中出现数字/比例/排名，请检查是否与可用事实一致
- 若“可用事实”为空，不得鼓励编造，请要求明确说明数据缺失

【可用事实】
${evidenceText || '暂无'}

仅返回JSON。`;

  try {
    const llm = await callLLM([{ role: 'system', content: auditPrompt }], {
      temperature: 0.05,
      max_tokens: 420,
      role,
      purpose: 'analysis',
      skipCache: true,
    });

    const parsed = safeJsonParse(llm.content || '', null);
    const normalized = normalizeLlmAuditResult(parsed);
    if (normalized) return normalized;
    return fallbackQualityAudit(userQuery, agentResponse);
  } catch (e) {
    log.error('[check_agent] audit error:', e?.message);
    return fallbackQualityAudit(userQuery, agentResponse);
  }
}

export async function rewriteResponseByAuditBody(deps, { userQuery, response, route: _route, feedback, evidenceText, role }) {
  const { callLLM } = deps;
  const llm = await callLLM(
    [
      {
        role: 'system',
        content: `你是HRMS回复重写器。请在不编造事实的前提下重写回答。
要求：
1) 优先回应用户核心问题
2) 仅使用可用事实，不得新增数据
3) 不超过280字，语言专业直接
4) 若事实不足，明确写“当前系统无此数据”，并给下一步建议
可用事实：${evidenceText || '暂无'}
质检反馈：${feedback || '无'}`,
      },
      { role: 'user', content: `用户问题：${String(userQuery || '')}\n原回答：${String(response || '')}` },
    ],
    {
      temperature: 0.05,
      max_tokens: 420,
      role,
      purpose: 'reasoning',
      skipCache: true,
    }
  );
  return normalizePlainText(llm?.content || response || '', 1500) || String(response || '');
}

export async function runWithCheckAgentBody(deps, userQuery, route, generateFn, maxRetries = 2) {
  const { log, markQualityMetric, recordAgentQualityAudit } = deps;
  let response = await generateFn(null);

  const checkEnabledRoutes = ['chief_evaluator', 'data_auditor', 'appeal', 'train_advisor'];
  if (!checkEnabledRoutes.includes(route)) return response;

  let lastAudit = null;
  let rewriteCount = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const audit = await checkAgentAuditBody(deps, userQuery, response, route);
    lastAudit = audit;
    log.info(`[check_agent] route=${route} attempt=${attempt + 1} pass=${audit.pass} total=${audit.total}`);
    markQualityMetric('audits', 1);

    if (audit.pass !== false) break;
    markQualityMetric('failedAudits', 1);

    log.info(`[check_agent] rewriting: ${audit.feedback}`);
    response = await generateFn(audit.feedback);
    rewriteCount += 1;
    markQualityMetric('rewrites', 1);
  }

  try {
    await recordAgentQualityAudit({
      route,
      username: '',
      queryText: userQuery,
      responseText: response,
      auditResult: lastAudit || {},
      passed: lastAudit?.pass !== false,
      rewriteCount,
    });
  } catch {
    /* ignore */
  }

  return response;
}

export async function enforceUnifiedQualityGateBody(
  deps,
  { userQuery, route, response, agentData, senderUsername, senderRole, store, brand }
) {
  const { markQualityMetric, recordAgentQualityAudit } = deps;
  const checkEnabledRoutes = ['chief_evaluator', 'data_auditor', 'ops_supervisor', 'appeal', 'train_advisor'];
  if (!checkEnabledRoutes.includes(route)) return { response, agentData };
  if (agentData?.deterministic === true) {
    return {
      response,
      agentData: {
        ...(agentData || {}),
        qualityAudit: { pass: true, total: 0, rewriteCount: 0, skipped: 'deterministic' },
      },
    };
  }

  let nextResponse = String(response || '');
  const nextAgentData = { ...(agentData || {}) };
  const evidence = buildEvidencePackage(nextAgentData, { route, store, brand });
  const evidenceText = JSON.stringify(evidence);

  let audit = await checkAgentAuditBody(deps, userQuery, nextResponse, route, {
    evidenceText,
    role: senderRole,
  });
  let rewriteCount = 0;
  markQualityMetric('audits', 1);

  if (audit.pass === false) {
    markQualityMetric('failedAudits', 1);
    nextResponse = await rewriteResponseByAuditBody(deps, {
      userQuery,
      response: nextResponse,
      route,
      feedback: audit.feedback,
      evidenceText,
      role: senderRole,
    });
    rewriteCount += 1;
    markQualityMetric('rewrites', 1);
    audit = await checkAgentAuditBody(deps, userQuery, nextResponse, route, {
      evidenceText,
      role: senderRole,
    });
    markQualityMetric('audits', 1);
  }

  if (route === 'data_auditor' && detectFactDemand(userQuery) === 'hard') {
    const numericCheck = verifyNumericGrounding(
      nextResponse,
      evidenceText + '\n' + String(nextAgentData?.groundingFacts || '')
    );
    if (!numericCheck.ok) {
      markQualityMetric('numericViolations', 1);
      nextResponse = `当前问题需要精确数字支撑，我暂时无法在现有证据中完成可靠计算。建议先补齐数据后重试。`;
      nextAgentData.numericGroundingBlocked = true;
      nextAgentData.numericMissing = numericCheck.missing;
      audit = { ...(audit || {}), pass: false, feedback: 'numeric_grounding_failed' };
    }
  }

  await recordAgentQualityAudit({
    route,
    username: senderUsername,
    queryText: userQuery,
    responseText: nextResponse,
    auditResult: { ...(audit || {}), evidence },
    passed: audit?.pass !== false,
    rewriteCount,
  });

  nextAgentData.qualityAudit = {
    pass: audit?.pass !== false,
    total: Number(audit?.total || 0),
    rewriteCount,
  };
  return { response: nextResponse, agentData: nextAgentData };
}
