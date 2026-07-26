/**
 * BI weekly/monthly report Feishu delivery (P2 peel from agents.js).
 */
import {
  feishuStoreManagersForMonthlyReportBody,
  getReportStoresForBiReportsBody,
  splitMarkdownForCard,
  uniqBiReportRecipients,
} from './send-period-reports-helpers.js';

export { splitMarkdownForCard, uniqBiReportRecipients };

/**
 * @param {object} deps
 */
export function createSendPeriodReportsApi(deps) {
  const {
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    generateWeeklyReport,
    generateMonthlyReport,
    formatReportMarkdown,
    calendarLastCompletedWeekMonSunShanghai,
    calendarPreviousMonthRangeShanghai,
    log,
  } = deps;

  async function sendBiReportToAdmins({ admins, title, note, md, cardTemplate = 'blue' }) {
    const chunks = splitMarkdownForCard(md, 3600);
    for (const a of admins) {
      const fu = await lookupFeishuUserByUsername(a.username);
      if (!fu?.open_id) continue;
      for (let i = 0; i < chunks.length; i += 1) {
        const card = {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title },
            template: cardTemplate
          },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: chunks[i] } },
            { tag: 'note', elements: [{ tag: 'plain_text', content: note }] }
          ]
        };
        const s = await sendLarkCard(fu.open_id, card);
        if (!s.ok) {
          await sendLarkMessage(fu.open_id, prefixWithAgentName('data_auditor', chunks[i].slice(0, 3000)));
        }
      }
    }
  }

  async function sendWeeklyReports(tenantId = 'default') {
    log.info(`[bi-report] generating weekly reports (tenant=${tenantId})...`);
    const { wsS, weS } = calendarLastCompletedWeekMonSunShanghai();
    const state = await getSharedState(tenantId);
    const adminsRaw = [...(state?.employees || []), ...(state?.users || [])].filter(u => ['admin', 'hq_manager'].includes(u?.role));
    const admins = uniqBiReportRecipients(adminsRaw);
    const stores = await getReportStoresForBiReportsBody(deps, tenantId);
    for (const store of stores) {
      try {
        const r = await generateWeeklyReport(store, wsS, weS);
        const md = formatReportMarkdown(r);
        await sendBiReportToAdmins({
          admins,
          title: `📊 ${store} 周报`,
          note: `小年·BI周报·${wsS}~${weS}`,
          md,
          cardTemplate: 'blue'
        });
        log.info(`[bi-report] sent ${store} report to ${admins.length} admins`);
      } catch (e) { log.error(`[bi-report] ${store} failed:`, e?.message); }
    }
  }

  async function sendMonthlyReports(tenantId = 'default') {
    log.info(`[bi-report] generating monthly reports (tenant=${tenantId})...`);
    const { msS, meS } = calendarPreviousMonthRangeShanghai();
    const state = await getSharedState(tenantId);
    const adminsRaw2 = [...(state?.employees || []), ...(state?.users || [])].filter(u => ['admin', 'hq_manager'].includes(u?.role));
    const baseRecipients = uniqBiReportRecipients(adminsRaw2);
    const stores = await getReportStoresForBiReportsBody(deps, tenantId);
    for (const store of stores) {
      try {
        const r = await generateMonthlyReport(store, msS, meS);
        const md = formatReportMarkdown(r);
        const managers = await feishuStoreManagersForMonthlyReportBody(deps, store);
        const admins = uniqBiReportRecipients([...baseRecipients, ...managers]);
        await sendBiReportToAdmins({
          admins,
          title: `📈 ${store} 月报`,
          note: `小年·BI月报·${msS}~${meS}`,
          md,
          cardTemplate: 'turquoise'
        });
        log.info(`[bi-report] sent ${store} monthly report to ${admins.length} recipients (admin/hq + store managers)`);
      } catch (e) { log.error(`[bi-report] ${store} monthly failed:`, e?.message); }
    }
  }

  async function sendTestReportsToUser(targetUsername, tenantId = 'default') {
    log.info('[bi-report] test send to user:', targetUsername);
    const fu = await lookupFeishuUserByUsername(targetUsername);
    if (!fu?.open_id) {
      log.error('[bi-report] user not found or not bound to Feishu:', targetUsername);
      return { ok: false, error: 'user_not_found_or_not_bound', username: targetUsername };
    }
    const testAdmins = [{ username: targetUsername }];
    const results = [];

    const { wsS, weS } = calendarLastCompletedWeekMonSunShanghai();
    const stores = await getReportStoresForBiReportsBody(deps, tenantId);
    for (const store of stores) {
      try {
        const r = await generateWeeklyReport(store, wsS, weS);
        const md = formatReportMarkdown(r);
        await sendBiReportToAdmins({ admins: testAdmins, title: `📊 ${store} 周报`, note: `小年·BI周报·${wsS}~${weS}`, md, cardTemplate: 'blue' });
        results.push({ type: 'weekly', store, ok: true });
        log.info(`[bi-report] test weekly sent: ${store} → ${targetUsername}`);
      } catch (e) {
        results.push({ type: 'weekly', store, ok: false, error: e?.message });
        log.error(`[bi-report] test weekly failed: ${store}`, e?.message);
      }
    }

    const { msS, meS } = calendarPreviousMonthRangeShanghai();
    for (const store of stores) {
      try {
        const r = await generateMonthlyReport(store, msS, meS);
        const md = formatReportMarkdown(r);
        await sendBiReportToAdmins({ admins: testAdmins, title: `📈 ${store} 月报`, note: `小年·BI月报·${msS}~${meS}`, md, cardTemplate: 'turquoise' });
        results.push({ type: 'monthly', store, ok: true });
        log.info(`[bi-report] test monthly sent: ${store} → ${targetUsername}`);
      } catch (e) {
        results.push({ type: 'monthly', store, ok: false, error: e?.message });
        log.error(`[bi-report] test monthly failed: ${store}`, e?.message);
      }
    }

    return { ok: true, results, targetUsername };
  }

  function startWeeklyReportScheduler() {
    // DISABLED 2026-04-21: 周报/月报已合并到 Agents v2 rhythm-engine
    log.info('[bi-report] weekly/monthly report scheduler DISABLED — merged into Agents v2 rhythm-engine');
  }

  return {
    sendWeeklyReports,
    sendMonthlyReports,
    sendTestReportsToUser,
    startWeeklyReportScheduler,
    sendBiReportToAdmins,
  };
}
