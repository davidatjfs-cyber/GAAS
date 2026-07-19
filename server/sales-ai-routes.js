/**
 * 销售 AI 路由：沙盒试聊 + 线索工作台 + 微信客服回调 + 销售漏斗/会客/风险
 */
import { ensureSalesTables, listLeads, getLead, loadLeadFunnel, upsertTask, addEvent, newLeadKey } from './services/sales/sales-store.js';
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
import { provisionTenantFromLead, provisionTenantFromOrder, listPendingProvisioningCompensations, rotateTenantAdminCredentials } from './services/sales-provisioning.js';
import { buildSalesBossDashboard } from './services/sales/sales-boss-metrics.js';
import { listCaseAssets, recommendCasesForLead, formatCaseForSend, getCaseAsset } from './services/sales/sales-case-library.js';
import { generateSalesProposal, runDeepDiagnosis, setSalesProposalLlm } from './services/sales/sales-proposal.js';
import { TRAINING_SCENARIOS, scoreTrainingResponse, recordTrainingSession, getTrainingStats } from './services/sales/sales-training.js';
import { runSalesAssistantTurn, listAssistantThreads, listAssistantMessages, setSalesAssistantLlm } from './services/sales/sales-internal-assistant.js';
import { checkPricePermission } from './services/sales/sales-price-policy.js';
import { validateTrialProgress, runTrialValidations, buildTrialProgressSummary } from './services/sales/sales-trial-monitor.js';
import {
  kfConfigured,
  kfEnv,
  verifyKfSignature,
  decryptKfEcho,
  decryptKfMessage,
  processKfCallbackEvent,
} from './services/sales/sales-kf.js';
import { SALES_PERSONA, PUBLIC_KNOWLEDGE, FORBIDDEN_CLAIMS } from './services/sales/sales-knowledge.js';
import { listKnowledgeItemsAdmin, upsertKnowledgeItem, deleteKnowledgeItem } from './services/sales/sales-knowledge-store.js';
import { listSendableContentAssets, sendContentAssetToLead } from './services/sales/sales-content-delivery.js';
import { getCreditRisk, scanCreditRisks } from './services/sales/sales-credit-risk.js';
import { brandKey, getCreditPoolRisk } from './services/sales/sales-order-credit.js';
import { buildLeadSummary, calculateSla } from './services/sales/sales-collaboration-service.js';
import { recordStageChange, transitionLeadStage } from './services/sales/sales-store.js';
import { runSalesSlaScan } from './services/sales/sales-sla-service.js';
import { runDeployCheckSlaScan, completeDeployCheck } from './services/sales/onboarding-sla-service.js';
import { runHealthCheckPeriodScan, deliverHealthCheckReport } from './services/sales/health-check-period-service.js';
import { runProvisioningRetryScan } from './services/sales/provisioning-retry-service.js';
import { runNurtureCadence } from './services/sales/sales-nurture.js';
import { getUnifiedCustomerTimeline } from './services/sales/sales-timeline.js';
import { buildTenantMonthlyValueReport } from './services/sales/tenant-value-report.js';
import { getOnboardingChecklist } from './services/sales/tenant-onboarding.js';
import { computeRenewalHealth, listRenewalRisks, listReferralCandidates, syncCustomerSuccessTasks, runRenewalBillReminders15d } from './services/sales/tenant-renewal-service.js';
import { maskLeadContact, maskLeadListContact, canViewFullContact, canViewContractPrice } from './services/sales/sales-privacy.js';
import { sensitiveRateLimit } from './services/sales/sales-rate-limit.js';
import { leadScopeSql, canAccessLead, canAccessRepMetrics, canAccessTenant, isManager } from './services/sales/sales-permissions.js';
import { getSalesPermissionConfig, saveSalesPermissionConfig, refreshSalesPermissionConfigCache, SALES_MODULES, SALES_CONFIGURABLE_ROLES } from './services/sales/sales-permission-config.js';
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

