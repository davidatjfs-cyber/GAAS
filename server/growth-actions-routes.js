/**
 * Growth actions engine routes (extracted from growth-api.js — monolith split).
 * registerGrowthActionsRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext, resolveTenantIdDefault } from './utils/database.js';
import {
  requireGrowthAuth,
  requireGrowthAdminRole,
  getGrowthOperator,
  getGrowthTenantId,
  runTouchRuleEngine,
  executeGrowthActionRecord,
  appendExecutionLog,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function registerGrowthActionsRoutes(app, pool) {
  app.post('/api/growth/rule-engine/run', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const ruleEngineTenantId = getGrowthTenantId(req);
    const result = await tenantContext.run(ruleEngineTenantId, () => runTouchRuleEngine(pool, { ...(req.body || {}), tenantId: ruleEngineTenantId }));
    return res.json({ ok: true, result });
  });

  app.get('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const channel = cleanText(req.query.channel || '', 40);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const tenantId = getGrowthTenantId(req);

    const actions = await tenantContext.run(tenantId, async () => {
      // --- growth_actions ---
      const PLATFORM_CHANNELS = ['wecom', 'xiaohongshu', 'dianping', 'miniprogram', 'douyin', 'pengyouquan'];
      let sql = `SELECT * FROM growth_actions WHERE tenant_id = $1`;
      const params = [tenantId];
      if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
      if (channel === 'pllm') {
        sql += ` AND action_type = 'pllm_task'`;
      } else if (channel === 'rule') {
        sql += ` AND (payload->>'source' IS NULL OR payload->>'source' = '')`;
      } else if (PLATFORM_CHANNELS.includes(channel)) {
        sql += ` AND payload->>'channel' = $${params.length + 1}`; params.push(channel);
      }
      sql += ` ORDER BY created_at DESC LIMIT 500`;
      const gaRows = (await pool.query(sql, params)).rows;

      // --- strategy_experiments (PLLM方案A/B卡片) ---
      // 只在不按具体渠道过滤时包含（PLLM实验没有平台渠道概念）
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
          expRows = (await pool.query(expSql, [tenantId])).rows.map((e) => ({
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
              variant_a: e.va_action ? { label: e.va_label || '方案A', action: e.va_action, execution_guide: e.va_guide || '' } : null,
              variant_b: e.vb_action ? { label: e.vb_label || '方案B', action: e.vb_action, execution_guide: e.vb_guide || '' } : null,
            },
            created_by: 'pllm',
            created_at: e.created_at,
            updated_at: e.updated_at,
            executed_at: null,
            tenant_id: e.tenant_id,
          }));
        }
      }

      // 合并并按创建时间降序
      const combined = [...gaRows, ...expRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return combined.slice(offset, offset + limit);
    });

    return res.json({ ok: true, actions, total: actions.length, limit, offset });
  });

  // PLLM策略实验审批（approve=采纳执行中 / reject=不适合）
  app.post('/api/growth/pllm-experiment/:code/approve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    const code = cleanText(req.params.code, 100);
    const tenantId = getGrowthTenantId(req);
    await tenantContext.run(tenantId, async () => {
      await pool.query(
        `UPDATE strategy_experiments SET status = 'approved', updated_at = NOW() WHERE experiment_code = $1 AND tenant_id = $2`,
        [code, tenantId]
      );
    });
    return res.json({ ok: true });
  });

  app.post('/api/growth/pllm-experiment/:code/reject', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    const code = cleanText(req.params.code, 100);
    const tenantId = getGrowthTenantId(req);
    await tenantContext.run(tenantId, async () => {
      await pool.query(
        `UPDATE strategy_experiments SET status = 'rejected', updated_at = NOW() WHERE experiment_code = $1 AND tenant_id = $2`,
        [code, tenantId]
      );
    });
    return res.json({ ok: true });
  });

  app.get('/api/growth/execution-logs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const storeId = cleanText(req.query.store_id || '', 128);
    const decision = cleanText(req.query.decision || '', 40);
    // 关键语义修正：growth_execution_logs.decision='executed' 只代表「引擎处理了该动作」，
    // 不代表「触达到了客人」。真正的渠道触达结果在 growth_delivery_logs。这里按 action_key
    // 聚合投递日志，回传每条执行记录的真实触达统计，供前端区分「已触达 / 失败 / 跳过 / 仅内部执行」。
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
    if (storeId) { conds.push(`el.store_id = $${params.length + 1}`); params.push(storeId); }
    if (decision) { conds.push(`el.decision = $${params.length + 1}`); params.push(decision); }
    if (conds.length) sql += ` WHERE ` + conds.join(' AND ');
    sql += ` ORDER BY el.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(sql, params));
    const logs = r.rows.map((l) => {
      let reach = 'na';
      if (l.decision === 'ignored') reach = 'ignored';
      else if (Number(l.delivery_total) === 0) reach = 'internal_only';
      else if (Number(l.delivery_delivered) > 0) reach = 'reached';
      else if (Number(l.delivery_failed) > 0) reach = 'failed';
      else if (Number(l.delivery_skipped) > 0) reach = 'skipped';
      else reach = 'internal_only';
      return Object.assign({}, l, { reach });
    });
    return res.json({ ok: true, logs, limit, offset });
  });

  app.post('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const actionsTenantId = getGrowthTenantId(req);
    const r = await tenantContext.run(actionsTenantId, () => pool.query(
      `INSERT INTO growth_actions (action_key, action_type, status, store_id, campaign_id, title, detail, payload, created_by, tenant_id)
       VALUES (NULLIF($1,''),$2,COALESCE(NULLIF($3,''),'proposed'),NULLIF($4,''),NULLIF($5,''),$6,$7,$8::jsonb,COALESCE(NULLIF($9,''),'agent_v2'),$10)
       ON CONFLICT (action_key, tenant_id) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.action_key, 255), cleanText(b.action_type, 80), cleanText(b.status, 40), cleanText(b.store_id, 128), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.detail, 4000), JSON.stringify(b.payload || {}), cleanText(b.created_by, 80), actionsTenantId]
    ));
    return res.json({ ok: true, action: r.rows[0] });
  });

  app.post('/api/growth/actions/:actionKey/execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const executed = await tenantContext.run(getGrowthTenantId(req), async () => {
      const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
      if (!current.rows.length) return null;
      const before = current.rows[0];
      return executeGrowthActionRecord(pool, before, operator, req.body?.payload || {}, req.body?.reason || '');
    });
    if (!executed) return res.status(404).json({ ok: false, error: 'action_not_found' });
    return res.json({ ok: true, action: executed.action, execution: executed.execution });
  });

  app.post('/api/growth/actions/:actionKey/ignore', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const outcome = await tenantContext.run(getGrowthTenantId(req), async () => {
      const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
      if (!current.rows.length) return null;
      const before = current.rows[0];
      const result = await pool.query(
        `UPDATE growth_actions SET status = 'ignored', updated_at = NOW() WHERE action_key = $1 RETURNING *`,
        [actionKey]
      );
      await appendExecutionLog(pool, {
        action_key: actionKey,
        strategy_key: cleanText(before.payload?.strategy_key || '', 255),
        store_id: before.store_id,
        action_type: before.action_type,
        decision: 'ignored',
        operator_username: operator.username,
        operator_role: operator.role,
        before_payload: before.payload || {},
        after_payload: result.rows[0].payload || {},
        decision_reason: cleanText(req.body?.reason || '', 2000),
        result_summary: '动作被忽略'
      });
      return result.rows[0];
    });
    if (!outcome) return res.status(404).json({ ok: false, error: 'action_not_found' });
    return res.json({ ok: true, action: outcome });
  });

  app.post('/api/growth/actions/:actionKey/edit-and-execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const outcome = await tenantContext.run(getGrowthTenantId(req), async () => {
      const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
      if (!current.rows.length) return null;
      const before = current.rows[0];
      const patch = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
      const result = await pool.query(
        `UPDATE growth_actions
         SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = NOW()
         WHERE action_key = $1 RETURNING *`,
        [actionKey, JSON.stringify(patch)]
      );
      await appendExecutionLog(pool, {
        action_key: actionKey,
        strategy_key: cleanText(before.payload?.strategy_key || '', 255),
        store_id: before.store_id,
        action_type: before.action_type,
        decision: 'edited_then_executed',
        operator_username: operator.username,
        operator_role: operator.role,
        before_payload: before.payload || {},
        after_payload: result.rows[0].payload || {},
        decision_reason: cleanText(req.body?.reason || '', 2000),
        result_summary: '动作修改后执行'
      });
      return result.rows[0];
    });
    if (!outcome) return res.status(404).json({ ok: false, error: 'action_not_found' });
    return res.json({ ok: true, action: outcome });
  });

  // ── Phase 3: Action feedback / 执行回填 ──
  // 纯手动建议看板：店长回填实际结果(触达/核销/营收) → 按预计目标自动打分 → 沉淀经验库供下一轮AI建议复用。
  app.post('/api/growth/actions/:actionKey/feedback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const b = req.body || {};
    const operator = getGrowthOperator(req);
    return tenantContext.run(getGrowthTenantId(req), async () => {

    // 先取动作，拿到 expected_kpi / 渠道 / 文案，用于打分与经验沉淀
    const cur = await pool.query('SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1', [actionKey]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
    const action = cur.rows[0];
    const payload = action.payload || {};

    // 结构化实际结果（任一可空；提供越多打分越准）
    const hasResult = b.actual_reach != null || b.actual_redemptions != null || b.actual_revenue_fen != null;
    const actual = {
      reach: b.actual_reach != null ? Math.max(0, Math.floor(Number(b.actual_reach) || 0)) : null,
      redemptions: b.actual_redemptions != null ? Math.max(0, Math.floor(Number(b.actual_redemptions) || 0)) : null,
      revenue_fen: b.actual_revenue_fen != null ? Math.max(0, Math.floor(Number(b.actual_revenue_fen) || 0)) : null
    };
    const expected = (payload.expected_kpi && typeof payload.expected_kpi === 'object') ? payload.expected_kpi : {};

    // 自动打分：各指标实际/预计的达成比，1.0=达标→80分；缺指标则跳过
    let scorePayload = null;
    if (hasResult) {
      const parts = [];
      if (Number(expected.reach) > 0 && actual.reach != null) parts.push(Math.min(2, actual.reach / Number(expected.reach)));
      const actualRate = actual.reach && actual.reach > 0 && actual.redemptions != null ? (actual.redemptions / actual.reach) * 100 : null;
      if (Number(expected.redemption_rate) > 0 && actualRate != null) parts.push(Math.min(2, actualRate / Number(expected.redemption_rate)));
      if (Number(expected.revenue_fen) > 0 && actual.revenue_fen != null) parts.push(Math.min(2, actual.revenue_fen / Number(expected.revenue_fen)));
      const achievement = parts.length ? parts.reduce((a, c) => a + c, 0) / parts.length : null;
      const score = achievement != null ? Math.round(Math.min(100, achievement * 80)) : null;
      const effectiveness = score == null ? '已回填' : score >= 70 ? '有效' : score >= 40 ? '部分有效' : '无效';
      scorePayload = {
        actual,
        expected_kpi: expected,
        actual_redemption_rate: actualRate != null ? Number(actualRate.toFixed(1)) : null,
        achievement: achievement != null ? Number(achievement.toFixed(2)) : null,
        effectiveness_score: score,
        effectiveness,
        scored_at: new Date().toISOString()
      };
    }

    const mergePayload = {
      feedback_note: cleanText(b.note, 4000),
      feedback_screenshot_url: cleanText(b.screenshot_url, 1000),
      feedback_result_url: cleanText(b.result_url, 1000),
      executed_by: operator.username,
      executed_at: new Date().toISOString()
    };
    if (scorePayload) mergePayload.outcome_summary = scorePayload;

    const r = await pool.query(
      `UPDATE growth_actions
       SET status = COALESCE(NULLIF($2,''), status),
           payload = COALESCE(payload,'{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE action_key = $1
       RETURNING *`,
      [actionKey, cleanText(b.status, 40), JSON.stringify(mergePayload)]
    );

    // 沉淀经验库：复用 growth_learnings，被下一轮 AI 建议生成读取
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
      await pool.query(
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
          resolveTenantIdDefault()
        ]
      ).catch((e) => { console.warn('[growth] deposit learning failed:', e?.message || e); });
    }

    await appendExecutionLog(pool, { action_key: actionKey, store_id: r.rows[0].store_id, action_type: r.rows[0].action_type, decision: 'feedback', operator_username: operator.username, operator_role: operator.role, after_payload: r.rows[0].payload, decision_reason: cleanText(b.note, 2000), result_summary: scorePayload ? `回填打分：${scorePayload.effectiveness}(${scorePayload.effectiveness_score}分)` : (b.note || '执行回填完成') });
    return res.json({ ok: true, action: r.rows[0], score: scorePayload });
    });
  });
}
