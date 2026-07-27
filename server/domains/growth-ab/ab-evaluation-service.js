/**
 * A/B 测试判定、经验沉淀与赢家采用（从 growth-ab/service 外提）。
 */
import { callLLM } from '../../agents.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { checkTextGrounding } from '../../ontology/plan-grounding-check.js';
import { cleanText } from '../growth-phase-auth.js';
import { childLogger } from '../../utils/logger.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';
import { abMetricValue, formatPercent } from './ab-metrics.js';
import { computeAbTestOutcome } from './ab-outcome-service.js';

const log = childLogger({ domain: 'growth-ab', handler: 'evaluation-service' });

async function buildAbAiSummary(taskRow, outcome) {
  const byVariant = outcome?.byVariant || {};
  const a = byVariant.A || {};
  const b = byVariant.B || {};
  const prompt = `你是餐饮增长分析助手。请用简洁中文总结一次A/B测试结果，输出1段话，不要分点，不超过180字。\n测试名：${taskRow.test_name}\n目标指标：${taskRow.target_metric}\nA组发送${a.sent || 0}人，核销/回流${a.redemptions || 0}，核销率${formatPercent((a.redemption_rate || 0) * 100)}，营收${a.revenue || 0}元。\nB组发送${b.sent || 0}人，核销/回流${b.redemptions || 0}，核销率${formatPercent((b.redemption_rate || 0) * 100)}，营收${b.revenue || 0}元。`;
  try {
    const llm = await callLLM([{ role: 'user', content: prompt }], { purpose: 'data_analysis', temperature: 0.2, max_tokens: 220 });
    if (llm?.ok && llm.content) {
      const known = [a.sent, a.redemptions, b.sent, b.redemptions, a.revenue, b.revenue].map(Number).filter(Number.isFinite);
      const grounding = checkTextGrounding(llm.content, known);
      if (grounding.passed) return cleanText(llm.content, 1800);
    }
  } catch (_) { /* ignore */ }
  const winner = (a.redemption_rate || 0) > (b.redemption_rate || 0) ? 'A' : (a.redemption_rate || 0) < (b.redemption_rate || 0) ? 'B' : 'tie';
  return cleanText(`测试完成：A组核销率${formatPercent((a.redemption_rate || 0) * 100)}，B组核销率${formatPercent((b.redemption_rate || 0) * 100)}，${winner === 'tie' ? '两组差异不明显，建议继续积累样本。' : `${winner}组表现更好，建议将该版本作为下轮默认文案。`}`, 1800);
}

export async function maybeWriteAbLearning(pool, taskRow, outcome, winner, winnerLift) {
  if (!['A', 'B'].includes(winner)) return;
  const schema = (taskRow.metrics_schema && typeof taskRow.metrics_schema === 'object') ? taskRow.metrics_schema : null;
  const isChannel = cleanText(taskRow.mode, 20) === 'channel';
  const variable = isChannel
    ? cleanText(taskRow.test_type || '测试变量', 80)
    : (taskRow.test_type === 'sms_copy' ? '文案风格' : cleanText(taskRow.test_type || '测试变量', 80));
  const channel = cleanText(taskRow.channel || (taskRow.test_type === 'sms_copy' ? 'sms' : taskRow.test_type), 80);
  const variantA = taskRow?.variant_a && typeof taskRow.variant_a === 'object' ? taskRow.variant_a : {};
  const variantB = taskRow?.variant_b && typeof taskRow.variant_b === 'object' ? taskRow.variant_b : {};
  const winDef = winner === 'A' ? variantA : variantB;
  const loseDef = winner === 'A' ? variantB : variantA;
  const metricLabel = (schema && schema.primary && schema.primary.label) || '核销率';
  const sample = Math.max(
    Number(outcome?.byVariant?.A?.sample || outcome?.byVariant?.A?.sent || 0),
    Number(outcome?.byVariant?.B?.sample || outcome?.byVariant?.B?.sent || 0)
  );
  await pool.query(
    `INSERT INTO growth_learnings (
       source_type, source_id, store_code, channel, scene, audience_tag, variable,
       winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified, tenant_id
     ) VALUES ('ab_test',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
     ON CONFLICT DO NOTHING`,
    [
      String(taskRow.id),
      cleanText(taskRow.store_code, 128),
      channel,
      isChannel ? null : '晚市',
      isChannel ? null : '7日未到店',
      variable,
      cleanText(winDef.content || winDef.label || winner, 500),
      cleanText(loseDef.content || loseDef.label || (winner === 'A' ? 'B' : 'A'), 500),
      cleanText(`${metricLabel}+${Number(winnerLift || 0).toFixed(2)}%`, 255),
      sample,
      sample >= 100 ? 'high' : 'medium',
      ymdAddDays(todayShanghaiYmd(), 90),
      resolveTenantIdDefault()
    ]
  ).catch(() => {});
}

