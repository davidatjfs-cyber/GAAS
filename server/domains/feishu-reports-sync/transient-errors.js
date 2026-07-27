/**
 * 飞书表格同步：瞬态错误分类 + sleep 工具。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */

/** 与 agents bitable-poller 对齐：大表/索引常见 1254607「Data not ready」等为瞬态，不应双写告警轰炸 */
export function isTransientFeishuBitableError(errText) {
  const s = String(errText || '');
  return /1254002|1254607|1255001|1255002|1255003|1255004|1255005|1255040|1254200|feishu_code_2200|internal[\s_]?error|rpc[\s_]?error|marshal[\s_]?error|data not ready|try again later|timeout|ECONNABORTED|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|429|502|503|504/i.test(
    s
  );
}

export function isDataNotReadyError(errText) {
  return /1254607|data not ready|try again later/i.test(String(errText || ''));
}

export function isFeishuInternalError(errText) {
  return /1254002|1255001|1255002|1255003|1255004|1255005|1255040|feishu_code_2200|internal[\s_]?error|rpc[\s_]?error|marshal[\s_]?error/i.test(String(errText || ''));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
