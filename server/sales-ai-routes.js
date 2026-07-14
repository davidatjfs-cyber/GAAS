/**
 * 销售 AI 路由：沙盒试聊 + 线索工作台 + 微信客服回调 + 销售漏斗/会客/风险
 */
import { ensureSalesTables, listLeads, getLead, loadLeadFunnel } from './services/sales/sales-store.js';
import {
  handleInboundMessage,
  takeoverConversation,
  releaseToAi,
  getLeadDetail,
  recordSalesReply,
  setSalesNotify,
  buildDiagnosisReport,
  detectOvercommitment,
  matchObjection,
} from './services/sales/sales-session.js';
import {
  buildBossDailyReport,
  buildSalesTodoList,
  buildRiskCustomers,
  buildFunnelStats,
  buildTomorrowActions,
  buildTopHighLeads,
  buildDiagnosisReport as buildDiagnosisReportOps,
  buildDemoBrief,
  summarizeMeeting,
} from './services/sales/sales-ops.js';
import { setSalesCustomerAiLlm } from './services/sales/sales-customer-ai.js';
import { draftCustomerReply, draftStandardResponse, draftQuickReplyByScenario, setSalesReplyDraftLlm } from './services/sales/sales-reply-draft.js';
import { provisionTenantFromLead } from './services/sales-provisioning.js';
import { buildSalesBossDashboard } from './services/sales/sales-boss-metrics.js';
import { listCaseAssets, recommendCasesForLead, formatCaseForSend, getCaseAsset } from './services/sales/sales-case-library.js';
import { generateSalesProposal, runDeepDiagnosis, setSalesProposalLlm } from './services/sales/sales-proposal.js';
import { TRAINING_SCENARIOS, scoreTrainingResponse, recordTrainingSession, getTrainingStats } from './services/sales/sales-training.js';
import { runSalesAssistantTurn, listAssistantThreads, listAssistantMessages, setSalesAssistantLlm } from './services/sales/sales-internal-assistant.js';
import { checkPricePermission } from './services/sales/sales-price-policy.js';
import { validateTrialProgress, runTrialValidations } from './services/sales/sales-trial-monitor.js';
import {
  kfConfigured,
  kfEnv,
  verifyKfSignature,
  decryptKfEcho,
  decryptKfMessage,
  processKfCallbackEvent,
} from './services/sales/sales-kf.js';
import { SALES_PERSONA, PUBLIC_KNOWLEDGE, FORBIDDEN_CLAIMS } from './services/sales/sales-knowledge.js';
import {
  listSalesReps,
  createOrUpdateSalesRep,
  runDailyActivityRollup,
  runAutoKpiRollupAndNotify,
  upsertKpiTarget,
  computeAndSaveKpiScore,
  getRepScorecard,
  getTeamLeaderboard,
} from './services/sales/sales-rep-management.js';

// 超时未跟进：高意向线索若2小时内无人工接管/回复，且4小时内未提醒过，则再次提醒
async function remindStaleHighIntentLeads(pool, sendOpsAlert) {
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
      console.warn('[sales-ai] stale lead reminder failed:', e?.message || e);
    }
  }
}

// 风险预警：漏跟/报价后无进展/已Demo未确认决策人/高意向未接管
async function runRiskAlerts(pool, sendOpsAlert) {
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
        console.warn('[sales-ai] risk alert failed:', e?.message || e);
      }
    }
    checked.push(lead.id);
  }
  if (checked.length) {
    await pool.query(`UPDATE sales_leads SET last_risk_check_at = NOW() WHERE id = ANY($1::int[])`, [checked]);
  }
}