export async function evaluateAbTask(pool, taskRow, tenantId = 'default') {
  const outcome = await computeAbTestOutcome(pool, taskRow, tenantId);
  if (!outcome) return null;
  const a = outcome.byVariant.A || {};
  const b = outcome.byVariant.B || {};
  const minSample = Math.max(1, Math.floor(Number(taskRow?.min_sample_size) || 30));
  const schema = (taskRow.metrics_schema && typeof taskRow.metrics_schema === 'object') ? taskRow.metrics_schema : null;
  let rateA, rateB, isRate;
  if (schema && schema.primary) {
    if ((a.sample || 0) < minSample || (b.sample || 0) < minSample) return { outcome, finalized: false };
    rateA = Number(a.primary || 0);
    rateB = Number(b.primary || 0);
    isRate = schema.primary.format === 'pct';
  } else {
    if ((a.sent || 0) < minSample || (b.sent || 0) < minSample) return { outcome, finalized: false };
    const metric = taskRow?.target_metric || 'redemption_rate';
    rateA = abMetricValue(a, metric);
    rateB = abMetricValue(b, metric);
    isRate = ['redemption_rate', 'click_rate', 'response_rate'].includes(cleanText(metric, 40));
  }
  const minDiff = isRate ? 0.01 : 0.0001;
  let winner = 'tie';
  if (Math.abs(rateA - rateB) >= minDiff) winner = rateA > rateB ? 'A' : 'B';
  const base = winner === 'A' ? rateB : rateA;
  const top = winner === 'A' ? rateA : rateB;
  const winnerLift = winner === 'tie' ? 0 : Number((base > 0 ? ((top - base) / base) * 100 : top * 100).toFixed(2));
  const aiSummary = await buildAbAiSummary(taskRow, outcome);
  const status = safeDateOnly(taskRow.end_date) <= todayShanghaiYmd() ? 'completed' : 'running';
  const updated = await pool.query(
    `UPDATE ab_test_tasks
        SET winner = $2,
            winner_lift = $3,
            ai_summary = $4,
            status = $5
      WHERE id = $1
      RETURNING *`,
    [Number(taskRow.id), winner, winnerLift, cleanText(aiSummary, 4000), status]
  );
  await maybeWriteAbLearning(pool, updated.rows[0] || taskRow, outcome, winner, winnerLift);
  return { outcome, finalized: true, task: updated.rows[0] || taskRow };
}

