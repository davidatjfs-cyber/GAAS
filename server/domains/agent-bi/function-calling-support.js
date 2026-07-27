import {
  BI_FUNCTION_TOOLS,
  normalizeIntentPlan,
  parseToolArgs,
  tryParseJsonObjectFromText,
} from './function-calling-tools.js';
import {
  _resetBiConversationCtxForTests,
  getBiConversationHistory,
  pushBiConversationTurn,
} from './function-calling-conversation.js';
import {
  buildBiIntentPlan as buildPlan,
  narrateBiToolResult as narrateResult,
} from './function-calling-llm.js';

export function createBiFunctionCallingSupport(deps) {
  return {
    BI_FUNCTION_TOOLS,
    parseToolArgs,
    tryParseJsonObjectFromText,
    normalizeIntentPlan,
    getBiConversationHistory,
    pushBiConversationTurn,
    _resetBiConversationCtxForTests,
    buildBiIntentPlan: (text, safeStore, conversationHistory, senderRole) =>
      buildPlan(deps, text, safeStore, conversationHistory, senderRole),
    narrateBiToolResult: (userText, toolText, store, senderRole) =>
      narrateResult(deps, userText, toolText, store, senderRole),
  };
}