export function registerSalesAiRoutes(app, pool, platformAdminRequired, { callLLM, sendOpsAlert, requireSalesManagerOrAbove, upload } = {}) {
  // 提成规则/审批、KPI目标与主管打分、销售花名册这类"销售管理"操作，普通销售/客服
  // 不该碰，只有销售经理/超级管理员可以。没传这个中间件时(比如老的调用方式)退化成
  // 只做登录校验，不因为这次改造而让原本能用的调用方式直接报错。
  const managerGate = typeof requireSalesManagerOrAbove === 'function' ? requireSalesManagerOrAbove : (_req, _res, next) => next();
  const financeGate = (req, res, next) => {
    if (!['super_admin', 'finance'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅财务或超级管理员可确认回款' });
    next();
  };
  // 开票提醒财务和客服都要能看到/处理：客服经常是第一个知道"客户不需要发票"的人。
  const financeOrCsGate = (req, res, next) => {
    if (!['super_admin', 'finance', 'customer_service'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅财务/客服或超级管理员可处理开票提醒' });
    next();
  };
  // 签约价格/账期属于客户档案里最机密的一档信息，比手机号可见范围更窄——
  // sales_manager能看完整联系方式，但看不到签约价格。
  const contractPriceGate = (req, res, next) => {
    if (!canViewContractPrice(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅超级管理员/总经理/财务可查看或修改签约价格' });
    next();
  };
  /**
   * 订单标记"已付款"(现金，真正收到客人的钱)后，自动生成一条待开票申请——不用再等客户/客服
   * 主动发起"申请开票"这一步。用 order_id 唯一索引天然防重复(同一订单多次触发finance-decision
   * 也只会有一条开票申请)。注意：授信审核通过不算"收到付款"，不应该调用这个函数——
   * 账期客户还没实际付钱，见 approve_credit 分支旁边的说明。
   */
  async function ensureInvoiceRequestForOrder(order, requestedBy) {
    try {
      await pool.query(
        `INSERT INTO sales_invoices (contract_id, order_id, amount_fen, status, requested_by)
         VALUES ($1,$2,$3,'requested',$4) ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        [order.contract_id, order.id, order.amount_fen, requestedBy]
      );
    } catch (e) {
      console.warn('[sales-ai] auto invoice request failed:', e?.message || e);
    }
  }
  const generalManagerGate = (req, res, next) => {
    if (!['super_admin', 'general_manager'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅总经理可授信或解锁客户' });
    next();
  };
  const salesCreateCustomerGate = (req, res, next) => {
    if (!['super_admin', 'general_manager', 'sales_manager', 'sales'].includes(req.platformAdmin?.role)) {
      return res.status(403).json({ ok: false, error: 'forbidden', message: '仅销售人员或销售管理人员可以新建客户档案' });
    }
    next();
  };
  // 新闭环必须先形成订单并由财务确认，合同本身不得直接开通租户。
  const autoProvisionIfEligible = async () => null;
  if (typeof callLLM === 'function') {
    setSalesCustomerAiLlm(callLLM);
    setSalesReplyDraftLlm(callLLM);
    setSalesProposalLlm(callLLM);
    setSalesAssistantLlm(callLLM);
  }
  if (typeof sendOpsAlert === 'function') setSalesNotify(sendOpsAlert);

  refreshSalesPermissionConfigCache(pool).catch((e) => console.warn('[sales-ai] permission config warm-up failed:', e?.message || e));

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

  if (!globalThis.__salesSlaTimer) {
    globalThis.__salesSlaTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runSalesSlaScan(pool, sendOpsAlert)).catch((e) => console.warn('[sales-ai] SLA scan failed:', e?.message || e));
    }, 5 * 60 * 1000);
  }

  if (!globalThis.__salesDeployCheckSlaTimer) {
    globalThis.__salesDeployCheckSlaTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runDeployCheckSlaScan(pool, sendOpsAlert)).catch((e) => console.warn('[sales-ai] deploy check SLA scan failed:', e?.message || e));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesHealthCheckPeriodTimer) {
    globalThis.__salesHealthCheckPeriodTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runHealthCheckPeriodScan(pool, sendOpsAlert)).catch((e) => console.warn('[sales-ai] health check period scan failed:', e?.message || e));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesProvisioningRetryTimer) {
    globalThis.__salesProvisioningRetryTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runProvisioningRetryScan(pool, sendOpsAlert)).catch((e) => console.warn('[sales-ai] provisioning retry scan failed:', e?.message || e));
    }, 5 * 60 * 1000);
  }

  if (!globalThis.__salesNurtureCadenceTimer) {
    globalThis.__salesNurtureCadenceTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => runNurtureCadence(pool))
        .catch((e) => console.warn('[sales-ai] nurture cadence run failed:', e?.message || e));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesCreditRiskTimer) {
    globalThis.__salesCreditRiskTimer = setInterval(() => {
      scanCreditRisks(pool, sendOpsAlert).catch((e) => console.warn('[sales-ai] credit risk scan failed:', e?.message || e));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesCsTaskSyncTimer) {
    globalThis.__salesCsTaskSyncTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => syncCustomerSuccessTasks(pool))
        .catch((e) => console.warn('[sales-ai] CS task sync failed:', e?.message || e));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesRenewalBillReminderTimer) {
    globalThis.__salesRenewalBillReminderTimer = setInterval(() => {
      runRenewalBillReminders15d(pool, sendOpsAlert).catch((e) => console.warn('[sales-ai] renewal bill reminder failed:', e?.message || e));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesInvoiceReminderTimer) {
    let lastInvoiceReminderSentDate = null;
    globalThis.__salesInvoiceReminderTimer = setInterval(() => {
      const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      if (lastInvoiceReminderSentDate === period) return;
      pool.query(`SELECT i.*,c.contract_no,l.company,l.name FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE i.status='requested' ORDER BY i.created_at ASC`)
        .then((r) => {
          const items = r.rows || [];
          if (!items.length || typeof sendOpsAlert !== 'function') return;
          lastInvoiceReminderSentDate = period;
          return sendOpsAlert(
            ['【待开票提醒】', ...items.map((i) => `· ${i.company || i.name || `客户#${i.lead_id}`}：${i.contract_no || ''} 待开票 ¥${(Number(i.amount_fen) / 100).toFixed(2)}`)].join('\n'),
            { title: '待开票提醒', audience: 'sales' }
          );
        })
        .catch((e) => console.warn('[sales-ai] invoice reminder failed:', e?.message || e));
    }, 6 * 60 * 60 * 1000);
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

  // 所有以 /leads/:id 为目标的接口统一做记录级归属校验，避免某个新增路由忘记加权限。
  app.use('/api/admin/sales/leads/:id', platformAdminRequired, async (req, res, next) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      req.salesLead = lead;
      next();
    } catch (e) { console.error('[sales] lead scope check failed:', e?.message || e); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

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
      const { msg_signature, timestamp, nonce } = req.query || {};
      if (env.token && encrypt && msg_signature) {
        const expect = verifyKfSignature(env.token, timestamp, nonce, encrypt);
        if (expect !== String(msg_signature)) {
          console.warn('[sales-kf] callback signature mismatch, ignoring');
          return;
        }
      }
      if (encrypt && env.aesKey) {
        try {
          const plain = decryptKfMessage(String(encrypt), env.aesKey);
          // 企微自建应用一个回调地址会推送多种事件类型；"外部联系人变更回调"和"微信客服
          // 消息和事件"共用同一个URL/Token/EncodingAESKey，这里先分流给客户联系事件处理，
          // 命中就直接返回，不再走下面 KF 消息同步的逻辑。
          const { handleExternalContactChangeEvent } = await import('./services/sales/wecom-contact-events.js');
          if (await handleExternalContactChangeEvent(pool, plain)) return;
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

  // 任何已登录的销售后台管理员都能读(前端要靠这个算出自己能看到哪些CRM模块)，
  // 但只有销售经理/总经理/超级管理员能改——改的是别人的可见范围，不是自己的。
  app.get('/api/admin/sales/permission-config', platformAdminRequired, async (req, res) => {
    try {
      const config = await getSalesPermissionConfig(pool);
      res.json({ ok: true, config, modules: SALES_MODULES, roles: SALES_CONFIGURABLE_ROLES, my_role: req.platformAdmin?.role || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.put('/api/admin/sales/permission-config', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const config = await saveSalesPermissionConfig(pool, req.body?.config || {}, req.platformAdmin?.username);
      res.json({ ok: true, config, modules: SALES_MODULES, roles: SALES_CONFIGURABLE_ROLES });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/knowledge', platformAdminRequired, async (_req, res) => {
    try {
      const items = await listKnowledgeItemsAdmin(pool);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/knowledge', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const body = String(req.body?.body || '').trim();
      const itemKey = String(req.body?.item_key || '').trim();
      if (!itemKey || !title || !body) return res.status(400).json({ ok: false, error: 'missing_fields' });
      const painKeys = String(req.body?.pain_keys || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const item = await upsertKnowledgeItem(pool, {
        id: req.body?.id ? Number(req.body.id) : null,
        item_key: itemKey,
        title,
        body,
        pain_keys: painKeys,
        active: req.body?.active !== false,
        sort_order: Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0,
      });
      res.json({ ok: true, item });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.delete('/api/admin/sales/knowledge/:id', platformAdminRequired, managerGate, async (req, res) => {
    try {
      await deleteKnowledgeItem(pool, Number(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // 内容资产只允许销售经理/超级管理员维护；销售只能发送已审批的资产，避免把内部资料误发给客户。
  app.get('/api/admin/sales/content-assets', platformAdminRequired, async (req, res) => {
    try {
      const canViewInternal = isManager(req.platformAdmin) || req.platformAdmin?.role === 'auditor';
      const items = canViewInternal
        ? (await pool.query(
            `SELECT * FROM sales_content_assets WHERE active=true
             ORDER BY knowledge_domain, updated_at DESC LIMIT $1`,
            [Math.min(Number(req.query?.limit) || 100, 500)]
          )).rows
        : await listSendableContentAssets(pool, { tag: req.query?.tag, limit: Number(req.query?.limit) || 100 });
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/content-assets', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const body = req.body || {};
      const assetKey = String(body.asset_key || '').trim();
      const title = String(body.title || '').trim();
      const contentType = String(body.content_type || '').trim();
      const knowledgeDomain = String(body.knowledge_domain || 'customer_ai').trim();
      if (!assetKey || !title || !['text', 'image', 'file', 'video', 'link', 'qr'].includes(contentType)) return res.status(400).json({ ok: false, error: 'invalid_asset' });
      if (!['customer_ai', 'sales_ai', 'implementation'].includes(knowledgeDomain)) return res.status(400).json({ ok: false, error: 'invalid_knowledge_domain' });
      if (knowledgeDomain !== 'customer_ai' && (body.external_approved || body.auto_send_allowed)) return res.status(400).json({ ok: false, error: 'internal_asset_cannot_be_external' });
      const mediaUrl = String(body.media_url || '');
      if (['image', 'file', 'video', 'qr'].includes(contentType) && !(/^https:\/\//.test(mediaUrl) || /^\/uploads\/[A-Za-z0-9._-]+$/.test(mediaUrl))) {
        return res.status(400).json({ ok: false, error: 'safe_media_url_required' });
      }
      const r = await pool.query(
        `INSERT INTO sales_content_assets (asset_key,title,content_type,text_content,media_url,file_name,external_approved,active,auto_send_allowed,tags,created_by,approved_by,nurture_step,knowledge_domain,customer_types,version_no,effective_from,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
         ON CONFLICT (asset_key) DO UPDATE SET title=EXCLUDED.title,content_type=EXCLUDED.content_type,text_content=EXCLUDED.text_content,media_url=EXCLUDED.media_url,file_name=EXCLUDED.file_name,external_approved=EXCLUDED.external_approved,active=EXCLUDED.active,auto_send_allowed=EXCLUDED.auto_send_allowed,tags=EXCLUDED.tags,approved_by=EXCLUDED.approved_by,nurture_step=EXCLUDED.nurture_step,knowledge_domain=EXCLUDED.knowledge_domain,customer_types=EXCLUDED.customer_types,version_no=EXCLUDED.version_no,effective_from=EXCLUDED.effective_from,expires_at=EXCLUDED.expires_at,updated_at=NOW()
         RETURNING *`,
        [assetKey, title, contentType, body.text_content || null, body.media_url || null, body.file_name || null, knowledgeDomain === 'customer_ai' && !!body.external_approved, body.active !== false, knowledgeDomain === 'customer_ai' && !!body.auto_send_allowed, JSON.stringify(Array.isArray(body.tags) ? body.tags : []), req.platformAdmin.username, body.external_approved ? req.platformAdmin.username : null, body.nurture_step ? Number(body.nurture_step) : null, knowledgeDomain, JSON.stringify(Array.isArray(body.customer_types) ? body.customer_types : []), Math.max(1, Number(body.version_no) || 1), body.effective_from || null, body.expires_at || null]
      );
      res.json({ ok: true, asset: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  if (upload?.single) app.post('/api/admin/sales/content-assets/upload', platformAdminRequired, managerGate, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
      if (Number(req.file.size || 0) > 20 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'asset_too_large', message: '企微发送素材不能超过20MB' });
      const mime = String(req.file.mimetype || '');
      const contentType = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
      res.json({ ok: true, media_url: `/uploads/${req.file.filename}`, file_name: req.file.originalname, content_type: contentType });
    } catch (e) { res.status(500).json({ ok: false, error: 'upload_failed', message: e?.message }); }
  });

  if (upload?.single) app.post('/api/admin/sales/documents/upload', platformAdminRequired, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
      if (Number(req.file.size || 0) > 20 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'document_too_large' });
      const mime = String(req.file.mimetype || '');
      const allowed = mime === 'application/pdf' || mime.startsWith('image/') || mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (!allowed) return res.status(415).json({ ok: false, error: 'unsupported_document_type' });
      res.json({ ok: true, file_url: `/uploads/${req.file.filename}`, file_name: req.file.originalname });
    } catch (e) { res.status(500).json({ ok: false, error: 'upload_failed', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/content-deliveries', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const assetId = Number(req.body?.asset_id);
      const r = await pool.query(`SELECT * FROM sales_content_assets WHERE id=$1 AND active=true AND external_approved=true LIMIT 1`, [assetId]);
      if (!r.rows?.[0]) return res.status(404).json({ ok: false, error: 'approved_asset_not_found' });
      const result = await sendContentAssetToLead(pool, lead, r.rows[0], { deliveryType: 'manual', sentBy: req.platformAdmin.username });
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, asset_key, payload, created_by) VALUES ($1,'send_content',$2,$3::jsonb,$4)`, [lead.id, r.rows[0].asset_key, JSON.stringify(result), req.platformAdmin.username]);
      res.json({ ok: true, result });
    } catch (e) { res.status(502).json({ ok: false, error: 'content_delivery_failed', message: e?.message }); }
  });

  app.put('/api/admin/sales/leads/:id/auto-nurture', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const enabled = req.body?.enabled === true;
      const r = await pool.query(`UPDATE sales_leads SET auto_nurture_enabled=$2, auto_nurture_paused_at=CASE WHEN $2 THEN NULL ELSE NOW() END, updated_at=NOW() WHERE id=$1 RETURNING id,auto_nurture_enabled,auto_nurture_paused_at`, [lead.id, enabled]);
      res.json({ ok: true, lead: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/contracts', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const contractNo = String(req.body?.contract_no || '').trim();
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (!contractNo || amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_contract' });
      const r = await pool.query(
        `INSERT INTO sales_contracts (lead_id,contract_no,status,amount_fen,file_url,file_name,created_by,version_no,supersedes_contract_id)
         VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8) RETURNING *`,
        [lead.id, contractNo, amountFen, req.body?.file_url || null, req.body?.file_name || null, req.platformAdmin.username, Math.max(1, Number(req.body?.version_no) || 1), req.body?.supersedes_contract_id ? Number(req.body.supersedes_contract_id) : null]
      );
      await pool.query(`INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status) VALUES ($1,'cash',0,'active') ON CONFLICT (lead_id) DO NOTHING`, [lead.id]);
      res.json({ ok: true, contract: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.get('/api/admin/sales/leads/:id/crm-overview', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const [contracts, payments, invoices, delivery, contentDeliveries, risk, orders, creditPoolRow] = await Promise.all([
        pool.query(`SELECT * FROM sales_contracts WHERE lead_id=$1 ORDER BY created_at DESC`, [lead.id]),
        pool.query(`SELECT p.* FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id WHERE c.lead_id=$1 ORDER BY p.created_at DESC`, [lead.id]),
        pool.query(`SELECT i.* FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id WHERE c.lead_id=$1 ORDER BY i.created_at DESC`, [lead.id]),
        pool.query(`SELECT * FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]),
        pool.query(`SELECT d.*,a.title AS asset_title,a.content_type FROM sales_content_deliveries d LEFT JOIN sales_content_assets a ON a.id=d.asset_id WHERE d.lead_id=$1 ORDER BY d.created_at DESC LIMIT 50`, [lead.id]),
        getCreditRisk(pool, lead.id),
        pool.query(`SELECT o.*,p.brand_name,p.payment_type,p.credit_limit_fen,p.status AS pool_status FROM sales_orders o JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.lead_id=$1 ORDER BY o.created_at DESC`, [lead.id]),
        pool.query(`SELECT p.* FROM sales_credit_pools p JOIN sales_credit_pool_members m ON m.credit_pool_id=p.id WHERE m.lead_id=$1`, [lead.id]),
      ]);
      const creditPool = creditPoolRow.rows?.[0] ? await getCreditPoolRisk(pool, creditPoolRow.rows[0].id) : null;
      res.json({ ok: true, contracts: contracts.rows, payments: payments.rows, invoices: invoices.rows, delivery: delivery.rows?.[0] || null, content_deliveries: contentDeliveries.rows, credit_risk: risk, orders: orders.rows, credit_pool: creditPool });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.patch('/api/admin/sales/contracts/:id/status', platformAdminRequired, async (req, res) => {
    try {
      const status = String(req.body?.status || '').trim();
      if (!['customer_signed', 'our_signed', 'effective', 'cancelled'].includes(status)) return res.status(400).json({ ok: false, error: 'invalid_contract_status' });
      const c = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to,l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      const contract = c.rows?.[0];
      if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok: false, error: 'not_found' });
      if ((status === 'our_signed' || status === 'effective' || status === 'cancelled') && !isManager(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'manager_required' });
      if (status === 'effective' && (!contract.customer_signed_at || !contract.our_signed_at)) return res.status(409).json({ ok: false, error: 'both_signatures_required' });
      const signedFile = String(req.body?.file_url || '').trim() || null;
      const r = await pool.query(
        `UPDATE sales_contracts SET status=$2,
           customer_signed_at=CASE WHEN $2='customer_signed' THEN NOW() ELSE customer_signed_at END,
           customer_signed_file_url=CASE WHEN $2='customer_signed' THEN COALESCE($3,customer_signed_file_url) ELSE customer_signed_file_url END,
           our_signed_at=CASE WHEN $2='our_signed' THEN NOW() ELSE our_signed_at END,
           our_signed_file_url=CASE WHEN $2='our_signed' THEN COALESCE($3,our_signed_file_url) ELSE our_signed_file_url END,
           effective_at=CASE WHEN $2='effective' THEN NOW() ELSE effective_at END,
           approved_by=CASE WHEN $2 IN ('our_signed','effective') THEN $4 ELSE approved_by END,updated_at=NOW()
         WHERE id=$1 RETURNING *`, [contract.id, status, signedFile, req.platformAdmin.username]
      );
      const risk = status === 'effective' ? await getCreditRisk(pool, contract.lead_id) : null;
      const provision = status === 'effective' ? await autoProvisionIfEligible(contract.lead_id, req.platformAdmin.username) : null;
      res.json({ ok: true, contract: r.rows[0], credit_risk: risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/contracts/:id/payments', platformAdminRequired, async (req, res) => {
    try {
      const r = await pool.query(`SELECT c.*, l.owner_username, l.assigned_to, l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      const contract = r.rows?.[0];
      if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok: false, error: 'not_found' });
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_payment' });
      const p = await pool.query(`INSERT INTO sales_payments (contract_id,amount_fen,paid_at,receipt_url,status,submitted_by,note) VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING *`, [contract.id, amountFen, req.body?.paid_at || null, req.body?.receipt_url || null, req.platformAdmin.username, req.body?.note || null]);
      res.json({ ok: true, payment: p.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/payments/:id/confirm', platformAdminRequired, financeGate, async (req, res) => {
    try {
      const p = await pool.query(`UPDATE sales_payments SET status='confirmed',confirmed_by=$2,confirmed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING *`, [Number(req.params.id), req.platformAdmin.username]);
      if (!p.rows?.[0]) return res.status(409).json({ ok: false, error: 'payment_not_pending' });
      const lead = await pool.query(`SELECT c.lead_id FROM sales_contracts c WHERE c.id=$1`, [p.rows[0].contract_id]);
      const risk = lead.rows?.[0] ? await getCreditRisk(pool, lead.rows[0].lead_id) : null;
      const provision = lead.rows?.[0] ? await autoProvisionIfEligible(lead.rows[0].lead_id, req.platformAdmin.username) : null;
      res.json({ ok: true, payment: p.rows[0], credit_risk: risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.get('/api/admin/sales/finance/pending-payments', platformAdminRequired, financeGate, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT p.*,c.contract_no,c.lead_id,l.company,l.name FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE p.status='pending' ORDER BY p.created_at ASC`);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.get('/api/admin/sales/finance/pending-invoices', platformAdminRequired, financeOrCsGate, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT i.*,c.contract_no,c.lead_id,l.company,l.name FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE i.status='requested' ORDER BY i.created_at ASC`);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/contracts/:id/invoices', platformAdminRequired, async (req, res) => {
    try {
      const c = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to,l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      if (!c.rows?.[0] || !canAccessLead(req.platformAdmin, c.rows[0])) return res.status(404).json({ ok: false, error: 'not_found' });
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_invoice_amount' });
      const r = await pool.query(`INSERT INTO sales_invoices (contract_id,amount_fen,status,requested_by) VALUES ($1,$2,'requested',$3) RETURNING *`, [c.rows[0].id, amountFen, req.platformAdmin.username]);
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.patch('/api/admin/sales/invoices/:id/issued', platformAdminRequired, financeGate, async (req, res) => {
    try {
      const r = await pool.query(`UPDATE sales_invoices SET status='issued',invoice_no=$2,file_url=$3,issued_by=$4,issued_at=NOW(),resolved_by=$4,resolved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='requested' RETURNING *`, [Number(req.params.id), req.body?.invoice_no || null, req.body?.file_url || null, req.platformAdmin.username]);
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'invoice_not_requested' });
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // 客户明确表示不需要发票——财务或客服都能操作，停止后续提醒。
  app.patch('/api/admin/sales/invoices/:id/ignore', platformAdminRequired, financeOrCsGate, async (req, res) => {
    try {
      const reason = String(req.body?.reason || '客户不需要发票').trim();
      const r = await pool.query(`UPDATE sales_invoices SET status='cancelled',ignored_reason=$2,resolved_by=$3,resolved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='requested' RETURNING *`, [Number(req.params.id), reason, req.platformAdmin.username]);
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'invoice_not_requested' });
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.get('/api/admin/sales/leads/:id/credit-risk', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json(await getCreditRisk(pool, lead.id));
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/credit-risk', platformAdminRequired, generalManagerGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const paymentType = String(req.body?.payment_type || '').trim();
      const limitFen = Math.round(Number(req.body?.credit_limit || 0) * 100);
      if (!['cash', 'credit'].includes(paymentType) || (paymentType === 'credit' && limitFen <= 0)) return res.status(400).json({ ok: false, error: 'invalid_credit_terms' });
      const r = await pool.query(
        `INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status,approved_by,approved_at,lock_reason)
         VALUES ($1,$2,$3,'active',$4,NOW(),NULL)
         ON CONFLICT (lead_id) DO UPDATE SET payment_type=EXCLUDED.payment_type,credit_limit_fen=EXCLUDED.credit_limit_fen,status='active',approved_by=EXCLUDED.approved_by,approved_at=NOW(),lock_reason=NULL,updated_at=NOW()
         RETURNING *`, [lead.id, paymentType, paymentType === 'cash' ? 0 : limitFen, req.platformAdmin.username]
      );
      const risk = await getCreditRisk(pool, lead.id);
      const provision = await autoProvisionIfEligible(lead.id, req.platformAdmin.username);
      res.json({ ok: true, account: r.rows[0], risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/contracts/:id/submit-approval', platformAdminRequired, async (req, res) => {
    const r = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
    const contract = r.rows?.[0];
    if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok:false,error:'not_found' });
    if (!contract.file_url) return res.status(400).json({ ok:false,error:'signed_contract_required',message:'请先上传签约合同文件' });
    const updated = await pool.query(`UPDATE sales_contracts SET approval_status='pending',submitted_by=$2,submitted_at=NOW(),updated_at=NOW() WHERE id=$1 AND approval_status IN ('draft','rejected') RETURNING *`, [contract.id, req.platformAdmin.username]);
    if (!updated.rows?.[0]) return res.status(409).json({ ok:false,error:'approval_not_submittable' });
    res.json({ ok:true,contract:updated.rows[0] });
  });

  app.get('/api/admin/sales/approvals/contracts', platformAdminRequired, generalManagerGate, async (_req,res) => {
    const r = await pool.query(`SELECT c.*,l.company,l.name FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.approval_status='pending' ORDER BY c.submitted_at ASC`);
    res.json({ ok:true, items:r.rows });
  });

  app.post('/api/admin/sales/contracts/:id/approve', platformAdminRequired, generalManagerGate, async (req,res) => {
    const contractRow = await pool.query(`SELECT c.*,l.company,l.name,l.id AS lead_id FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
    const contract = contractRow.rows?.[0];
    const paymentType = String(req.body?.payment_type || 'cash');
    const limitFen = Math.round(Number(req.body?.credit_limit || 0) * 100);
    const brandName = String(req.body?.brand_name || contract?.company || '').trim();
    if (!contract || contract.approval_status !== 'pending') return res.status(409).json({ ok:false,error:'approval_not_pending' });
    if (!['cash','credit'].includes(paymentType) || !brandName || (paymentType === 'credit' && limitFen <= 0)) return res.status(400).json({ ok:false,error:'invalid_credit_terms',message:'帐期客户必须填写品牌名称和授信金额' });
    const poolResult = await pool.query(`INSERT INTO sales_credit_pools (brand_key,brand_name,payment_type,credit_limit_fen,status,approved_by,approved_at,lock_reason)
      VALUES ($1,$2,$3,$4,'active',$5,NOW(),NULL) ON CONFLICT (brand_key) DO UPDATE SET brand_name=EXCLUDED.brand_name,payment_type=EXCLUDED.payment_type,credit_limit_fen=EXCLUDED.credit_limit_fen,status='active',approved_by=EXCLUDED.approved_by,approved_at=NOW(),lock_reason=NULL,updated_at=NOW() RETURNING *`, [brandKey(brandName),brandName,paymentType,paymentType==='credit'?limitFen:0,req.platformAdmin.username]);
    await pool.query(`INSERT INTO sales_credit_pool_members (lead_id,credit_pool_id) VALUES ($1,$2) ON CONFLICT (lead_id) DO UPDATE SET credit_pool_id=EXCLUDED.credit_pool_id`, [contract.lead_id,poolResult.rows[0].id]);
    const approved = await pool.query(`UPDATE sales_contracts SET approval_status='approved',status='effective',approved_by=$2,approved_at=NOW(),approval_note=$3,payment_type=$4,brand_name=$5,effective_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`, [contract.id,req.platformAdmin.username,String(req.body?.approval_note||''),paymentType,brandName]);
    res.json({ ok:true, contract:approved.rows[0], credit_pool:poolResult.rows[0] });
  });

  app.post('/api/admin/sales/leads/:id/orders', platformAdminRequired, salesCreateCustomerGate, async (req,res) => {
    const lead = await getLead(pool, Number(req.params.id));
    const body=req.body||{}; const amountFen=Math.round(Number(body.amount||0)*100);
    if (!lead || !canAccessLead(req.platformAdmin,lead)) return res.status(404).json({ok:false,error:'not_found'});
    if (!['new_store','renewal'].includes(body.order_type) || !String(body.store_name||'').trim() || amountFen<=0) return res.status(400).json({ok:false,error:'invalid_order',message:'请填写订单类型、门店名称和订单金额'});
    const contract=await pool.query(`SELECT * FROM sales_contracts WHERE id=$1 AND lead_id=$2 AND approval_status='approved' LIMIT 1`,[Number(body.contract_id),lead.id]);
    const member=await pool.query(`SELECT credit_pool_id FROM sales_credit_pool_members WHERE lead_id=$1`,[lead.id]);
    if (!contract.rows?.[0] || !member.rows?.[0]) return res.status(409).json({ok:false,error:'approved_contract_required',message:'必须先完成总经理合同及授信审批后才能新建订单'});
    const no=`ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
    const qty=Math.max(1,Number(body.store_quantity)||1); const licenseDays=Math.max(1,Number(body.license_days)||365); const brandName=String(body.brand_name||'').trim(); const orderBrandKey=brandName ? brandKey(brandName) : null;
    const order=await pool.query(`INSERT INTO sales_orders (order_no,lead_id,contract_id,credit_pool_id,order_type,store_quantity,license_days,amount_fen,store_name,brand_name,brand_key,store_address,contact_name,contact_phone,area_sqm,restaurant_type,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[no,lead.id,contract.rows[0].id,member.rows[0].credit_pool_id,body.order_type,qty,licenseDays,amountFen,String(body.store_name).trim(),brandName||null,orderBrandKey,body.store_address||null,body.contact_name||null,body.contact_phone||null,Number(body.area_sqm)||null,body.restaurant_type||null,req.platformAdmin.username]);
    res.status(201).json({ok:true,order:order.rows[0]});
  });

  app.get('/api/admin/sales/finance/orders', platformAdminRequired, financeGate, async (_req,res) => {
    const r=await pool.query(`SELECT o.*,l.company,l.name,p.brand_name,p.payment_type,p.credit_limit_fen,p.status AS pool_status FROM sales_orders o JOIN sales_leads l ON l.id=o.lead_id JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.status='finance_pending' ORDER BY o.submitted_at ASC`);
    res.json({ok:true,items:r.rows});
  });

  app.post('/api/admin/sales/orders/:id/finance-decision', platformAdminRequired, financeGate, async (req,res) => {
    const orderRow=await pool.query(`SELECT o.*,p.payment_type,p.status AS pool_status FROM sales_orders o JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.id=$1`,[Number(req.params.id)]);
    const order=orderRow.rows?.[0]; const action=String(req.body?.action||'');
    if(!order || order.status!=='finance_pending') return res.status(409).json({ok:false,error:'order_not_pending'});
    if(action==='return'){const u=await pool.query(`UPDATE sales_orders SET status='returned',return_reason=$2,finance_by=$3,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,String(req.body?.reason||'财务退回'),req.platformAdmin.username]);return res.json({ok:true,order:u.rows[0]});}
    if(order.payment_type==='cash' && action==='confirm_paid'){
      const paidFen=Math.round(Number(req.body?.amount||order.amount_fen/100)*100); if(paidFen<=0) return res.status(400).json({ok:false,error:'invalid_payment'});
      await pool.query(`INSERT INTO sales_order_payments (order_id,amount_fen,receipt_url,received_by,note) VALUES ($1,$2,$3,$4,$5)`,[order.id,paidFen,req.body?.receipt_url||null,req.platformAdmin.username,req.body?.note||null]);
      const u=await pool.query(`UPDATE sales_orders SET status='paid',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);
      await ensureInvoiceRequestForOrder(u.rows[0], req.platformAdmin.username);
      const provision=await provisionTenantFromOrder(pool,order.id,{startedBy:req.platformAdmin.username}); return res.json({ok:true,order:u.rows[0],provision});
    }
    if(order.payment_type==='credit' && action==='approve_credit'){
      const risk=await getCreditPoolRisk(pool,order.credit_pool_id,{lockWhenExceeded:false}); const projected=Number(risk.outstanding_fen)+Number(order.amount_fen);
      if(risk.status!=='active' || projected>Number(risk.credit_limit_fen)){await pool.query(`UPDATE sales_credit_pools SET status='locked',lock_reason=$2,updated_at=NOW() WHERE id=$1`,[order.credit_pool_id,`订单 ${order.order_no} 审核后欠款将达${projected}分，超过授信${risk.credit_limit_fen}分`]);const u=await pool.query(`UPDATE sales_orders SET status='returned',return_reason='品牌欠款超过授信，已锁定，需总经理重新授信',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);return res.status(409).json({ok:false,error:'credit_limit_exceeded',order:u.rows[0],risk:{...risk,projected_outstanding_fen:projected}});}
      // 授信通过只是"允许赊账开通"，客户这时候还没有真的付钱，不该在这一步生成开票申请——
      // 只有 confirm_paid(现金已收款) 才是真正"收到客人付款"的那一刻，见上面 ensureInvoiceRequestForOrder 的唯一调用点。
      const u=await pool.query(`UPDATE sales_orders SET status='credit_approved',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);const provision=await provisionTenantFromOrder(pool,order.id,{startedBy:req.platformAdmin.username});return res.json({ok:true,order:u.rows[0],provision,credit_risk:await getCreditPoolRisk(pool,order.credit_pool_id)});
    }
    return res.status(400).json({ok:false,error:'invalid_finance_action'});
  });

  app.get('/api/admin/sales/leads/:id/delivery', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const r = await pool.query(`SELECT * FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      res.json({ ok: true, project: r.rows?.[0] || null });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/delivery', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const allowed = ['pending', 'assigned', 'data_import', 'diagnosis', 'configuration', 'acceptance', 'delivered'];
      const status = String(req.body?.status || '').trim();
      if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'invalid_delivery_status' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const prior = await pool.query(`SELECT status FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      const r = await pool.query(
        `UPDATE sales_delivery_projects SET status=$2, implementation_owner=COALESCE($3,implementation_owner), cs_owner=COALESCE($4,cs_owner),
           assigned_at=CASE WHEN $2='assigned' THEN COALESCE(assigned_at,NOW()) ELSE assigned_at END,
           data_imported_at=CASE WHEN $2='data_import' THEN COALESCE(data_imported_at,NOW()) ELSE data_imported_at END,
           diagnosis_completed_at=CASE WHEN $2='diagnosis' THEN COALESCE(diagnosis_completed_at,NOW()) ELSE diagnosis_completed_at END,
           configured_at=CASE WHEN $2='configuration' THEN COALESCE(configured_at,NOW()) ELSE configured_at END,
           acceptance_completed_at=CASE WHEN $2='acceptance' THEN COALESCE(acceptance_completed_at,NOW()) ELSE acceptance_completed_at END,
           account_sent_at=CASE WHEN $2='delivered' THEN COALESCE(account_sent_at,NOW()) ELSE account_sent_at END,
           accepted_at=CASE WHEN $2='delivered' THEN COALESCE(accepted_at,NOW()) ELSE accepted_at END,updated_at=NOW()
         WHERE lead_id=$1 RETURNING *`,
        [lead.id, status, req.body?.implementation_owner || null, req.body?.cs_owner || null]
      );
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const credentials = status === 'delivered' && prior.rows?.[0]?.status !== 'delivered' ? await rotateTenantAdminCredentials(pool, lead.id) : null;
      res.json({ ok: true, project: r.rows[0], credentials });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/delivery/deploy-check-complete', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const project = await pool.query(`SELECT id FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      if (!project.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const updated = await completeDeployCheck(pool, project.rows[0].id);
      res.json({ ok: true, project: updated });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/delivery/health-check-report', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const project = await pool.query(`SELECT id FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      if (!project.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const updated = await deliverHealthCheckReport(pool, project.rows[0].id, req.body?.report_ref);
      res.json({ ok: true, project: updated });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  // 销售自主拜访、转介绍、展会等非客户 AI 来源，统一在此建立客户档案。
  // 数据仍落在 sales_leads，确保后续拜访、合同、回款、授信、开通和交付完全复用同一闭环；
  // 但对业务界面使用 customer_code，不再把内部“线索”编号暴露给用户。
  app.post('/api/admin/sales/customers', platformAdminRequired, salesCreateCustomerGate, async (req, res) => {
    const body = req.body || {};
    const company = String(body.company || '').trim();
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const contactTitle = String(body.contact_title || '').trim();
    const rawBrands = Array.isArray(body.customer_brands) ? body.customer_brands : [];
    const customerBrands = rawBrands.map((item) => ({
      brand_name: String(item?.brand_name || '').trim(),
      city: String(item?.city || '').trim(),
      store_count: Math.max(0, Number(item?.store_count) || 0),
    })).filter((item) => item.brand_name || item.city || item.store_count);
    const customerCities = [...new Set(customerBrands.map((item) => item.city).filter(Boolean))];
    const city = customerCities[0] || String(body.city || '').trim();
    const storeCount = customerBrands.reduce((total, item) => total + item.store_count, 0) || Number(body.store_count) || null;
    const customerContacts = [{ name, title: contactTitle, phone }].filter((item) => item.name || item.phone);
    const requestedPaymentType = String(body.requested_payment_type || 'cash').trim();
    const requestedCreditDays = Math.max(0, Number(body.requested_credit_days) || 0);
    const requestedCreditLimitFen = Math.max(0, Math.round(Number(body.requested_credit_limit || 0) * 100));
    const origin = String(body.customer_origin || 'sales_visit').trim();
    const allowedOrigins = new Set(['sales_visit', 'referral', 'exhibition', 'phone_outreach', 'other']);
    if (!company) return res.status(400).json({ ok: false, error: 'company_required', message: '请填写客户企业名称' });
    if (!name && !phone) return res.status(400).json({ ok: false, error: 'contact_required', message: '请至少填写联系人姓名或联系电话' });
    if (!customerBrands.length) return res.status(400).json({ ok: false, error: 'brand_required', message: '请至少填写一个品牌、城市和门店数量' });
    if (customerBrands.some((item) => !item.brand_name || !item.city || !item.store_count)) return res.status(400).json({ ok: false, error: 'brand_invalid', message: '每个品牌都需要填写品牌名称、城市和门店数量' });
    if (!['cash', 'credit'].includes(requestedPaymentType)) return res.status(400).json({ ok: false, error: 'payment_type_invalid', message: '客户性质不正确' });
    if (requestedPaymentType === 'credit' && (!requestedCreditDays || !requestedCreditLimitFen)) return res.status(400).json({ ok: false, error: 'credit_terms_required', message: '帐期客户请填写申请账期天数和申请授信金额' });
    if (!allowedOrigins.has(origin)) return res.status(400).json({ ok: false, error: 'invalid_origin', message: '客户来源不正确' });
    try {
      await ensureSalesTables(pool);
      const duplicate = await pool.query(
        `SELECT * FROM sales_leads
          WHERE ($1 <> '' AND phone = $1)
             OR (LOWER(COALESCE(company,'')) = LOWER($2) AND COALESCE(city,'') = $3)
          ORDER BY updated_at DESC LIMIT 1`,
        [phone, company, city]
      );
      const existing = duplicate.rows?.[0];
      if (existing) {
        if (canAccessLead(req.platformAdmin, existing)) {
          return res.status(409).json({ ok: false, error: 'customer_exists', message: '该客户已建档，请直接打开已有客户档案', existing: { id: existing.id, customer_code: existing.customer_code || null, company: existing.company, name: existing.name } });
        }
        return res.status(409).json({ ok: false, error: 'customer_exists', message: '该客户已建档，请联系销售经理确认归属' });
      }
      const owner = req.platformAdmin?.username || null;
      const visitNotes = String(body.first_visit_notes || '').trim();
      const followupAt = body.next_followup_at ? new Date(body.next_followup_at) : null;
      const r = await pool.query(
        `INSERT INTO sales_leads
          (lead_key, customer_code, customer_origin, source_channel, manual_created_by, manual_created_at,
           name, company, phone, city, region_code, region_name, cuisine, store_count, pos_brand,
           legal_contact_name, legal_contact_title, legal_contact_phone,
           customer_brands, customer_cities, customer_contacts,
           requested_payment_type, requested_credit_days, requested_credit_limit_fen,
           stage, controller, intent_score, intent_level, owner_username, assigned_to,
           next_action, next_action_due, tags, extracted)
         VALUES ($1,$2,$3,'manual',$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,
                 'sales_takeover','human',0,'low',$4,$4,
                 $23,$24::timestamptz,$25::jsonb,$26::jsonb)
         RETURNING *`,
        [
          newLeadKey('M'), `KH${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`,
          origin, owner, name || null, company, phone || null, city || null,
          String(body.region_code || '').trim() || null, String(body.region_name || '').trim() || null,
          String(body.cuisine || '').trim() || null, storeCount, String(body.pos_brand || customerBrands[0]?.brand_name || '').trim() || null,
          name || null, contactTitle || null, phone || null,
          JSON.stringify(customerBrands), JSON.stringify(customerCities), JSON.stringify(customerContacts),
          requestedPaymentType, requestedPaymentType === 'credit' ? requestedCreditDays : null, requestedPaymentType === 'credit' ? requestedCreditLimitFen : null,
          String(body.next_action || '补全客户档案并安排下一次跟进').trim(), followupAt && !Number.isNaN(followupAt.getTime()) ? followupAt.toISOString() : null,
          JSON.stringify(['销售自主建档']), JSON.stringify({ source: 'manual_customer', first_visit_notes: visitNotes || null, customer_brands: customerBrands, requested_payment_type: requestedPaymentType }),
        ]
      );
      const customer = r.rows?.[0];
      await pool.query(
        `INSERT INTO sales_conversations (lead_id, controller, status, meta) VALUES ($1,'human','open',$2::jsonb)`,
        [customer.id, JSON.stringify({ source: 'manual_customer', customer_origin: origin })]
      );
      await addEvent(pool, customer.id, {
        event_type: 'MANUAL_CUSTOMER_CREATED', summary: '销售自主建立客户档案', evidence: visitNotes || null,
        priority: 'normal', recommended_action: customer.next_action, actor_type: 'human', actor_id: owner,
        source_type: 'manual_customer', source_id: origin, payload: { customer_origin: origin, first_visit_notes: visitNotes || null },
      });
      res.status(201).json({ ok: true, customer });
    } catch (e) {
      console.error('[sales] create manual customer failed:', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error', message: '客户建档失败，请稍后重试' });
    }
  });

  app.get('/api/admin/sales/leads', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const scope = leadScopeSql(req.platformAdmin, 4);
      const leads = await listLeads(pool, { stage: req.query?.stage, min_score: req.query?.min_score, limit: req.query?.limit }, scope);
      res.json({ ok: true, leads: maskLeadListContact(leads, req.platformAdmin) });
    } catch (e) {
      console.error('[sales] list leads', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 记录级归属校验：查不到 或 无权限 统一返回404，不用403——避免通过状态码差异
  // 就能判断出"这个ID存在但我无权看"，变相把线索ID是否存在这件事泄露出去。
  app.get('/api/admin/sales/leads/:id', platformAdminRequired, sensitiveRateLimit('lead_detail'), async (req, res) => {
    try {
      const data = await getLeadDetail(pool, Number(req.params.id));
      if (!data.ok) return res.status(404).json(data);
      if (!canAccessLead(req.platformAdmin, data.lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      data.lead = maskLeadContact(data.lead, req.platformAdmin);
      res.status(200).json(data);
    } catch (e) {
      console.error('[sales] lead detail', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 签约价格/账期——由销售在首次签约时录入一次，之后基本不变；只有总经理/财务/超级管理员
  // 能读写。这是账单PDF自动生成金额和账期的唯一权威来源(见 tenant-platform-routes.js)。
  app.get('/api/admin/sales/leads/:id/contract-price', platformAdminRequired, contractPriceGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({
        ok: true,
        contract_price_fen: lead.contract_price_fen ?? null,
        contract_billing_cycle: lead.contract_billing_cycle || null,
        contract_billing_day: lead.contract_billing_day ?? null,
        contract_price_note: lead.contract_price_note || '',
        contract_price_set_by: lead.contract_price_set_by || null,
        contract_price_set_at: lead.contract_price_set_at || null,
      });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/contract-price', platformAdminRequired, contractPriceGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      // 跟订单金额(sales_orders.amount_fen)同样的约定：前端表单填元，这里统一转成分存库。
      const priceFen = Math.round(Number(req.body?.contract_price || 0) * 100);
      const cycle = String(req.body?.contract_billing_cycle || '').trim();
      const day = Number(req.body?.contract_billing_day);
      if (priceFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_price', message: '签约价格必须大于0' });
      if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) return res.status(400).json({ ok: false, error: 'invalid_cycle', message: '账期只能是monthly/quarterly/yearly' });
      if (!Number.isInteger(day) || day < 1 || day > 28) return res.status(400).json({ ok: false, error: 'invalid_billing_day', message: '扣款/开票日必须是1-28之间的整数' });
      const r = await pool.query(
        `UPDATE sales_leads SET contract_price_fen=$2, contract_billing_cycle=$3, contract_billing_day=$4,
           contract_price_note=$5, contract_price_set_by=$6, contract_price_set_at=NOW()
         WHERE id=$1 RETURNING contract_price_fen, contract_billing_cycle, contract_billing_day, contract_price_note, contract_price_set_by, contract_price_set_at`,
        [lead.id, priceFen, cycle, day, String(req.body?.contract_price_note || '').trim() || null, req.platformAdmin.username]
      );
      res.json({ ok: true, ...r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  // 受控查看完整联系方式：列表/详情接口默认脱敏，需要真实拨打电话时走这个接口，
  // 必须带业务原因；POST请求会被 platformAdminRequired 中间件自动写入
  // platform_admin_audit_log(admin_username/path/target_tenant_id/detail/ip)，不用另建审计表。
  app.post('/api/admin/sales/leads/:id/reveal-contact', platformAdminRequired, sensitiveRateLimit('reveal_contact'), async (req, res) => {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
      const leadId = Number(req.params.id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!canViewFullContact(req.platformAdmin, lead)) return res.status(403).json({ ok: false, error: 'forbidden' });
      res.json({ ok: true, phone: lead.phone || null, legal_contact_phone: lead.legal_contact_phone || null });
    } catch (e) {
      console.error('[sales] reveal contact', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 统一客户时间线：售前(线索事件/阶段/对话) + 售后(已开通租户的健康度事件)，
  // 销售/客户成功接手时不用再让客户重复一遍已经聊过的信息
  app.get('/api/admin/sales/leads/:id/timeline', platformAdminRequired, sensitiveRateLimit('lead_timeline'), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getUnifiedCustomerTimeline(pool, leadId);
      res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      console.error('[sales] unified timeline', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 供 agents-service-v2 的"首月每周运行检测报告"调用，用同一套内部密钥口径
  // (X-Miniprogram-Sync-Secret)，不复用 platformAdminRequired(那是面向后台管理员会话的)。
  app.post('/api/internal/sales/tenant-onboarding-checklist', async (req, res) => {
    try {
      const secret = String(req.headers['x-miniprogram-sync-secret'] || '');
      const expected = String(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '');
      if (!expected || secret !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const data = await getOnboardingChecklist(pool, req.body?.tenant_id);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error('[sales] internal onboarding checklist', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 客户上线进度清单：新开通租户是否具备"数据条件+基础配置"就绪，复用已有巡检信号
  app.get('/api/admin/sales/tenants/:tenantId/onboarding', platformAdminRequired, sensitiveRateLimit('tenant_onboarding'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getOnboardingChecklist(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error('[sales] onboarding checklist', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 单租户续费健康度：透明加减分，续费风险/转介绍候选列表都是基于这个分数派生的
  app.get('/api/admin/sales/tenants/:tenantId/renewal-health', platformAdminRequired, sensitiveRateLimit('tenant_renewal_health'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await computeRenewalHealth(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error('[sales] renewal health', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 续费风险清单：分数<60或授权14天内到期的租户，按风险从高到低排；非manager只看自己范围内的租户
  app.get('/api/admin/sales/renewal-risks', platformAdminRequired, sensitiveRateLimit('renewal_risks'), async (req, res) => {
    try {
      const all = await listRenewalRisks(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      console.error('[sales] renewal risks', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 转介绍候选：稳定使用满60天、健康分≥80、无逾期异常的客户；非manager只看自己范围内的租户
  app.get('/api/admin/sales/referral-candidates', platformAdminRequired, sensitiveRateLimit('referral_candidates'), async (req, res) => {
    try {
      const all = await listReferralCandidates(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      console.error('[sales] referral candidates', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 月度客户价值报告：证明续费理由，供销售/客户成功在续费沟通前查看或发送给客户
  app.get('/api/admin/sales/tenants/:tenantId/value-report', platformAdminRequired, sensitiveRateLimit('tenant_value_report'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await buildTenantMonthlyValueReport(pool, req.params.tenantId, { month: req.query.month });
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error('[sales] tenant value report', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 客户档案手动编辑：之前公司/电话等字段只能靠客户AI从聊天里提取，销售没有任何
  // 手动修正/补录的入口。这里只开放"客户档案"类字段(基础信息+营业执照/开票/联系人)，
  // 不允许通过这个接口改stage/controller/intent_score这些由AI/销售流程自动维护的字段。
  const LEAD_DOSSIER_FIELDS = [
    'name', 'company', 'phone', 'city', 'region_code', 'region_name', 'cuisine', 'store_count', 'pos_brand',
    'customer_brands', 'customer_cities', 'customer_contacts', 'requested_payment_type', 'requested_credit_days', 'requested_credit_limit_fen',
    'legal_company_name', 'unified_credit_code', 'registered_address', 'company_size', 'website',
    'invoice_title', 'invoice_tax_no', 'invoice_bank_name', 'invoice_bank_account',
    'legal_contact_name', 'legal_contact_title', 'legal_contact_phone',
  ];
  app.put('/api/admin/sales/leads/:id/dossier', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const body = req.body || {};
      const fields = Object.keys(body).filter((k) => LEAD_DOSSIER_FIELDS.includes(k));
      if (!fields.length) return res.status(400).json({ ok: false, error: 'no_valid_fields' });
      const jsonFields = new Set(['customer_brands', 'customer_cities', 'customer_contacts']);
      if (fields.includes('customer_brands')) {
        const brands = Array.isArray(body.customer_brands) ? body.customer_brands : JSON.parse(String(body.customer_brands || '[]'));
        if (!Array.isArray(brands) || brands.some((item) => !String(item?.brand_name || '').trim() || !String(item?.city || '').trim() || !(Number(item?.store_count) > 0))) {
          return res.status(400).json({ ok: false, error: 'customer_brands_invalid', message: '每个品牌都需要填写品牌名称、城市和门店数量' });
        }
        const cities = [...new Set(brands.map((item) => String(item.city).trim()))];
        body.customer_brands = brands.map((item) => ({ brand_name: String(item.brand_name).trim(), city: String(item.city).trim(), store_count: Number(item.store_count) }));
        body.customer_cities = cities;
        body.city = cities.join('、');
        body.store_count = brands.reduce((total, item) => total + Number(item.store_count), 0);
        body.pos_brand = [...new Set(brands.map((item) => String(item.brand_name).trim()))].join('、');
        for (const derivedField of ['customer_cities', 'city', 'store_count', 'pos_brand']) if (!fields.includes(derivedField)) fields.push(derivedField);
      }
      if (fields.includes('customer_contacts')) {
        const contacts = Array.isArray(body.customer_contacts) ? body.customer_contacts : JSON.parse(String(body.customer_contacts || '[]'));
        if (!Array.isArray(contacts) || contacts.some((item) => !String(item?.name || '').trim() || !String(item?.title || '').trim() || !String(item?.phone || '').trim())) {
          return res.status(400).json({ ok: false, error: 'customer_contacts_invalid', message: '每位联系人都需要填写姓名、职位和电话' });
        }
        body.customer_contacts = contacts.map((item) => ({ name: String(item.name).trim(), title: String(item.title).trim(), phone: String(item.phone).trim() }));
        const primary = body.customer_contacts[0];
        body.name = primary.name; body.phone = primary.phone;
        body.legal_contact_name = primary.name; body.legal_contact_title = primary.title; body.legal_contact_phone = primary.phone;
        for (const derivedField of ['name', 'phone', 'legal_contact_name', 'legal_contact_title', 'legal_contact_phone']) if (!fields.includes(derivedField)) fields.push(derivedField);
      }
      const values = fields.map((field) => {
        const value = body[field];
        if (!jsonFields.has(field)) return value === '' ? null : value;
        if (Array.isArray(value)) return JSON.stringify(value);
        try {
          const parsed = JSON.parse(String(value || '[]'));
          if (!Array.isArray(parsed)) throw new Error('not_array');
          return JSON.stringify(parsed);
        } catch {
          throw Object.assign(new Error(`${field}_invalid`), { statusCode: 400 });
        }
      });
      const typedSetClauses = fields.map((f, i) => `${f} = $${i + 2}${jsonFields.has(f) ? '::jsonb' : ''}`);
      const r = await pool.query(
        `UPDATE sales_leads SET ${typedSetClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [leadId, ...values]
      );
      if (!r.rows?.[0]) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, lead: r.rows[0] });
    } catch (e) {
      res.status(e?.statusCode || 500).json({ ok: false, error: e?.message || 'server_error', message: e?.statusCode ? '档案中的品牌或联系人格式不正确' : e?.message });
    }
  });

  app.get('/api/admin/sales/leads/:id/summary', platformAdminRequired, async (req, res) => {
    try {
      const data = await getLeadDetail(pool, Number(req.params.id));
      if (!data.ok) return res.status(404).json(data);
      res.json({ ok: true, summary: buildLeadSummary(data.lead, data.lead.last_sales_decision || {}) });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/assign', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const username = String(req.body?.username || '').trim();
      if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });
      const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const due = calculateSla(lead.handoff_level || lead.intent_level);
      await pool.query(`UPDATE sales_leads SET assigned_to=$2, assigned_at=NOW(), sla_due_at=$3::timestamptz, sla_status=CASE WHEN $3::timestamptz IS NULL THEN 'not_required' ELSE 'open' END, updated_at=NOW() WHERE id=$1`, [leadId, username, due]);
      res.json({ ok: true, lead_id: leadId, assigned_to: username, sla_due_at: due });
    } catch (e) { console.error('[sales] assign lead failed:', e?.message || e); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/stage', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const toStage = String(req.body?.stage || '').trim();
      const t = await transitionLeadStage(pool, {
        leadId, toStage, actorType: 'human', actorId: req.platformAdmin?.username || 'sales',
        reason: req.body?.reason || 'manual_stage_change', sourceType: 'manual', sourceId: 'stage_route', metadata: req.body?.evidence || {},
      });
      if (!t.ok) {
        const status = t.error === 'lead_not_found' ? 404 : 400;
        return res.status(status).json({ ok: false, error: t.error, from_stage: t.from_stage, to_stage: t.to_stage });
      }
      res.json({ ok: true, lead_id: leadId, from_stage: t.from_stage, to_stage: t.to_stage, changed: t.changed });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/actions', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const actionType = String(req.body?.action_type || '').trim();
      const allowed = ['send_case', 'send_demo', 'create_task', 'schedule_meeting', 'pause', 'transfer'];
      if (!allowed.includes(actionType)) return res.status(400).json({ ok: false, error: 'unsupported_action' });
      const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      let result = null;
      if (actionType === 'create_task') {
        result = await upsertTask(pool, { leadId, title: String(req.body?.title || '销售跟进'), detail: req.body?.detail, dueAt: req.body?.due_at || null, assignee: req.body?.assignee || lead.assigned_to });
      } else if (actionType === 'schedule_meeting') {
        const { createMeeting } = await import('./services/sales/sales-store.js');
        result = await createMeeting(pool, { leadId, meetingType: req.body?.meeting_type || 'demo', occurredAt: req.body?.occurred_at, rawNotes: req.body?.notes, createdBy: req.platformAdmin?.username });
      } else if (actionType === 'send_case' || actionType === 'send_demo') {
        const text = actionType === 'send_demo' ? String(req.body?.text || '您好，我为您安排一次针对门店情况的系统演示，请回复方便的时间。') : String(req.body?.text || '我先发您一份相关案例，您可以重点看客户分层、触达和回店归因部分。');
        await pool.query(`INSERT INTO sales_messages (conversation_id, lead_id, direction, sender, content, meta) SELECT id, $1, 'outbound', 'human', $2, $3::jsonb FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId, text, JSON.stringify({ action: actionType })]);
        let sendStatus = 'wecom_not_configured';
        if (kfConfigured() && lead.open_kfid && lead.external_userid) {
          const { sendKfText } = await import('./services/sales/sales-kf.js');
          await sendKfText({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, content: text });
          sendStatus = 'sent';
        }
        result = { text, send_status: sendStatus };
      } else if (actionType === 'pause') {
        const t = await transitionLeadStage(pool, { leadId, toStage: 'paused', actorType: 'human', actorId: req.platformAdmin?.username || 'sales_ops', reason: 'manual_pause', sourceType: 'sales_action', sourceId: 'pause' });
        if (!t.ok) return res.status(409).json({ ok: false, error: t.error, from_stage: t.from_stage, to_stage: t.to_stage });
        result = { stage: 'paused' };
      } else if (actionType === 'transfer') {
        const username = String(req.body?.username || '').trim(); if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });
        await pool.query(`UPDATE sales_leads SET assigned_to=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$1`, [leadId, username]); result = { assigned_to: username };
      }
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, asset_key, payload, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)`, [leadId, actionType, req.body?.asset_key || null, JSON.stringify(result || req.body || {}), req.platformAdmin?.username || 'sales']);
      res.json({ ok: true, action_type: actionType, result });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/consultant-invite', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const qr = String(req.body?.qr_url || process.env.WECOM_SALES_CONSULTANT_QR_URL || '').trim();
      if (!qr) return res.status(409).json({ ok: false, error: 'consultant_qr_not_configured', message: '请先配置销售顾问企业微信二维码' });
      let sent = false;
      let text = `为了方便发送Demo资料和后续跟进，请添加专属顾问：${qr}`;
      if (kfConfigured() && lead.open_kfid && lead.external_userid) {
        const { sendKfConsultantCard } = await import('./services/sales/sales-kf.js');
        const cardResult = await sendKfConsultantCard({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, consultantName: req.body?.consultant_name, qrUrl: qr });
        sent = !!cardResult.ok;
        if (cardResult.content) text = cardResult.content;
      }
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, payload, created_by) VALUES ($1,'consultant_invite',$2::jsonb,$3)`, [leadId, JSON.stringify({ qr_url: qr, sent, text }), req.platformAdmin?.username || 'sales']);
      res.json({ ok: true, sent, text, qr_url: qr, reason: sent ? null : 'wecom_not_configured' });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/sandbox/chat', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const externalUserid = String(req.body?.external_userid || req.body?.session_key || '').trim() || `sandbox_${req.user?.username || 'admin'}`;
      const welcome = !!req.body?.welcome;
      const inputMode = req.body?.input_mode === 'voice' ? 'voice' : 'text';
      const data = await handleInboundMessage(pool, { text: welcome && !text ? '' : text, openKfid: 'sandbox', externalUserid, sourceChannel: 'sandbox', welcome, inputMode });
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

  app.get('/api/admin/sales/todo', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, todos: buildSalesTodoList(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/risks', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, risks: buildRiskCustomers(leads), tomorrow_actions: buildTomorrowActions(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/top5', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
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

  app.get('/api/admin/sales/funnel', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 500 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, funnel: buildFunnelStats(leads), count: leads.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/demos', platformAdminRequired, async (req, res) => {
    try {
      const { createDemo } = await import('./services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const demo = await createDemo(pool, {
        leadId,
        scheduledAt: req.body?.scheduled_at,
        attendedBy: req.body?.attended_by,
        summary: req.body?.summary,
        keyPoints: req.body?.key_points,
        objections: req.body?.objections,
        nextSteps: req.body?.next_steps,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, demo });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/meetings', platformAdminRequired, async (req, res) => {
    try {
      const { createMeeting } = await import('./services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      let summary = null;
      if (req.body?.raw_notes) {
        const s = summarizeMeeting(req.body.raw_notes);
        summary = JSON.stringify(s);
      }
      const meeting = await createMeeting(pool, {
        leadId,
        meetingType: req.body?.meeting_type || 'meeting',
        occurredAt: req.body?.occurred_at,
        rawNotes: req.body?.raw_notes,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, meeting, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/trials', platformAdminRequired, async (req, res) => {
    try {
      const { createTrial } = await import('./services/sales/sales-store.js');
      const { evaluateTrialEligibility } = await import('./services/sales/trial-eligibility-service.js');
      const leadId = Number(req.params?.id || req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const eligibility = await evaluateTrialEligibility(pool, lead);
      const isManagerOrAbove = ['super_admin', 'general_manager', 'sales_manager'].includes(req.platformAdmin?.role);
      if (eligibility.verdict === 'unfit' && !(req.body?.override_ineligible === true && isManagerOrAbove)) {
        return res.status(422).json({ ok: false, error: 'trial_not_eligible', eligibility });
      }
      if (eligibility.verdict === 'conditional' && !isManagerOrAbove) {
        return res.status(403).json({ ok: false, error: 'trial_conditional_requires_manager_confirm', eligibility });
      }
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
      const leadForDeal = await getLead(pool, leadId);
      if (!leadForDeal || !canAccessLead(req.platformAdmin, leadForDeal)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (req.body?.provision_tenant !== false) {
        if (req.platformAdmin?.role !== 'super_admin') return res.status(403).json({ ok: false, error: 'provision_requires_super_admin' });
        const effectiveContract = await pool.query(`SELECT 1 FROM sales_contracts WHERE lead_id=$1 AND status='effective' LIMIT 1`, [leadId]);
        if (!effectiveContract.rows?.[0]) return res.status(409).json({ ok: false, error: 'effective_contract_required' });
        const creditRisk = await getCreditRisk(pool, leadId);
        if (!creditRisk.can_provision) return res.status(409).json({ ok: false, error: creditRisk.payment_type === 'cash' ? 'confirmed_payment_required' : 'credit_limit_exceeded_or_not_authorized', credit_risk: creditRisk });
      }
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
      const { generateCommissionForDeal } = await import('./services/sales/sales-commission-service.js');
      const commission = await generateCommissionForDeal(pool, deal.id).catch((e) => ({ ok: false, error: e?.message }));
      res.json({ ok: true, deal, provision, commission });
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

  // 开租户"部分成功"补偿队列：核心租户已建好，但收尾步骤(onboarding/客户桥接/关联表回写)
  // 还没完成的记录，供人工确认后重试(重试走同一个provision-tenant接口，不会重复建租户)
  app.get('/api/admin/sales/provisioning/pending-compensations', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const items = await listPendingProvisioningCompensations(pool, { limit: Number(req.query.limit) || 50 });
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
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

  // 30天试跑第几天/剩几天 + 建档时约定的KPI目标 vs 实际值，validate接口只判断"有没有数据"，
  // 这个接口回答"离目标还差多少"
  app.get('/api/admin/sales/trials/:id/progress', platformAdminRequired, sensitiveRateLimit('trial_progress'), async (req, res) => {
    try {
      const trialId = Number(req.params.id);
      const tr = await pool.query(`SELECT lead_id FROM sales_trials WHERE id=$1`, [trialId]);
      const leadId = tr.rows?.[0]?.lead_id;
      if (!leadId) return res.status(404).json({ ok: false, error: 'not_found' });
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await buildTrialProgressSummary(pool, trialId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      console.error('[sales] trial progress', e?.message || e);
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
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const reasonKey = String(req.body?.reason_key || '').trim();
      const detail = String(req.body?.detail || '').trim();
      const budgetStatus = String(req.body?.budget_status || '').trim();
      const currentSystem = String(req.body?.current_system || '').trim();
      const enterNurture = req.body?.enter_nurture === true;
      const recontactAt = req.body?.recontact_at || null;
      if (!reasonKey || detail.length < 10 || !budgetStatus || !currentSystem || (enterNurture && !recontactAt)) {
        return res.status(400).json({ ok: false, error: 'loss_review_incomplete', message: '请完整填写最大原因、具体细节、预算情况、当前系统；进入培育时必须填写再次联系时间' });
      }
      const loss = await recordLossReason(pool, {
        leadId,
        reasonKey,
        reasonLabel: req.body?.reason_label,
        detail,
        evidence: req.body?.evidence,
        competitor: req.body?.competitor,
        budgetStatus,
        currentSystem,
        recontactAt,
        enterNurture,
        createdBy: req.platformAdmin?.username,
      });
      if (enterNurture) {
        await pool.query(`UPDATE sales_leads SET controller='ai',auto_nurture_enabled=true,auto_nurture_paused_at=NULL,updated_at=NOW() WHERE id=$1`, [leadId]);
        await pool.query(`UPDATE sales_conversations SET controller='ai',updated_at=NOW() WHERE lead_id=$1 AND status='open'`, [leadId]);
      }
      res.json({ ok: true, loss });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/objections', platformAdminRequired, async (req, res) => {
    try {
      const { recordObjection } = await import('./services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const obj = await recordObjection(pool, {
        leadId,
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

  app.get('/api/admin/sales/regions', platformAdminRequired, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sales_regions WHERE active=true ORDER BY sort_order,region_name`);
      res.json({ ok: true, regions: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/regions', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const code = String(req.body?.region_code || '').trim();
      const name = String(req.body?.region_name || '').trim();
      if (!code || !name || !/^[A-Za-z0-9_-]{1,40}$/.test(code)) return res.status(400).json({ ok: false, error: 'invalid_region' });
      const r = await pool.query(
        `INSERT INTO sales_regions (region_code,region_name,active) VALUES ($1,$2,true)
         ON CONFLICT (region_code) DO UPDATE SET region_name=EXCLUDED.region_name,active=true,updated_at=NOW() RETURNING *`,
        [code, name]
      );
      res.json({ ok: true, region: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/reps', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const rep = await createOrUpdateSalesRep(pool, {
        repKey: req.body?.rep_key,
        displayName: req.body?.display_name,
        role: req.body?.role,
        status: req.body?.status,
        hireDate: req.body?.hire_date,
        wecomName: req.body?.wecom_name,
        wecomQrAssetId: req.body?.wecom_qr_asset_id ? Number(req.body.wecom_qr_asset_id) : null,
        regionCode: req.body?.region_code,
        regionName: req.body?.region_name,
      });
      res.json({ ok: true, rep });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/performance/by-region', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'manager_required' });
      const scope = leadScopeSql(req.platformAdmin, 1);
      const r = await pool.query(
        `WITH scoped AS (
           SELECT l.id,l.stage,
                  COALESCE(l.region_code,rep.region_code,'unassigned') AS region_code,
                  COALESCE(l.region_name,rep.region_name,'未分区域') AS region_name,
                  COALESCE((SELECT SUM(c.amount_fen) FROM sales_contracts c WHERE c.lead_id=l.id AND c.status='effective'),0) AS contract_fen,
                  COALESCE((SELECT SUM(p.amount_fen) FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id WHERE c.lead_id=l.id AND p.status='confirmed'),0) AS paid_fen
             FROM sales_leads l
             LEFT JOIN sales_reps rep ON rep.rep_key=COALESCE(l.assigned_to,l.owner_username)
            WHERE ${scope.clause}
         )
         SELECT region_code,MAX(region_name) AS region_name,COUNT(*)::int AS lead_count,
                COUNT(*) FILTER (WHERE stage='won')::int AS won_count,
                COALESCE(SUM(contract_fen),0)::bigint AS contract_fen,
                COALESCE(SUM(paid_fen),0)::bigint AS paid_fen
           FROM scoped GROUP BY region_code ORDER BY paid_fen DESC,lead_count DESC`,
        scope.params
      );
      res.json({ ok: true, regions: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
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
      const repRow = await pool.query(`SELECT rep_key FROM sales_reps WHERE id=$1 LIMIT 1`, [Number(req.params.id)]);
      if (!canAccessRepMetrics(req.platformAdmin, repRow.rows?.[0]?.rep_key)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getRepScorecard(pool, Number(req.params.id), req.query?.period_type, req.query?.period_key);
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/kpi-targets', platformAdminRequired, managerGate, async (req, res) => {
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

  app.post('/api/admin/sales/kpi-scores', platformAdminRequired, managerGate, async (req, res) => {
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

  // ── 客户拜访记录 ──
  app.post('/api/admin/sales/leads/:id/visits', platformAdminRequired, async (req, res) => {
    try {
      const { recordVisit } = await import('./services/sales/sales-visits-service.js');
      const visit = await recordVisit(pool, {
        leadId: Number(req.params.id),
        repId: req.body?.rep_id ? Number(req.body.rep_id) : null,
        visitType: req.body?.visit_type,
        occurredAt: req.body?.occurred_at,
        notes: req.body?.notes,
        nextFollowupAt: req.body?.next_followup_at,
        nextFollowupPlan: req.body?.next_followup_plan,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, visit });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/leads/:id/visits', platformAdminRequired, async (req, res) => {
    try {
      const { listVisitsForLead } = await import('./services/sales/sales-visits-service.js');
      const visits = await listVisitsForLead(pool, Number(req.params.id));
      res.json({ ok: true, visits });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // ── 销售提成 ──
  app.post('/api/admin/sales/commission-rules', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const { setCommissionRule } = await import('./services/sales/sales-commission-service.js');
      const rule = await setCommissionRule(pool, {
        repId: req.body?.rep_id ? Number(req.body.rep_id) : null,
        ratePercent: Number(req.body?.rate_percent),
        effectiveFrom: req.body?.effective_from,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, rule });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // rep_id 之前完全信任客户端传参，普通销售改个数字就能看到别人的提成——非manager一律
  // 强制用自己的rep_id覆盖请求参数，不管前端传了什么。
  app.get('/api/admin/sales/commissions', platformAdminRequired, sensitiveRateLimit('commissions'), async (req, res) => {
    try {
      const { listCommissions } = await import('./services/sales/sales-commission-service.js');
      let repId = req.query?.rep_id ? Number(req.query.rep_id) : null;
      if (!isManager(req.platformAdmin)) {
        const own = await pool.query(`SELECT id FROM sales_reps WHERE rep_key=$1 LIMIT 1`, [req.platformAdmin?.username]);
        repId = own.rows?.[0]?.id || -1; // 查不到自己的rep记录就传个不存在的id，返回空列表而不是报错
      }
      const commissions = await listCommissions(pool, { repId, status: req.query?.status });
      res.json({ ok: true, commissions });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/commissions/:id/status', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const { updateCommissionStatus } = await import('./services/sales/sales-commission-service.js');
      const commission = await updateCommissionStatus(pool, Number(req.params.id), {
        status: req.body?.status,
        approvedBy: req.platformAdmin?.username,
      });
      if (!commission) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, commission });
    } catch (e) {
      res.status(400).json({ ok: false, error: e?.message || 'invalid_request' });
    }
  });
}
