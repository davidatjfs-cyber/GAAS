const _biConversationCtx = new Map();
const BI_CONV_CTX_TTL = 10 * 60 * 1000;
const BI_CONV_CTX_MAX = 4;

export function getBiConversationHistory(userId) {
  const entry = _biConversationCtx.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.ts > BI_CONV_CTX_TTL) {
    _biConversationCtx.delete(userId);
    return [];
  }
  return entry.history || [];
}

export function pushBiConversationTurn(userId, userText, assistantText, toolName) {
  const entry = _biConversationCtx.get(userId) || { ts: Date.now(), history: [] };
  entry.ts = Date.now();
  entry.history.push({ role: 'user', q: String(userText || '').slice(0, 120), tool: toolName || '' });
  entry.history.push({ role: 'assistant', a: String(assistantText || '').slice(0, 200) });
  if (entry.history.length > BI_CONV_CTX_MAX * 2) entry.history = entry.history.slice(-BI_CONV_CTX_MAX * 2);
  _biConversationCtx.set(userId, entry);
}

/** @internal test helper */
export function _resetBiConversationCtxForTests() {
  _biConversationCtx.clear();
}
