/**
 * 知识事实闸门：赛后/关键回合检索 KB，标记可能编造的制度/价格表述（非每轮 LLM）
 */

let _ragQuery = null;

export function setFactGateRag(fn) {
  _ragQuery = typeof fn === 'function' ? fn : null;
}

const SUSPECT_RE = /大概|好像|应该是|听说|可能是|差不多\s*\d/;

/**
 * @returns {{ ok: true, hits: Array, warnings: Array }}
 */
export async function runFactGate({ traineeTexts = [], queryHints = [], userRole, userStore, userPosition }) {
  const warnings = [];
  const joined = traineeTexts.join('\n');
  if (SUSPECT_RE.test(joined)) {
    warnings.push({
      code: 'vague_fact',
      message: '回答中含模糊事实（大概/好像/应该是），建议先核实知识库或请示店长',
    });
  }

  const hits = [];
  if (typeof _ragQuery !== 'function') {
    return { ok: true, hits, warnings, skipped: true };
  }

  const hints = queryHints.filter(Boolean).slice(0, 3);
  if (!hints.length && /会员|退款|团购|价格|套餐/.test(joined)) {
    hints.push('会员', '退款', '团购');
  }

  for (const q of hints.slice(0, 2)) {
    try {
      const r = await _ragQuery({
        query: q,
        userRole: userRole || 'store_employee',
        userStore: userStore || null,
        userPosition: userPosition || null,
        limit: 2,
        skipKnowledgeAudienceFilter: true,
      });
      const items = r?.results || r?.items || r || [];
      for (const item of (Array.isArray(items) ? items : []).slice(0, 2)) {
        hits.push({
          id: item.id,
          title: item.title,
          snippet: String(item.content || '').slice(0, 180),
        });
      }
    } catch (_) { /* ignore */ }
  }

  if (hits.length) {
    warnings.push({
      code: 'kb_reference',
      message: '已检索到相关制度/资料，复盘时请对照，勿凭记忆编造',
    });
  }

  return { ok: true, hits, warnings };
}
