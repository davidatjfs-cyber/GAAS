/**
 * Agent route/demand eval suite (P18 peel from agents.js runAgentEvalSuite).
 */
import { detectFactDemand } from './quality-helpers.js';

export const AGENT_EVAL_CASES = [
  { text: '近7天门店营业额达成率怎么样', route: 'data_auditor', demand: 'hard' },
  { text: '帮我看下差评最多的菜品', route: 'data_auditor', demand: 'hard' },
  { text: '我要开市检查表', route: 'ops_supervisor', demand: 'soft' },
  { text: '这条绩效扣分我想申诉', route: 'appeal', demand: 'soft' },
  { text: '我想咨询离职流程', route: 'chief_evaluator', demand: 'soft' },
  { text: '这个SOP退款标准怎么执行', route: 'train_advisor', demand: 'soft' },
  { text: '你好', route: 'general', demand: 'none' },
];

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {(text: string, hasImage: boolean, senderUsername: string) => Promise<{route?: string}>} deps.routeMessage
 * @param {{ error: Function }} deps.log
 * @returns {(opts?: object) => Promise<object>}
 */
export function createRunAgentEvalSuite(deps) {
  const { pool, routeMessage, log } = deps;
  return async function runAgentEvalSuite({ createdBy = '', suiteName = 'default', tenantId = 'default' } = {}) {
    const rows = [];
    for (const c of AGENT_EVAL_CASES) {
      let routed = 'general';
      let err = '';
      try {
        const r = await routeMessage(c.text, false, '');
        routed = String(r?.route || 'general');
      } catch (e) {
        err = String(e?.message || e);
      }
      const demand = detectFactDemand(c.text);
      const routePass = routed === c.route;
      const demandPass = demand === c.demand;
      rows.push({
        text: c.text,
        expectedRoute: c.route,
        actualRoute: routed,
        expectedDemand: c.demand,
        actualDemand: demand,
        routePass,
        demandPass,
        error: err,
      });
    }

    const total = rows.length;
    const routeHit = rows.filter((x) => x.routePass).length;
    const demandHit = rows.filter((x) => x.demandPass).length;
    const summary = {
      total,
      routeHit,
      routeAccuracy: total ? Number((routeHit / total).toFixed(3)) : 0,
      demandHit,
      demandAccuracy: total ? Number((demandHit / total).toFixed(3)) : 0,
      createdAt: new Date().toISOString(),
      cases: rows,
    };

    try {
      await pool().query(
        `INSERT INTO agent_eval_runs (suite_name, summary, created_by, tenant_id)
         VALUES ($1, $2::jsonb, $3, $4)`,
        [String(suiteName || 'default'), JSON.stringify(summary), String(createdBy || ''), tenantId]
      );
    } catch (e) {
      log.error('[agents] runAgentEvalSuite persist failed:', e?.message || e);
    }

    return summary;
  };
}
