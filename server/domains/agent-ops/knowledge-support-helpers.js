/**
 * Ops knowledge support helpers (P2 peel from agents.js getOpsKnowledgeSupport).
 */
import { resolveTenantIdDefault } from '../../utils/database.js';
import { getAllBrandNamesSync } from '../../utils/brand-config-loader.js';

export function matchStandardOpsKnowledgeAnswer(query, standardResponses) {
  const standardAnswers = {
    生蚝个头偏小: standardResponses.smallOysters,
    冰箱温度: standardResponses.fridgeTemperature,
    洗手: standardResponses.handWashing,
  };
  for (const [key, answer] of Object.entries(standardAnswers)) {
    if (String(query || '').includes(key)) {
      return { type: 'standard', response: answer, source: 'standard_responses' };
    }
  }
  return null;
}

export function mergeOpsKnowledgeResults(knowledge, bitableResults) {
  let kbResults = Array.isArray(knowledge) ? [...knowledge] : [];
  if (Array.isArray(bitableResults) && bitableResults.length > 0) {
    kbResults = kbResults.concat(
      bitableResults.map((r) => ({
        title: `Bitable数据 - ${r.content_type}`,
        content: `${r.content}\n数据时间: ${new Date(r.created_at).toLocaleString()}`,
        source: 'bitable',
      }))
    );
  }
  return kbResults;
}

/**
 * @param {object} deps
 */
export async function getOpsKnowledgeSupportBody(deps, query, context = {}) {
  const {
    log,
    callLLM,
    queryAgentData,
    getOpsAgentConfig,
    getOpsReasoningModel,
  } = deps;
  const store = context.store || '';
  const brand = context.brand || '';
  const config = getOpsAgentConfig().knowledgeSupport;

  const standard = matchStandardOpsKnowledgeAnswer(query, config.standardResponses);
  if (standard) return standard;

  let kbResults = [];
  try {
    const brandTag = brand ? `brand:${brand}` : '';
    const agentData = await queryAgentData(['sop', '流程', '标准', '规范'], query, 5, { brandTag });
    kbResults = mergeOpsKnowledgeResults(agentData.knowledge || [], agentData.bitable || []);
  } catch (e) {
    log.error('[ops_supervisor] data query failed:', e?.message);
  }

  if (kbResults.length > 0) {
    const kbContent = kbResults.map((r) => `【${r.title}】${r.content}`).join('\n\n');
    return {
      type: 'knowledge_base',
      response: `根据相关SOP标准：\n\n${kbContent}`,
      source: 'knowledge_base',
      results: kbResults,
    };
  }

  try {
    const llmResult = await callLLM(
      [
        {
          role: 'system',
          content: `你是小年，年年有喜餐饮集团AI助理，精通${getAllBrandNamesSync(resolveTenantIdDefault()).join('和') || '本集团'}品牌标准。当前门店：${store}（${brand}）。请提供专业、可操作的建议。`,
        },
        { role: 'user', content: query },
      ],
      { model: getOpsReasoningModel() }
    );

    if (llmResult.ok && llmResult.content) {
      return {
        type: 'llm_generated',
        response: llmResult.content,
        source: 'ai_advisor',
      };
    }
  } catch (e) {
    log.error('[ops_supervisor] llm advice failed:', e?.message);
  }

  return {
    type: 'fallback',
    response: '这个问题需要进一步核实，请联系值班经理处理。',
    source: 'fallback',
  };
}