export async function promoteAbWinner(pool, task, operatorName, tenantId = 'default') {
  const winner = String(task.winner || '').toUpperCase();
  if (winner !== 'A' && winner !== 'B') return { ok: false, error: 'no_winner_yet', message: '该测试尚无明确赢家：需先录入结果并判定 A/B 胜负后才能采用。' };
  const winnerDef = (winner === 'A' ? task.variant_a : task.variant_b) || {};
  const operator = cleanText(operatorName || 'system', 80);
  const targetKind = cleanText(task.target_kind || '', 40);
  const targetRuleKey = cleanText(task.target_rule_key || '', 200);
  const logAbDecision = (content) => pool.query(
    `INSERT INTO decision_log (store, brand, decision_type, title, content, agent, source_task_id, created_by, status, tenant_id)
     VALUES ($1, NULL, 'ab_test_promotion', $2, $3, 'growth-ab', $4, $5, 'active', $6)`,
    [cleanText(task.store_code, 200) || 'unknown', cleanText(task.test_name || 'A/B测试', 500), content, String(task.id), operator, tenantId]
  ).catch(e => log.error({ msg: 'growth_ab_decision_log_write_failed', err: e?.message }));

  if (targetRuleKey && (targetKind === 'touch_rule' || targetKind === 'payment_rule')) {
    if (winner === 'A') {
      await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
      await logAbDecision(`A组(当前版本)胜出，规则${targetRuleKey}维持不变。`);
      return { ok: true, rule_key: targetRuleKey, winner, kept_current: true, message: 'A组(当前版本)胜出，规则维持不变。' };
    }
    if (targetKind === 'touch_rule') {
      const ruleRes = await pool.query(`SELECT * FROM growth_touch_rules WHERE rule_key = $1 AND tenant_id = $2 LIMIT 1`, [targetRuleKey, tenantId]);
      if (!ruleRes.rows?.length) return { ok: false, error: 'target_rule_not_found' };
      const row = ruleRes.rows[0];
      const ap = (row.action_payload && typeof row.action_payload === 'object') ? Object.assign({}, row.action_payload) : {};
      const content = cleanText(winnerDef.content || winnerDef.text || '', 2000);
      if (content) { ap.content_template = content; ap.template_text = content; }
      if (winnerDef.coupon_value != null && winnerDef.coupon_value !== '') {
        ap.coupon_value = Number(winnerDef.coupon_value); ap.value = Number(winnerDef.coupon_value);
      }
      ap.source_ab_test_id = task.id; ap.ab_winner = winner; ap.ab_winner_lift = Number(task.winner_lift || 0);
      const upd = await pool.query(
        `UPDATE growth_touch_rules
            SET action_payload = $2::jsonb,
                approved_by = $3, approved_at = NOW(),
                note = $4, updated_at = NOW()
          WHERE rule_key = $1 AND tenant_id = $5
          RETURNING *`,
        [targetRuleKey, JSON.stringify(ap),
         operator,
         cleanText(`A/B #${task.id}「${task.test_name}」B组胜出(+${Number(task.winner_lift || 0)}%)，已采用为当前版本（经办人:${operator}）`, 1000),
         tenantId]
      );
      await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
      await logAbDecision(`B组胜出(+${Number(task.winner_lift || 0)}%)，已采用为触达规则${targetRuleKey}的当前版本。`);
      return { ok: true, rule: upd.rows[0], rule_key: targetRuleKey, winner, kind: targetKind };
    }
    const ruleRes = await pool.query(`SELECT * FROM marketing_payment_rules WHERE rule_key = $1 LIMIT 1`, [targetRuleKey]);
    if (!ruleRes.rows?.length) return { ok: false, error: 'target_rule_not_found' };
    const templateId = cleanText(winnerDef.template_id, 128);
    const triggerValue = winnerDef.trigger_value != null ? String(winnerDef.trigger_value) : null;
    const upd = await pool.query(
      `UPDATE marketing_payment_rules
          SET member_template_id = COALESCE(NULLIF($2,''), member_template_id),
              trigger_value = COALESCE($3, trigger_value),
              updated_at = NOW()
        WHERE rule_key = $1
        RETURNING *`,
      [targetRuleKey, templateId, triggerValue]
    );
    await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
    await logAbDecision(`B组胜出，已采用为支付规则${targetRuleKey}的当前版本。`);
    return { ok: true, rule: upd.rows[0], rule_key: targetRuleKey, winner, kind: targetKind };
  }

  if (cleanText(task.mode, 20) === 'channel') {
    const outcome = await computeAbTestOutcome(pool, task, tenantId).catch(() => null);
    await maybeWriteAbLearning(pool, task, outcome, winner, Number(task.winner_lift || 0));
    await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, 'learning:' + task.id]).catch(() => {});
    await logAbDecision(`「${task.channel}」渠道${winner}组胜出，已沉淀到经验库(growth_learnings)。`);
    return { ok: true, winner, channel: task.channel, learned: true, message: `已将「${task.channel}」胜出版本沉淀到经验库，供内容建议复用。` };
  }

  return { ok: false, error: 'not_promotable', message: '该测试无可采用的回路（既未绑定规则也非渠道模式）。' };
}
