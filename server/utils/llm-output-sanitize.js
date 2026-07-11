/**
 * LLM 输出净化
 * LLM 返回的自由文本（营销文案/方案建议等）在透传给用户展示前，剥离零宽字符/隐写术常用的
 * 不可见控制字符（常被用作 prompt 注入的隐藏载荷），并对命中情况做审计记录。
 *
 * 实现说明：用码点数值判断而非在正则里直接写不可见字符字面量，避免源码里混入难以校验的隐藏字符。
 */

import { logAgentOperation } from './agent-audit-log.js';

// 零宽字符：ZWSP(0x200B) / ZWNJ(0x200C) / ZWJ(0x200D) / BOM/ZWNBSP(0xFEFF)
const ZERO_WIDTH_CODEPOINTS = new Set([0x200B, 0x200C, 0x200D, 0xFEFF]);

// Cc 类控制字符，保留常用的 \t(0x09) \n(0x0A) \r(0x0D)
function isStrippableControlCode(code) {
  if (code <= 0x08) return true; // U+0000-U+0008
  if (code === 0x0B || code === 0x0C) return true; // 垂直制表符 / 换页符
  if (code >= 0x0E && code <= 0x1F) return true; // U+000E-U+001F
  if (code === 0x7F) return true; // DEL
  return false;
}

/**
 * 剥离文本中的零宽字符/不可见控制字符，返回净化后的文本。
 */
export function sanitizeLLMOutput(text) {
  const str = String(text ?? '');
  if (!str) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (ZERO_WIDTH_CODEPOINTS.has(code) || isStrippableControlCode(code)) continue;
    out += str[i];
  }
  return out;
}

/**
 * 净化 LLM 输出，若命中可疑的隐藏字符，则记录一条 status='warning' 的审计日志（仅记录，不拦截）。
 */
export async function sanitizeLLMOutputWithAudit(pool, text, ctx = {}) {
  const original = String(text ?? '');
  const sanitized = sanitizeLLMOutput(original);
  if (sanitized !== original && pool) {
    await logAgentOperation(pool, {
      ...ctx,
      toolName: 'llm_output_sanitize',
      resultSummary: `stripped ${original.length - sanitized.length} hidden/control char(s)`,
      status: 'warning'
    });
  }
  return sanitized;
}