export function registerSalesAiRoutes(app, pool, platformAdminRequired, { callLLM, sendOpsAlert } = {}) {
  if (typeof callLLM === 'function') {
    setSalesCustomerAiLlm(callLLM);
    setSalesReplyDraftLlm(callLLM);
    setSalesProposalLlm(callLLM);
    setSalesAssistantLlm(callLLM);
  }
  if (typeof sendOpsAlert === 'function') setSalesNotify(sendOpsAlert);

  if (!globalThis.__salesStaleLeadReminderTimer) {
    globalThis.__salesStaleLeadReminderTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => remindStaleHighIntentLeads(pool, sendOpsAlert))
        .catch((e) => console.warn('[sales-ai] stale lead reminder run failed:', e?.message || e));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesRiskAlertTimer) {
    globalThis.__salesRiskAlertTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => runRiskAlerts(pool, sendOpsAlert))
        .catch((e) => console.warn('[sales-ai] risk alert run failed:', e?.message || e));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesTrialValidationTimer) {
    globalThis.__salesTrialValidationTimer = setInterval(() => {
      runTrialValidations(pool, { limit: 10 })
        .then((rows) => {
          const bad = (rows || []).filter((r) => r.report?.status === 'no_data');
          if (bad.length && typeof sendOpsAlert === 'function') {
            return sendOpsAlert(
              ['【销售AI·试跑无数据】', ...bad.map((b) => `· ${b.company || b.lead_id}：${b.report?.summary || ''}`)].join('\n'),
              { title: '试跑数据告警', audience: 'sales' }
            );
          }
        })
        .catch((e) => console.warn('[sales-ai] trial validation failed:', e?.message || e));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesDailyReportTimer) {
    const scheduleSalesDailyReport = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      globalThis.__salesDailyReportTimer = setTimeout(async () => {
        try {
          const report = await buildBossDailyReport(pool);
          if (typeof sendOpsAlert === 'function') {
            await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
          }
        } catch (e) {
          console.warn('[sales-ai] daily report send failed:', e?.message || e);
        }
        scheduleSalesDailyReport();
      }, next - now);
    };
    scheduleSalesDailyReport();
  }

  if (!globalThis.__salesRepActivityRollupTimer) {
    const scheduleSalesRepActivityRollup = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(0, 30, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      globalThis.__salesRepActivityRollupTimer = setTimeout(async () => {
        try {
          await runDailyActivityRollup(pool, {});
        } catch (e) {
          console.warn('[sales-ai] rep activity rollup failed:', e?.message || e);
        }
        scheduleSalesRepActivityRollup();
      }, next - now);
    };
    scheduleSalesRepActivityRollup();
  }

  // P3：每周一 08:00 自动结算上一周KPI；每月1号 08:15 自动结算上个月KPI（都不含主管主观分，
  // 主管后续用 kpi-scores 接口补分即可覆盖更新）。
  if (!globalThis.__salesWeeklyKpiTimer) {
    const scheduleWeeklyKpi = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(8, 0, 0, 0);
      const dayOfWeek = next.getDay() || 7; // 周一=1...周日=7
      let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
      if (daysUntilMonday === 0 && next <= now) daysUntilMonday = 7;
      next.setDate(next.getDate() + daysUntilMonday);
      globalThis.__salesWeeklyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'week');
        } catch (e) {
          console.warn('[sales-ai] weekly kpi rollup failed:', e?.message || e);
        }
        scheduleWeeklyKpi();
      }, next - now);
    };
    scheduleWeeklyKpi();
  }

  if (!globalThis.__salesMonthlyKpiTimer) {
    const scheduleMonthlyKpi = () => {
      const now = new Date();
      let next = new Date(now.getFullYear(), now.getMonth(), 1, 8, 15, 0, 0);
      if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 8, 15, 0, 0);
      globalThis.__salesMonthlyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'month');
        } catch (e) {
          console.warn('[sales-ai] monthly kpi rollup failed:', e?.message || e);
        }
        scheduleMonthlyKpi();
      }, next - now);
    };
    scheduleMonthlyKpi();
  }

  if (!globalThis.__salesKfSyncTimer) {
    globalThis.__salesKfSyncTimer = setInterval(() => {
      if (!kfConfigured()) return;
      const env = kfEnv();
      processKfCallbackEvent(pool, { token: '', openKfid: env.openKfid }, (payload) => handleInboundMessage(pool, payload))
        .catch((e) => console.warn('[sales-ai] kf compensating sync failed:', e?.message || e));
    }, 5 * 60 * 1000);
  }

  app.get('/api/wecom/kf/callback', (req, res) => {
    const env = kfEnv();
    const { msg_signature, timestamp, nonce, echostr } = req.query || {};
    if (env.token && env.aesKey && msg_signature && echostr) {
      try {
        const expect = verifyKfSignature(env.token, timestamp, nonce, echostr);
        if (expect !== String(msg_signature)) return res.status(401).send('invalid signature');
        return res.send(decryptKfEcho(String(echostr), env.aesKey));
      } catch (e) {
        return res.status(400).send('decrypt failed');
      }
    }
    if (echostr) return res.send(String(echostr));
    return res.send('ok');
  });

  app.post('/api/wecom/kf/callback', async (req, res) => {
    res.send('success');
    try {
      if (!kfConfigured()) {
        console.warn('[sales-kf] callback received but KF not configured');
        return;
      }
      const env = kfEnv();
      let token = '';
      let openKfid = env.openKfid;
      const encrypt = req.body?.Encrypt || req.body?.encrypt;
      if (encrypt && env.aesKey) {
        try {
          const plain = decryptKfMessage(String(encrypt), env.aesKey);
          const tokenM = plain.match(/<Token><!\[CDATA\[(.*?)\]\]><\/Token>/) || plain.match(/"Token"\s*:\s*"([^"]+)"/);
          const kfM = plain.match(/<OpenKfId><!\[CDATA\[(.*?)\]\]><\/OpenKfId>/) || plain.match(/"OpenKfId"\s*:\s*"([^"]+)"/);
          if (tokenM) token = tokenM[1];
          if (kfM) openKfid = kfM[1];
        } catch (e) {
          console.error('[sales-kf] decrypt body failed', e?.message || e);
        }
      }
      token = token || String(req.body?.Token || req.query?.token || '');
      await processKfCallbackEvent(pool, { token, openKfid }, (payload) => handleInboundMessage(pool, payload));
    } catch (e) {
      console.error('[sales-kf] callback handle failed', e?.message || e);
    }
  });

  app.get('/api/admin/sales/meta', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, persona: SALES_PERSONA, knowledge: PUBLIC_KNOWLEDGE, forbidden_claims: FORBIDDEN_CLAIMS, kf_configured: kfConfigured(), open_kfid: kfEnv().openKfid || null });
  });

  app.get('/api/admin/sales/leads', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { stage: req.query?.stage, min_score: req.query?.min_score, limit: req.query?.limit });
      res.json({ ok: true, leads });
    } catch (e) {
      console.error('[sales] list leads', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/leads/:id', platformAdminRequired, async (req, res) => {
    try {
      const data = await getLeadDetail(pool, Number(req.params.id));
      res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      console.error('[sales] lead detail', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/sandbox/chat', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const externalUserid = String(req.body?.external_userid || req.body?.session_key || '').trim() || `sandbox_${req.user?.username || 'admin'}`;
      const welcome = !!req.body?.welcome;
      const data = await handleInboundMessage(pool, { text: welcome && !text ? '' : text, openKfid: 'sandbox', externalUserid, sourceChannel: 'sandbox', welcome });
      res.json(data);
    } catch (e) {
      console.error('[sales] sandbox chat', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/takeover', platformAdminRequired, async (req, res) => {
    try {
      const data = await takeoverConversation(pool, Number(req.params.id), { ownerUsername: req.user?.username || req.body?.owner_username });
      res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/release-ai', platformAdminRequired, async (req, res) => {
    try {
      res.json(await releaseToAi(pool, Number(req.params.id)));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/reply', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'empty' });
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      if (detail.conversation?.controller !== 'human' && detail.lead.controller !== 'human') {
        return res.status(400).json({ ok: false, error: 'not_in_human_control', message: '请先接管会话' });
      }
      const result = await recordSalesReply(pool, Number(req.params.id), text, { sender: req.user?.username || 'human' });
      if (detail.lead.open_kfid && detail.lead.open_kfid !== 'sandbox' && detail.lead.external_userid && kfConfigured()) {
        try {
          const { sendKfText } = await import('./services/sales/sales-kf.js');
          await sendKfText({ openKfid: detail.lead.open_kfid, externalUserid: detail.lead.external_userid, content: text });
        } catch (e) {
          return res.json({ ok: true, saved: true, overcommit_risks: result.overcommit_risks, send_error: e?.message || String(e) });
        }
      }
      res.json({ ok: true, saved: true, overcommit_risks: result.overcommit_risks });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/draft-reply', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const draft = await draftCustomerReply({ lead: detail.lead, messages: detail.messages, advice: detail.advice });
      if (!draft.ok) return res.json({ ok: false, error: draft.error, message: '暂无法生成草稿，请手动编写' });
      res.json({ ok: true, text: draft.text });
    } catch (e) {
      console.error('[sales] draft reply', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/quick-reply', platformAdminRequired, async (req, res) => {
    try {
      const scenario = String(req.body?.scenario || '').trim();
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const draft = draftQuickReplyByScenario({ lead: detail.lead, scenario });
      res.json(draft);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/diagnosis', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      res.json({ ok: true, diagnosis: detail.diagnosis });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/check-overcommit', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'empty' });
      const price = checkPricePermission({ role: 'platform_admin', ...req.platformAdmin }, text);
      const risks = [...detectOvercommitment(text), ...price.risks];
      res.json({ ok: true, risks, price_permission: price });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/objections/response', platformAdminRequired, async (req, res) => {
    try {
      const key = String(req.body?.objection_key || '').trim();
      if (!key) return res.status(400).json({ ok: false, error: 'missing_key' });
      const resp = draftStandardResponse(key);
      res.json(resp.ok ? { ok: true, ...resp } : { ok: false, error: resp.error });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/daily-report', platformAdminRequired, async (_req, res) => {
    try {
      res.json(await buildBossDailyReport(pool));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/daily-report/send', platformAdminRequired, async (_req, res) => {
    try {
      const report = await buildBossDailyReport(pool);
      if (typeof sendOpsAlert === 'function') await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/todo', platformAdminRequired, async (_req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 });
      res.json({ ok: true, todos: buildSalesTodoList(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/risks', platformAdminRequired, async (_req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 });
      res.json({ ok: true, risks: buildRiskCustomers(leads), tomorrow_actions: buildTomorrowActions(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/top5', platformAdminRequired, async (_req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 });
      res.json({ ok: true, top5: buildTopHighLeads(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/leads/:id/demo-brief', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const brief = buildDemoBrief(detail.lead, detail.funnel || {});
      res.json({ ok: true, brief, text: [
        `【会前简报】${brief.customer}`,
        `门店 ${brief.store_count}｜菜系 ${brief.cuisine}｜城市 ${brief.city}｜POS ${brief.pos}`,
        `主要问题：${(brief.main_problems || []).join('；')}`,
        `本次目标：${(brief.this_meeting_goal || []).join('、')}`,
        `建议展示：${(brief.suggested_pages || []).join('、')}`,
      ].join('\n') });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/funnel', platformAdminRequired, async (_req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 500 });
      res.json({ ok: true, funnel: buildFunnelStats(leads), count: leads.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/demos', platformAdminRequired, async (req, res) => {
    try {
      const { createDemo } = await import('./services/sales/sales-store.js');
      const demo = await createDemo(pool, {
        leadId: Number(req.params?.id || req.body?.lead_id),
        scheduledAt: req.body?.scheduled_at,
        attendedBy: req.body?.attended_by,
        summary: req.body?.summary,
        keyPoints: req.body?.key_points,
        objections: req.body?.objections,
        nextSteps: req.body?.next_steps,
        createdBy: req.user?.username,
      });
      res.json({ ok: true, demo });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/meetings', platformAdminRequired, async (req, res) => {
    try {
      const { createMeeting } = await import('./services/sales/sales-store.js');
      let summary = null;
      if (req.body?.raw_notes) {
        const s = summarizeMeeting(req.body.raw_notes);
        summary = JSON.stringify(s);
      }
      const meeting = await createMeeting(pool, {
        leadId: Number(req.params?.id || req.body?.lead_id),
        meetingType: req.body?.meeting_type || 'meeting',
        occurredAt: req.body?.occurred_at,
        rawNotes: req.body?.raw_notes,
        createdBy: req.user?.username,
      });
      res.json({ ok: true, meeting, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/trials', platformAdminRequired, async (req, res) => {
    try {
      const { createTrial } = await import('./services/sales/sales-store.js');
      const leadId = Number(req.params?.id || req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      const trial = await createTrial(pool, {
        leadId,
        startedAt: req.body?.started_at,
        endedAt: req.body?.ended_at,
        stores: req.body?.stores,
        posBrand: req.body?.pos_brand || lead?.pos_brand,
        targetKpis: req.body?.target_kpis,
        createdBy: req.platformAdmin?.username,
        tenantId: lead?.tenant_id || req.body?.tenant_id,
      });
      res.json({ ok: true, trial });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/deals', platformAdminRequired, async (req, res) => {
    try {
      const { createDeal, addOpportunity } = await import('./services/sales/sales-store.js');
      const leadId = Number(req.params?.id || req.body?.lead_id);
      if (req.body?.opportunity_id) {
        await addOpportunity(pool, { leadId, title: '成交机会', stage: 'won', amount: req.body?.amount, createdBy: req.platformAdmin?.username });
      }
      const deal = await createDeal(pool, {
        leadId,
        opportunityId: req.body?.opportunity_id,
        dealDate: req.body?.deal_date,
        amount: req.body?.amount,
        storeCount: req.body?.store_count,
        contractTerm: req.body?.contract_term,
        notes: req.body?.notes,
        createdBy: req.platformAdmin?.username,
      });
      let provision = null;
      if (req.body?.provision_tenant !== false) {
        provision = await provisionTenantFromLead(pool, leadId, {
          tenantId: req.body?.tenant_id,
          tenantName: req.body?.tenant_name,
          adminUsername: req.body?.admin_username,
          startedBy: req.platformAdmin?.username || 'sales_ai',
        });
        if (provision?.ok && provision.tenant_id) {
          await pool.query(`UPDATE sales_deals SET tenant_id=$2, provision_status='done' WHERE id=$1`, [deal.id, provision.tenant_id]);
        }
      }
      res.json({ ok: true, deal, provision });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/provision-tenant', platformAdminRequired, async (req, res) => {
    try {
      const result = await provisionTenantFromLead(pool, Number(req.params.id), {
        tenantId: req.body?.tenant_id,
        tenantName: req.body?.tenant_name,
        adminUsername: req.body?.admin_username,
        startedBy: req.platformAdmin?.username,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/deep-diagnosis', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const result = await runDeepDiagnosis({
        lead: detail.lead,
        messages: detail.messages,
        ruleDiagnosis: detail.diagnosis,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/proposal', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const cases = await recommendCasesForLead(pool, detail.lead);
      const proposal = await generateSalesProposal({
        lead: detail.lead,
        diagnosis: detail.diagnosis,
        cases,
        funnel: detail.funnel,
      });
      res.json({ ok: true, ...proposal, cases: cases.slice(0, 3).map((c) => ({ case_key: c.case_key, title: c.title })) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/cases', platformAdminRequired, async (req, res) => {
    try {
      const cases = await listCaseAssets(pool, { theme: req.query?.theme, pain: req.query?.pain, limit: Number(req.query?.limit) || 50 });
      res.json({ ok: true, cases });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/cases/:key', platformAdminRequired, async (req, res) => {
    try {
      const c = await getCaseAsset(pool, req.params.key);
      if (!c) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, case: c, text: formatCaseForSend(c) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/boss-dashboard', platformAdminRequired, async (_req, res) => {
    try {
      res.json(await buildSalesBossDashboard(pool));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/training/scenarios', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, scenarios: TRAINING_SCENARIOS });
  });

  app.post('/api/admin/sales/training/score', platformAdminRequired, async (req, res) => {
    try {
      const scored = scoreTrainingResponse(req.body?.scenario_key, req.body?.response);
      if (!scored.ok) return res.status(400).json(scored);
      const row = await recordTrainingSession(pool, {
        username: req.platformAdmin?.username || 'admin',
        scenarioKey: req.body.scenario_key,
        response: req.body?.response,
        score: scored.score,
        feedback: scored.feedback,
      });
      res.json({ ok: true, ...scored, session: row });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/training/stats', platformAdminRequired, async (req, res) => {
    try {
      const stats = await getTrainingStats(pool, req.platformAdmin?.username || 'admin');
      res.json({ ok: true, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/trials/:id/validate', platformAdminRequired, async (req, res) => {
    try {
      const trialId = Number(req.params.id);
      const tr = await pool.query(`SELECT * FROM sales_trials WHERE id=$1`, [trialId]);
      const trial = tr.rows?.[0];
      if (!trial) return res.status(404).json({ ok: false, error: 'not_found' });
      const lead = await getLead(pool, trial.lead_id);
      const result = await validateTrialProgress(pool, {
        leadId: trial.lead_id,
        tenantId: trial.tenant_id || lead?.tenant_id,
        trialId,
        days: Number(req.body?.days) || 30,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/assistant/chat', platformAdminRequired, async (req, res) => {
    try {
      const result = await runSalesAssistantTurn(pool, {
        ownerUsername: req.platformAdmin?.username || 'admin',
        threadId: req.body?.thread_id,
        leadId: req.body?.lead_id ? Number(req.body.lead_id) : null,
        message: req.body?.message,
        history: req.body?.history,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/assistant/threads', platformAdminRequired, async (req, res) => {
    try {
      const threads = await listAssistantThreads(pool, req.platformAdmin?.username || 'admin');
      res.json({ ok: true, threads });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/assistant/threads/:id/messages', platformAdminRequired, async (req, res) => {
    try {
      const messages = await listAssistantMessages(pool, Number(req.params.id), req.platformAdmin?.username || 'admin');
      res.json({ ok: true, messages });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/loss-reasons', platformAdminRequired, async (req, res) => {
    try {
      const { recordLossReason } = await import('./services/sales/sales-store.js');
      const loss = await recordLossReason(pool, {
        leadId: Number(req.params?.id || req.body?.lead_id),
        reasonKey: req.body?.reason_key,
        reasonLabel: req.body?.reason_label,
        detail: req.body?.detail,
        evidence: req.body?.evidence,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, loss });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/objections', platformAdminRequired, async (req, res) => {
    try {
      const { recordObjection } = await import('./services/sales/sales-store.js');
      const obj = await recordObjection(pool, {
        leadId: Number(req.params?.id || req.body?.lead_id),
        objectionKey: req.body?.objection_key,
        objectionLabel: req.body?.objection_label,
        evidence: req.body?.evidence,
        responseText: req.body?.response_text,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, objection: obj });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/reps', platformAdminRequired, async (req, res) => {
    try {
      const reps = await listSalesReps(pool, { status: req.query?.status });
      res.json({ ok: true, reps });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/reps', platformAdminRequired, async (req, res) => {
    try {
      const rep = await createOrUpdateSalesRep(pool, {
        repKey: req.body?.rep_key,
        displayName: req.body?.display_name,
        role: req.body?.role,
        status: req.body?.status,
        hireDate: req.body?.hire_date,
      });
      res.json({ ok: true, rep });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/reps/:id/activity', platformAdminRequired, async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 180);
      const r = await pool.query(
        `SELECT * FROM sales_daily_activity
          WHERE rep_id = $1 AND activity_date >= (NOW() - ($2 || ' days')::interval)::date
          ORDER BY activity_date DESC`,
        [Number(req.params.id), days]
      );
      res.json({ ok: true, activity: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/reps/:id/scorecard', platformAdminRequired, async (req, res) => {
    try {
      const data = await getRepScorecard(pool, Number(req.params.id), req.query?.period_type, req.query?.period_key);
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/kpi-targets', platformAdminRequired, async (req, res) => {
    try {
      const target = await upsertKpiTarget(pool, {
        repId: Number(req.body?.rep_id),
        periodType: req.body?.period_type,
        periodKey: req.body?.period_key,
        targetNewLeads: req.body?.target_new_leads,
        targetDemos: req.body?.target_demos,
        targetDeals: req.body?.target_deals,
        targetRevenueFen: req.body?.target_revenue_fen,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, target });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/kpi-scores', platformAdminRequired, async (req, res) => {
    try {
      const score = await computeAndSaveKpiScore(pool, {
        repId: Number(req.body?.rep_id),
        periodType: req.body?.period_type,
        periodKey: req.body?.period_key,
        managerScore: req.body?.manager_score,
        managerComment: req.body?.manager_comment,
      });
      res.json({ ok: true, score });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/kpi-leaderboard', platformAdminRequired, async (req, res) => {
    try {
      const leaderboard = await getTeamLeaderboard(pool, { periodType: req.query?.period_type, periodKey: req.query?.period_key });
      res.json({ ok: true, leaderboard });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
