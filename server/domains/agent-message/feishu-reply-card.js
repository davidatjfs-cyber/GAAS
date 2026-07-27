/**
 * Feishu card shell for agent replies (P18 peel from agents.js).
 */
export function buildFeishuCardFromAgentReply(route, resp) {
  if (!resp) return null;
  const t = { data_auditor: '小年', ops_supervisor: '小年', master: '小年' }[route] || '小年';
  const c = { data_auditor: 'blue', ops_supervisor: 'green', master: 'indigo' }[route] || 'blue';
  return {
    config: { wide_screen_mode: true },
    header: { title: { content: t, tag: 'plain_text' }, template: c },
    elements: [{ tag: 'div', text: { content: String(resp), tag: 'lark_md' } }],
  };
}
