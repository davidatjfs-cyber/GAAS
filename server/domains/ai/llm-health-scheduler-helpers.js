/**
 * Pure helpers for LLM health summary / provider probe list (P2 peel from agents.js).
 */

export function buildLlmHealthProviders({
  deepseekModel, deepseekApiKey, deepseekBaseUrl,
  qwenModel, qwenApiKey, qwenBaseUrl,
  doubaoModel, doubaoApiKey, doubaoBaseUrl,
}) {
  return [
    { name: 'DeepSeek', model: deepseekModel, apiKey: deepseekApiKey, baseUrl: deepseekBaseUrl },
    { name: 'Qwen', model: qwenModel, apiKey: qwenApiKey, baseUrl: qwenBaseUrl },
    { name: 'Doubao(Vision)', model: doubaoModel, apiKey: doubaoApiKey, baseUrl: doubaoBaseUrl },
  ];
}

export const LLM_HEALTH_PROVIDER_KEY_MAP = {
  DeepSeek: 'deepseek',
  Qwen: 'qwen',
  'Doubao(Vision)': 'doubao',
};

export function summarizeLlmHealthResults(results) {
  return results.map((r) => `${r.ok ? '✅' : '❌'} ${r.name}(${r.model || '?'}): ${r.ok ? r.reply : r.error}`).join('\n');
}

export function buildLlmFailureFallbackNote(results) {
  const healthyProviders = results.filter((r) => r.ok).map((r) => r.name);
  const downProviders = results.filter((r) => !r.ok).map((r) => r.name);
  if (healthyProviders.length > 0) {
    return `\n\n🔄 自动降级已激活：${downProviders.join('、')} 不可用时，Agent 将自动切换到 ${healthyProviders.join('、')} 继续工作。`;
  }
  return '\n\n⚠️ 所有 Provider 均不可用，Agent 将完全无法响应！';
}

export function createErrorTrackerState(alertCooldownMs = 10 * 60 * 1000) {
  return { consecutiveLLMErrors: 0, lastAlertTime: 0, alertCooldownMs };
}

export function createLlmHealthState() {
  return { lastAllOk: null, lastSummary: '' };
}
