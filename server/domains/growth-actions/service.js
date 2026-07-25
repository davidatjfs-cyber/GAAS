/**
 * Growth actions engine — pure logic (no req/res).
 */
import {
  cleanText,
  PLATFORM_CHANNELS,
  deriveReach,
  scoreActionFeedback,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'growth-actions', handler: 'service' });


export async function runRuleEngine(ctx, tenantId, body) {
  const result = await ctx.tenantContext.run(tenantId, () =>
    ctx.runTouchRuleEngine(ctx.pool, { ...(body || {}), tenantId })
  );
  return { status: 200, body: { ok: true, result } };
}

export async function listActions(ctx, tenantId, query) {
  const status = cleanText(query.status || '', 40);
  const channel = cleanText(query.channel || '', 40);
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const actions = await ctx.tenantContext.run(tenantId, async () => {
    let sql = `SELECT * FROM growth_actions WHERE tenant_id = $1`;
    const params = [tenantId];
    if (status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    if (channel === 'pllm') {
      sql += ` AND action_type = 'pllm_task'`;
    } else if (channel === 'rule') {
      sql += ` AND (payload->>'source' IS NULL OR payload->>'source' = '')`;
    } else if (PLATFORM_CHANNELS.includes(channel)) {
      sql += ` AND payload->>'channel' = $${params.length + 1}`;
      params.push(channel);
    }
    sql += ` ORDER BY created_at DESC LIMIT 500`;
    const gaRows = (await ctx.pool.query(sql, params)).rows;

    let expRows = [];
    const excludeExperiments = PLATFORM_CHANNELS.includes(channel) || channel === 'rule';
    if (!excludeExperiments) {
      const onlyProposed = !status || status === 'proposed';
      if (onlyProposed) {
        const expSql = `
            SELECT se.experiment_code, se.title, se.goal, se.anomaly_type, se.status AS exp_status, se.created_at, se.updated_at, se.tenant_id,
                   sv_a.label AS va_label, sv_a.action AS va_action, sv_a.execution_guide AS va_guide, sv_a.store AS va_store,
                   sv_b.label AS vb_label, sv_b.action AS vb_action, sv_b.execution_guide AS vb_guide, sv_b.store AS vb_store
            FROM strategy_experiments se
            LEFT JOIN strategy_variants sv_a ON sv_a.experiment_id = se.id AND sv_a.variant_code = 'A'
            LEFT JOIN strategy_variants sv_b ON sv_b.experiment_id = se.id AND sv_b.variant_code = 'B'
            WHERE se.tenant_id = $1 AND se.created_by = 'pllm' AND se.status = 'pending_approval'
            ORDER BY se.created_at DESC LIMIT 200`;
        expRows = (await ctx.pool.query(expSql, [tenantId])).rows.map((e) => ({
          action_key: `pllm_exp_${e.experiment_code}`,
          action_type: 'pllm_experiment',
          status: 'proposed',
          store_id: e.va_store || '',
          title: e.title,
          detail: e.goal || '',
          payload: {
            source: 'pllm_experiment',
            channel: 'pllm',
            experiment_code: e.experiment_code,
            anomaly_type: e.anomaly_type || '',
            variant_a: e.va_action
              ? { label: e.va_label || '方案A', action: e.va_action, execution_guide: e.va_guide || '' }
              : null,
            variant_b: e.vb_action
              ? { label: e.vb_label || '方案B', action: e.vb_action, execution_guide: e.vb_guide || '' }
              : null,
          },
          created_by: 'pllm',
          created_at: e.created_at,
          updated_at: e.updated_at,
          executed_at: null,
          tenant_id: e.tenant_id,
        }));
      }
    }

    const combined = [...gaRows, ...expRows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    return combined.slice(offset, offset + limit);
  });

  return { status: 200, body: { ok: true, actions, total: actions.length, limit, offset } };
}

export async function setPllmExperimentStatus(ctx, tenantId, codeRaw, status) {
  const code = cleanText(codeRaw, 100);
  await ctx.tenantContext.run(tenantId, async () => {
    await ctx.pool.query(
      `UPDATE strategy_experiments SET status = $3, updated_at = NOW() WHERE experiment_code = $1 AND tenant_id = $2`,
      [code, tenantId, status]
    );
  });
  return { status: 200, body: { ok: true } };
}

export async function listExecutionLogs(ctx, tenantId, query) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const storeId = cleanText(query.store_id || '', 128);
  const decision = cleanText(query.decision || '', 40);

  let sql = `SELECT el.*,
        tr.name AS rule_name,
        COALESCE(d.total_count, 0) AS delivery_total,
        COALESCE(d.delivered_count, 0) AS delivery_delivered,
        COALESCE(d.failed_count, 0) AS delivery_failed,
        COALESCE(d.skipped_count, 0) AS delivery_skipped,
        d.channels AS delivery_channels,
        d.last_error AS delivery_last_error
      FROM growth_execution_logs el
      LEFT JOIN growth_touch_rules tr ON tr.rule_key = split_part(el.action_key, ':', 2)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','clicked','redeemed')) AS delivered_count,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
          COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count,
          string_agg(DISTINCT channel, ',') AS channels,
          (array_agg(error_message ORDER BY created_at DESC) FILTER (WHERE error_message IS NOT NULL))[1] AS last_error
        FROM growth_delivery_logs dl
        WHERE dl.action_key = el.action_key
      ) d ON TRUE`;
  const params = [];
  const conds = [];
  if (storeId) {
    conds.push(`el.store_id = $${params.length + 1}`);
    params.push(storeId);
  }
  if (decision) {
    conds.push(`el.decision = $${params.length + 1}`);
    params.push(decision);
  }
  if (conds.length) sql += ` WHERE ` + conds.join(' AND ');
  sql += ` ORDER BY el.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const r = await ctx.tenantContext.run(tenantId, () => ctx.pool.query(sql, params));
  const logs = r.rows.map((l) => Object.assign({}, l, { reach: deriveReach(l) }));
  return { status: 200, body: { ok: true, logs, limit, offset } };
}

export async function upsertAction(ctx, tenantId, body) {
  const b = body || {};
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
      `INSERT INTO growth_actions (action_key, action_type, status, store_id, campaign_id, title, detail, payload, created_by, tenant_id)
       VALUES (NULLIF($1,''),$2,COALESCE(NULLIF($3,''),'proposed'),NULLIF($4,''),NULLIF($5,''),$6,$7,$8::jsonb,COALESCE(NULLIF($9,''),'agent_v2'),$10)
       ON CONFLICT (action_key, tenant_id) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING *`,
      [
        cleanText(b.action_key, 255),
        cleanText(b.action_type, 80),
        cleanText(b.status, 40),
        cleanText(b.store_id, 128),
        cleanText(b.campaign_id, 128),
        cleanText(b.title, 500),
        cleanText(b.detail, 4000),
        JSON.stringify(b.payload || {}),
        cleanText(b.created_by, 80),
        tenantId,
      ]
    )
  );
  return { status: 200, body: { ok: true, action: r.rows[0] } };
}

export async function executeAction(ctx, tenantId, actionKeyRaw, operator, body) {
  const actionKey = cleanText(actionKeyRaw, 255);
  const executed = await ctx.tenantContext.run(tenantId, async () => {
    const current = await ctx.pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [
      actionKey,
    ]);
    if (!current.rows.length) return null;
    const before = current.rows[0];
    return ctx.executeGrowthActionRecord(
      ctx.pool,
      before,
      operator,
      body?.payload || {},
      body?.reason || ''
    );
  });
  if (!executed) return { status: 404, body: { ok: false, error: 'action_not_found' } };
  return {
    status: 200,
    body: { ok: true, action: executed.action, execution: executed.execution },
  };
}

export async function ignoreAction(ctx, tenantId, actionKeyRaw, operator, body) {
  const actionKey = cleanText(actionKeyRaw, 255);
  const outcome = await ctx.tenantContext.run(tenantId, async () => {
    const current = await ctx.pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [
      actionKey,
    ]);
    if (!current.rows.length) return null;
    const before = current.rows[0];
    const result = await ctx.pool.query(
      `UPDATE growth_actions SET status = 'ignored', updated_at = NOW() WHERE action_key = $1 RETURNING *`,
      [actionKey]
    );
    await ctx.appendExecutionLog(ctx.pool, {
      action_key: actionKey,
      strategy_key: cleanText(before.payload?.strategy_key || '', 255),
      store_id: before.store_id,
      action_type: before.action_type,
      decision: 'ignored',
      operator_username: operator.username,
      operator_role: operator.role,
      before_payload: before.payload || {},
      after_payload: result.rows[0].payload || {},
      decision_reason: cleanText(body?.reason || '', 2000),
      result_summary: '动作被忽略',
    });
    return result.rows[0];
  });
  if (!outcome) return { status: 404, body: { ok: false, error: 'action_not_found' } };
  return { status: 200, body: { ok: true, action: outcome } };
}

export async function editAndExecuteAction(ctx, tenantId, actionKeyRaw, operator, body) {
  const actionKey = cleanText(actionKeyRaw, 255);
  const outcome = await ctx.tenantContext.run(tenantId, async () => {
    const current = await ctx.pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [
      actionKey,
    ]);
    if (!current.rows.length) return null;
    const before = current.rows[0];
    const patch = body?.payload && typeof body.payload === 'object' ? body.payload : {};
    const result = await ctx.pool.query(
      `UPDATE growth_actions
         SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = NOW()
         WHERE action_key = $1 RETURNING *`,
      [actionKey, JSON.stringify(patch)]
    );
    await ctx.appendExecutionLog(ctx.pool, {
      action_key: actionKey,
      strategy_key: cleanText(before.payload?.strategy_key || '', 255),
      store_id: before.store_id,
      action_type: before.action_type,
      decision: 'edited_then_executed',
      operator_username: operator.username,
      operator_role: operator.role,
      before_payload: before.payload || {},
      after_payload: result.rows[0].payload || {},
      decision_reason: cleanText(body?.reason || '', 2000),
      result_summary: '动作修改后执行',
    });
    return result.rows[0];
  });
  if (!outcome) return { status: 404, body: { ok: false, error: 'action_not_found' } };
  return { status: 200, body: { ok: true, action: outcome } };
}

export async function submitActionFeedback(ctx, tenantId, actionKeyRaw, operator, body) {
  const actionKey = cleanText(actionKeyRaw, 255);
  const b = body || {};

  return ctx.tenantContext.run(tenantId, async () => {
    const cur = await ctx.pool.query('SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1', [
      actionKey,
    ]);
    if (!cur.rows.length) {
      return { status: 404, body: { ok: false, error: 'action_not_found' } };
    }
    const action = cur.rows[0];
    const payload = action.payload || {};
    const expected =
      payload.expected_kpi && typeof payload.expected_kpi === 'object' ? payload.expected_kpi : {};
    const scorePayload = scoreActionFeedback(b, expected);
    const actual = scorePayload?.actual || {
      reach: null,
      redemptions: null,
      revenue_fen: null,
    };

    const mergePayload = {
      feedback_note: cleanText(b.note, 4000),
      feedback_screenshot_url: cleanText(b.screenshot_url, 1000),
      feedback_result_url: cleanText(b.result_url, 1000),
      executed_by: operator.username,
      executed_at: new Date().toISOString(),
    };
    if (scorePayload) mergePayload.outcome_summary = scorePayload;

    const r = await ctx.pool.query(
      `UPDATE growth_actions
       SET status = COALESCE(NULLIF($2,''), status),
           payload = COALESCE(payload,'{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE action_key = $1
       RETURNING *`,
      [actionKey, cleanText(b.status, 40), JSON.stringify(mergePayload)]
    );

    if (scorePayload && scorePayload.effectiveness_score != null) {
      const approach = cleanText(payload.ready_copy || payload.execution_action || action.title, 500);
      const channel = cleanText(payload.channel || '', 80);
      const audienceTag = cleanText(payload.target_audience || '', 120) || null;
      const isWin = scorePayload.effectiveness_score >= 70;
      const effectDesc = cleanText(
        `${scorePayload.effectiveness}｜核销率${scorePayload.actual_redemption_rate != null ? scorePayload.actual_redemption_rate + '%' : '-'}，实收¥${actual.revenue_fen != null ? Math.round(actual.revenue_fen / 100) : '-'}，达成${scorePayload.achievement != null ? Math.round(scorePayload.achievement * 100) + '%' : '-'}`,
        255
      );
      const sample = actual.reach || 0;
      await ctx.pool
        .query(
          `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified, tenant_id)
         VALUES ('ai_suggestion',$1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)
         ON CONFLICT DO NOTHING`,
          [
            actionKey,
            cleanText(action.store_id, 128),
            channel || null,
            audienceTag,
            'AI建议方案有效性',
            isWin ? approach : '换其它方向（避免重复）',
            isWin ? null : approach,
            effectDesc,
            sample,
            sample >= 100 ? 'high' : sample >= 30 ? 'medium' : 'low',
            new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
            ctx.resolveTenantIdDefault(),
          ]
        )
        .catch((e) => {
          log.warn({ msg: 'growth_deposit_learning_failed', err: e?.message || e });
        });
    }

    await ctx.appendExecutionLog(ctx.pool, {
      action_key: actionKey,
      store_id: r.rows[0].store_id,
      action_type: r.rows[0].action_type,
      decision: 'feedback',
      operator_username: operator.username,
      operator_role: operator.role,
      after_payload: r.rows[0].payload,
      decision_reason: cleanText(b.note, 2000),
      result_summary: scorePayload
        ? `回填打分：${scorePayload.effectiveness}(${scorePayload.effectiveness_score}分)`
        : b.note || '执行回填完成',
    });
    return { status: 200, body: { ok: true, action: r.rows[0], score: scorePayload } };
  });
}
