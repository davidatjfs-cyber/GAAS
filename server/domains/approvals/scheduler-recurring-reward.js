import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'scheduler-recurring-reward' });

export function createRecurringRewardScheduler({
  pool,
  getSharedState,
  saveSharedState,
  getActiveTenantIds,
  tenantContext,
  pickAdminUsername,
  pickHqManagerUsername,
  pickCashierUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
  buildConfiguredApprovalAssignees,
  resolveDutyApproverForStore,
  addStateNotification,
  makeNotif,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getNow = () => new Date(),
}) {
  let _lastRecurringRewardJobSlot = '';

  function shanghaiCalendarForJobs(now = getNow()) {
    const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
    return { ymd, y, m, d, hour, minute };
  }

  async function insertRewardPunishmentApprovalFromTemplate(applicantUsername, payloadObj) {
    const username = String(applicantUsername || '').trim();
    if (!username) throw new Error('missing_applicant');
    let state = (await getSharedState()) || {};
    const applicant = stateFindUserRecord(state, username) || {};
    const applicantManager = String(applicant?.managerUsername || '').trim();
    const adminUsername = await pickAdminUsername(state);
    const hqManagerUsername = await pickHqManagerUsername(state);
    const cashierUsername = await pickCashierUsername(state);
    const hrManagerUsername = await pickHrManagerUsername(state);
    const applicantStore = String(applicant?.store || payloadObj?.store || '').trim();
    const ctx = {
      state,
      applicantUsername: username,
      applicantStore,
      managerUsername: applicantManager,
      adminUsername,
      hqManagerUsername,
      hrManagerUsername,
      cashierUsername,
    };
    let assignees = await buildConfiguredApprovalAssignees(
      state,
      'reward_punishment',
      ctx,
      resolveDutyApproverForStore
    );
    if (!assignees.length) {
      assignees = [applicantManager, hrManagerUsername].filter(Boolean);
    }
    const seen = new Set();
    const uniq = [];
    (assignees || []).forEach((a) => {
      const k = String(a || '').trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      uniq.push(String(a || '').trim());
    });
    if (!uniq.length) throw new Error('missing_assignee');
    const chain = uniq.map((a, idx) => ({
      step: idx + 1,
      assignee: a,
      status: idx === 0 ? 'pending' : 'queued',
      decidedAt: null,
      note: '',
    }));
    const currentAssignee = chain[0]?.assignee || null;
    const r = await pool.query(
      `insert into approval_requests (type, status, applicant_username, current_assignee_username, chain, payload, created_at, updated_at)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb, now(), now())
     returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
      [
        'reward_punishment',
        'pending',
        username,
        currentAssignee,
        JSON.stringify(chain),
        JSON.stringify(payloadObj),
      ]
    );
    const item = r.rows?.[0] || null;
    return { item, uniq, currentAssignee, state, applicant };
  }

  async function runMonthlyRecurringRewardTemplatesJob() {
    const cal = shanghaiCalendarForJobs();
    // 与绩效/关账节奏对齐：每月 10 日（上海）早间生成当月待审批单
    if (cal.d !== 10 || cal.hour !== 7 || cal.minute >= 20) return;
    const slotKey = `${cal.ymd}_rrt`;
    if (_lastRecurringRewardJobSlot === slotKey) return;
    _lastRecurringRewardJobSlot = slotKey;

    const ym = `${cal.y}-${String(cal.m).padStart(2, '0')}`;
    // recurring_reward_templates开了FORCE RLS，这个cron不是per-tenant循环调用的，
    // 需要自己遍历active租户分别查，否则在没有任何租户上下文时只会读到0行。
    let rows = [];
    try {
      for (const tid of await getActiveTenantIds(pool)) {
        const r = await tenantContext.run(tid, () =>
          pool.query(
            `select * from recurring_reward_templates where active = true and frequency = 'monthly'`
          )
        );
        rows.push(...(r.rows || []));
      }
    } catch (e) {
      return;
    }

    for (const tpl of rows) {
      const tplTenantId = String(tpl.tenant_id || 'default').trim() || 'default';
      await tenantContext.run(tplTenantId, async () => {
        if (String(tpl.last_generated_ym || '') === ym) return;
        const applicantUsername = String(tpl.created_by || '').trim();
        if (!applicantUsername) return;
        const base = tpl.payload && typeof tpl.payload === 'object' ? tpl.payload : {};
        const genPayload = {
          ...base,
          recurringTemplateId: String(tpl.id),
          recurringGeneratedYm: ym,
          note:
            (String(base.note || '').trim() ? `${String(base.note).trim()}\n` : '') +
            `[系统自动·${ym}月度奖惩]`,
        };
        try {
          const dup = await pool.query(
            `select id from approval_requests where type=$1 and status=$2
           and coalesce(payload->>'recurringTemplateId','')=$3
           and coalesce(payload->>'recurringGeneratedYm','')=$4 limit 1`,
            ['reward_punishment', 'pending', String(tpl.id), ym]
          );
          if (dup.rows?.length) {
            await pool.query(
              `update recurring_reward_templates set last_generated_ym=$1, updated_at=now() where id=$2`,
              [ym, tpl.id]
            );
            return;
          }
          const { item, currentAssignee, state, applicant } =
            await insertRewardPunishmentApprovalFromTemplate(applicantUsername, genPayload);
          if (item && currentAssignee) {
            try {
              let nextState = state;
              const applicantName =
                String(applicant?.name || applicantUsername).trim() || applicantUsername;
              const targetUser = String(genPayload?.targetUsername || '').trim();
              const targetRec = targetUser ? stateFindUserRecord(state, targetUser) || {} : {};
              const targetName = String(targetRec?.name || targetUser).trim() || applicantName;
              const rpType = String(genPayload?.rpType || '').trim();
              const title = '奖惩申请待审批';
              const msg = `${applicantName} 提交了${rpType || '奖惩'}申请（${targetName}），请审批。[月度自动]`;
              const recipients = [String(currentAssignee || '').trim()].filter(Boolean);
              for (const u of recipients) {
                nextState = addStateNotification(
                  nextState,
                  makeNotif(u, title, msg, { type: 'reward_punishment_request', approvalId: item.id })
                );
              }
              await saveSharedState(nextState);
              (async () => {
                try {
                  const fu = await lookupFeishuUserByUsername(currentAssignee);
                  if (fu?.open_id) {
                    const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${msg}\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                    await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
                  }
                } catch (feishuErr) {
                  log.error({ msg: 'recurring_reward_feishu_notify_failed', err: feishuErr?.message || String(feishuErr) });
                }
              })();
            } catch (ne) {
              log.error({ msg: 'recurring_reward_notify_failed', err: ne?.message || String(ne) });
            }
          }
          await pool.query(
            `update recurring_reward_templates set last_generated_ym=$1, updated_at=now() where id=$2`,
            [ym, tpl.id]
          );
        } catch (e) {
          log.error({ msg: 'recurring_reward_template_failed', template_id: tpl.id, err: e?.message || String(e) });
        }
      });
    }
  }

  let started = false;
  function startRecurringRewardScheduler() {
    if (started) return;
    started = true;
    setInterval(() => {
      void runMonthlyRecurringRewardTemplatesJob().catch((e) =>
        log.error({ msg: 'recurring_reward_tick_failed', err: e?.message || String(e) })
      );
    }, 5 * 60 * 1000);
  }

  return {
    shanghaiCalendarForJobs,
    insertRewardPunishmentApprovalFromTemplate,
    runMonthlyRecurringRewardTemplatesJob,
    startRecurringRewardScheduler,
  };
}
