/**
 * 敏感数据脱敏工具
 * 用于在把用户原始消息发给外部 LLM（DeepSeek/Qwen/豆包）之前，剥离/打码手机号、身份证号等敏感信息，
 * 避免用户隐私信息被明文发送给第三方 LLM 服务商。
 */

// 中国大陆手机号：1[3-9]开头共11位
const PHONE_RE = /1[3-9]\d{9}/g;
// 中国大陆身份证号：15位或18位（18位末位可能为X/x）
const ID_CARD_RE = /\b\d{15}\b|\b\d{17}[\dXx]\b/g;

/**
 * 对文本中的手机号/身份证号做部分打码，其余内容原样保留。
 */
export function maskSensitiveText(text) {
  const str = String(text ?? '');
  if (!str) return str;
  let masked = str.replace(PHONE_RE, (m) => `${m.slice(0, 3)}****${m.slice(7)}`);
  masked = masked.replace(ID_CARD_RE, (m) => `${m.slice(0, 4)}${'*'.repeat(m.length - 8)}${m.slice(-4)}`);
  return masked;
}

/**
 * 对 callLLM 的 messages 数组做脱敏，返回新数组，不修改原始 messages（及其内部对象）。
 */
export function maskLLMMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    if (typeof m.content !== 'string') return m;
    return { ...m, content: maskSensitiveText(m.content) };
  });
}
