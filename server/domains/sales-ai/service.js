/**
 * 销售 AI 后台定时任务辅助函数
 */
// 超时未跟进：高意向线索若2小时内无人工接管/回复，且4小时内未提醒过，则再次提醒
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'service' });

export async function remindStaleHighIntentLeads(pool, sendOpsAlert) {
  if (typeof sendOpsAlert !== 'function') return;
  const r = await pool.query(
    `SELECT id, lead_key, company, name, city, store_count, intent_score, next_action
       FROM sales_leads
      WHERE intent_level = 'high'
        AND controller <> 'human'
        AND stage NOT IN ('won', 'lost', 'unfit')
        AND (last_human_at IS NULL OR last_human_at < NOW() - INTERVAL '2 hours')
        AND (last_reminder_at IS NULL OR last_reminder_at < NOW() - INTERVAL '4 hours')
      ORDER BY intent_score DESC
      LIMIT 20`
  );
  for (const lead of r.rows || []) {
    try {
      await sendOpsAlert(
        [
          '【销售AI·高意向仍未接管】',
          `线索 ${lead.lead_key}｜${lead.company || lead.name || ''}｜${lead.city || '?'}｜${lead.store_count || '?'}店`,
          `评分 ${lead.intent_score}（high），已超时未人工接管，请尽快跟进`,
          lead.next_action ? `建议动作：${lead.next_action}` : '',
        ].filter(Boolean).join('\n'),
        { title: '高意向销售线索超时提醒', audience: 'sales' }
      );
      await pool.query(`UPDATE sales_leads SET last_reminder_at = NOW() WHERE id = $1`, [lead.id]);
    } catch (e) {
      log.warn({ msg: 'sales_ai_stale_lead_reminder_failed', err: e?.message || e });
    }
  }
}

// 风险预警：漏跟/报价后无进展/已Demo未确认决策人/高意向未接管
export async function runRiskAlerts(pool, sendOpsAlert) {
  if (typeof sendOpsAlert !== 'function') return;
  const r = await pool.query(
    `SELECT sl.id, sl.lead_key, sl.company, sl.name, sl.city, sl.store_count, sl.intent_score, sl.stage,
            sl.last_human_at, sl.updated_at, sl.decision_role, sl.demo_count,
            EXISTS (SELECT 1 FROM sales_lead_events e WHERE e.lead_id = sl.id AND e.event_type = 'ASK_PRICE') AS has_asked_price
       FROM sales_leads sl
      WHERE sl.stage NOT IN ('won', 'lost', 'unfit')
        AND (sl.last_risk_check_at IS NULL OR sl.last_risk_check_at < NOW() - INTERVAL '4 hours')
      ORDER BY sl.intent_score DESC
      LIMIT 100`
  );
  const checked = [];
  for (const lead of r.rows || []) {
    const risks = [];
    const lastT = lead.last_human_at || lead.updated_at;
    if (lastT && Date.now() - new Date(lastT).getTime() > 3 * 86400000) risks.push('超3天未跟进');
    if (lead.has_asked_price && lastT && Date.now() - new Date(lastT).getTime() > 2 * 86400000) risks.push('报价后无进展');
    if ((lead.demo_count || 0) > 0 && lead.decision_role !== '老板') risks.push('已Demo未确认决策人');
    if (!lead.decision_role) risks.push('未确认决策角色');
    if (lead.intent_score >= 70 && lead.stage !== 'sales_takeover' && lead.stage !== 'won' && lead.stage !== 'lost') risks.push('高意向但未接管');
    if (risks.length) {
      try {
        await sendOpsAlert(
          [
            '【销售AI·风险客户提醒】',
            `线索 ${lead.lead_key}｜${lead.company || lead.name || ''}`,
            `风险：${risks.join('、')}`,
          ].join('\n'),
          { title: '销售风险客户提醒', audience: 'sales' }
        );
      } catch (e) {
        log.warn({ msg: 'sales_ai_risk_alert_failed', err: e?.message || e });
      }
    }
    checked.push(lead.id);
  }
  if (checked.length) {
    await pool.query(`UPDATE sales_leads SET last_risk_check_at = NOW() WHERE id = ANY($1::int[])`, [checked]);
  }
}
