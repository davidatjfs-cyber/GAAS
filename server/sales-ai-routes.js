/**
 * 销售 AI 路由：沙盒试聊 + 线索工作台 + 微信客服回调
 */
import { ensureSalesTables, listLeads } from './services/sales/sales-store.js';
import {
  handleInboundMessage,
  takeoverConversation,
  releaseToAi,
  getLeadDetail,
  setSalesNotify,
} from './services/sales/sales-session.js';
import { buildBossDailyReport } from './services/sales/sales-ops.js';
import { setSalesCustomerAiLlm } from './services/sales/sales-customer-ai.js';
import { draftCustomerReply, setSalesReplyDraftLlm } from './services/sales/sales-reply-draft.js';
import {
  kfConfigured,
  kfEnv,
  verifyKfSignature,
  decryptKfEcho,
  decryptKfMessage,
  processKfCallbackEvent,
} from './services/sales/sales-kf.js';
import { SALES_PERSONA, PUBLIC_KNOWLEDGE, FORBIDDEN_CLAIMS } from './services/sales/sales-knowledge.js';

// 超时未跟进：高意向线索若2小时内无人工接管/回复，且4小时内未提醒过，则再次提醒（避免轰炸）。
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

export function registerSalesAiRoutes(app, pool, platformAdminRequired, { callLLM, sendOpsAlert } = {}) {
  if (typeof callLLM === 'function') setSalesCustomerAiLlm(callLLM);
  if (typeof callLLM === 'function') setSalesReplyDraftLlm(callLLM);
  if (typeof sendOpsAlert === 'function') setSalesNotify(sendOpsAlert);

  // 任务1：每30分钟检查一次高意向未接管线索，超时未跟进则再次提醒（去重：4小时内不重复提醒同一线索）
  if (!globalThis.__salesStaleLeadReminderTimer) {
    globalThis.__salesStaleLeadReminderTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => remindStaleHighIntentLeads(pool, sendOpsAlert))
        .catch((e) => console.warn('[sales-ai] stale lead reminder run failed:', e?.message || e));
    }, 30 * 60 * 1000);
  }

  // 任务2：每日09:00自动生成并推送老板日报（复用 /daily-report/send 同样的逻辑）
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

  // 任务3：每5分钟主动补偿同步一次微信客服消息，防止回调因网络/重启丢失导致漏消息
  if (!globalThis.__salesKfSyncTimer) {
    globalThis.__salesKfSyncTimer = setInterval(() => {
      if (!kfConfigured()) return;
      const env = kfEnv();
      processKfCallbackEvent(pool, { token: '', openKfid: env.openKfid }, (payload) => handleInboundMessage(pool, payload))
        .catch((e) => console.warn('[sales-ai] kf compensating sync failed:', e?.message || e));
    }, 5 * 60 * 1000);
  }

  // —— 公开：微信客服回调（无需平台登录）——
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
    // 企微要求尽快回成功；处理异步化
    res.send('success');
    try {
      if (!kfConfigured()) {
        console.warn('[sales-kf] callback received but KF not configured');
        return;
      }
      const env = kfEnv();
      let token = '';
      let openKfid = env.openKfid;
      // 简化：若 body 含 encrypt，解密取 token；否则读 query/body.token
      const encrypt = req.body?.Encrypt || req.body?.encrypt;
      if (encrypt && env.aesKey) {
        try {
          const plain = decryptKfMessage(String(encrypt), env.aesKey);
          // plain 可能是 XML；粗提取 Token / OpenKfId
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

  // —— 平台管理员 ——
  app.get('/api/admin/sales/meta', platformAdminRequired, (_req, res) => {
    res.json({
      ok: true,
      persona: SALES_PERSONA,
      knowledge: PUBLIC_KNOWLEDGE,
      forbidden_claims: FORBIDDEN_CLAIMS,
      kf_configured: kfConfigured(),
      open_kfid: kfEnv().openKfid || null,
    });
  });

  app.get('/api/admin/sales/leads', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, {
        stage: req.query?.stage,
        min_score: req.query?.min_score,
        limit: req.query?.limit,
      });
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
      const data = await handleInboundMessage(pool, {
        text: welcome && !text ? '' : text,
        openKfid: 'sandbox',
        externalUserid,
        sourceChannel: 'sandbox',
        welcome,
      });
      res.json(data);
    } catch (e) {
      console.error('[sales] sandbox chat', e?.message || e);
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/takeover', platformAdminRequired, async (req, res) => {
    try {
      const data = await takeoverConversation(pool, Number(req.params.id), {
        ownerUsername: req.user?.username || req.body?.owner_username,
      });
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
      const { addMessage } = await import('./services/sales/sales-store.js');
      await addMessage(pool, {
        conversationId: detail.conversation.id,
        leadId: detail.lead.id,
        direction: 'outbound',
        sender: 'human',
        content: text,
      });
      // 若已配置 KF 且非 sandbox，尝试外发
      if (detail.lead.open_kfid && detail.lead.open_kfid !== 'sandbox' && detail.lead.external_userid && kfConfigured()) {
        try {
          const { sendKfText } = await import('./services/sales/sales-kf.js');
          await sendKfText({
            openKfid: detail.lead.open_kfid,
            externalUserid: detail.lead.external_userid,
            content: text,
          });
        } catch (e) {
          return res.json({ ok: true, saved: true, send_error: e?.message || String(e) });
        }
      }
      res.json({ ok: true, saved: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/draft-reply', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const draft = await draftCustomerReply({
        lead: detail.lead,
        messages: detail.messages,
        advice: detail.advice,
      });
      if (!draft.ok) return res.json({ ok: false, error: draft.error, message: '暂无法生成草稿，请手动编写' });
      res.json({ ok: true, text: draft.text });
    } catch (e) {
      console.error('[sales] draft reply', e?.message || e);
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
      if (typeof sendOpsAlert === 'function') {
        await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
      }
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
