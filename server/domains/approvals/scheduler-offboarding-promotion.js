/**
 * Offboarding auto-disable + promotion-track progress sweep (every 30 min).
 * Wave H8 peel from index.js setInterval.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'offboarding-promotion-scheduler' });

export function createOffboardingPromotionScheduler({
  pool,
  runForActiveTenants,
  getSharedState,
  saveSharedState,
  ensureApprovalTables,
  safeDateOnly,
  hrmsNowISO,
  applyHrmsUserAccountGateFromEmployee,
  addStateNotification,
  makeNotif,
  getPromotionTrackProgress,
  getPromotionTrackRecipients,
  getTodayDateOnly,
}) {
  function todayDateOnly() {
    if (typeof getTodayDateOnly === 'function') return getTodayDateOnly();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function runOffboardingPromotionTick() {
    try {
      await runForActiveTenants(async (tenantId) => {
        try {
          await ensureApprovalTables();
          const dateOnly = todayDateOnly();

          const r = await pool.query(
            `select id, payload, applicant_username
         from approval_requests
         where type = $1
           and status = $2
           and effective_date is not null
           and effective_date <= $3::date
           and executed_at is null
         order by effective_date asc
         limit 50`,
            ['offboarding', 'approved', dateOnly]
          );
          const items = r.rows || [];
          // Pre-existing quirk: empty offboarding list also skips promotion sweep.
          if (!items.length) return;

          const state = (await getSharedState(tenantId)) || {};
          const employees = Array.isArray(state.employees) ? state.employees : [];
          let changed = false;
          for (const it of items) {
            const empUsername = String(
              it?.payload?.username ||
                it?.payload?.employeeUsername ||
                it?.payload?.applicant ||
                it?.applicant_username ||
                ''
            ).trim();
            if (!empUsername) continue;
            const idx = employees.findIndex(
              (e) => String(e?.username || '').toLowerCase() === empUsername.toLowerCase()
            );
            if (idx < 0) continue;
            const old = employees[idx] || {};
            const eff = safeDateOnly(it?.effective_date || it?.payload?.resignDate || it?.payload?.date);
            if (String(old.status || '') !== '离职' && String(old.status || '') !== 'inactive') {
              employees[idx] = {
                ...old,
                status: '离职',
                resignedAt: dateOnly,
                offboardingApproved: true,
                offboardingDate: eff || old.offboardingDate || dateOnly,
              };
              changed = true;
            }
          }

          if (changed) {
            await saveSharedState({ ...state, employees }, tenantId);
          }
          try {
            const stAfter = (await getSharedState(tenantId)) || {};
            const emList = Array.isArray(stAfter.employees) ? stAfter.employees : [];
            for (const it of items) {
              const empUsername = String(
                it?.payload?.username ||
                  it?.payload?.employeeUsername ||
                  it?.payload?.applicant ||
                  it?.applicant_username ||
                  ''
              ).trim();
              if (!empUsername) continue;
              const rec2 = emList.find(
                (e) => String(e?.username || '').toLowerCase() === empUsername.toLowerCase()
              );
              if (rec2) {
                try {
                  await applyHrmsUserAccountGateFromEmployee(rec2);
                } catch (ge) {
                  log.error({
                    msg: 'offboarding_cron_account_gate_failed',
                    tenant_id: tenantId,
                    username: empUsername,
                    err: ge?.message || String(ge),
                  });
                }
              }
            }
          } catch (eGate) {
            log.error({
              msg: 'offboarding_cron_account_gate_batch_failed',
              tenant_id: tenantId,
              err: eGate?.message || String(eGate),
            });
          }

          // P1/P2/P5: 晋升进度每日扫描
          // P4: 替换旧的 trainingSessions 死代码（新版培训任务存 DB，promotionTrack 无 trainingSessions 字段）
          try {
            let state2 = (await getSharedState(tenantId)) || {};
            let allTracks = Array.isArray(state2.promotionTracks) ? state2.promotionTracks.slice() : [];
            if (allTracks.length) {
              let changedTrack = false;

              // P5: 归档超过90天的已完成/已拒绝 track，防止 state 无限膨胀
              const cutoff90 = Date.now() - 90 * 86400000;
              const freshTracks = allTracks.filter((tr) => {
                const s = String(tr?.status || '');
                if (s === 'promoted' || s === 'formal_rejected') {
                  const ts = tr?.updatedAt ? new Date(tr.updatedAt).getTime() : 0;
                  return ts > cutoff90;
                }
                return true;
              });
              if (freshTracks.length < allTracks.length) {
                state2 = { ...state2, promotionTracks: freshTracks };
                allTracks = freshTracks;
                changedTrack = true;
              }

              // P1/P2: 扫描进行中的 track
              const activeTracks = allTracks.filter(
                (tr) => String(tr?.status || '') === 'qualification_approved' && !tr?.formalApplied
              );
              for (const tr of activeTracks) {
                const trackId = String(tr?.id || '');
                const applicantUsername = String(tr?.applicantUsername || '');
                if (!trackId || !applicantUsername) continue;
                const requiredTopicIds = Array.isArray(tr.requiredTopicIds) ? tr.requiredTopicIds : [];
                const progress = requiredTopicIds.length
                  ? await getPromotionTrackProgress(applicantUsername, requiredTopicIds)
                  : null;

                // P1: 全部认证通过 → 推"可申请正式晋升"通知（仅推一次）
                if (progress?.passed && !tr.readyNotifiedAt) {
                  const recipients = await getPromotionTrackRecipients(state2, tr);
                  const name = String(tr?.applicantName || applicantUsername);
                  const pos = String(tr?.targetPosition || '');
                  for (const u of recipients) {
                    state2 = addStateNotification(
                      state2,
                      makeNotif(
                        u,
                        '晋升培训已完成，可申请正式晋升',
                        `${name}，你的晋升能力培训全部通过认证，已具备申请「${pos}」正式晋升的条件，请尽快提交正式晋升申请。`,
                        { type: 'promotion_training_completed', trackId }
                      )
                    );
                  }
                  const idx2 = state2.promotionTracks.findIndex((t) => String(t?.id || '') === trackId);
                  if (idx2 >= 0) {
                    const updated2 = state2.promotionTracks.slice();
                    updated2[idx2] = { ...updated2[idx2], readyNotifiedAt: hrmsNowISO() };
                    state2 = { ...state2, promotionTracks: updated2 };
                  }
                  changedTrack = true;
                }

                // P2: 截止日逾期且未通过 → 每天推一次逾期提醒（最多3次）
                if (!progress?.passed && tr.trainingDueDate && tr.trainingDueDate < dateOnly) {
                  const lastDate = String(tr?.lastOverdueReminderAt || '').slice(0, 10);
                  const overdueCount = Number(tr?.overdueReminderCount || 0);
                  if (lastDate !== dateOnly && overdueCount < 3) {
                    const daysOverdue = Math.round(
                      (new Date(dateOnly + 'T00:00:00').getTime() -
                        new Date(tr.trainingDueDate + 'T00:00:00').getTime()) /
                        86400000
                    );
                    const recipients = await getPromotionTrackRecipients(state2, tr);
                    const name = String(tr?.applicantName || applicantUsername);
                    for (const u of recipients) {
                      state2 = addStateNotification(
                        state2,
                        makeNotif(
                          u,
                          '晋升培训进度逾期提醒',
                          `${name} 的晋升培训已超截止日 ${daysOverdue} 天（截止：${tr.trainingDueDate}），仍有知识点未完成认证，请尽快推进。`,
                          { type: 'promotion_training_overdue', trackId }
                        )
                      );
                    }
                    const idx2 = state2.promotionTracks.findIndex(
                      (t) => String(t?.id || '') === trackId
                    );
                    if (idx2 >= 0) {
                      const updated2 = state2.promotionTracks.slice();
                      updated2[idx2] = {
                        ...updated2[idx2],
                        lastOverdueReminderAt: hrmsNowISO(),
                        overdueReminderCount: overdueCount + 1,
                      };
                      state2 = { ...state2, promotionTracks: updated2 };
                    }
                    changedTrack = true;
                  }
                }
              }

              if (changedTrack) await saveSharedState(state2, tenantId);
            }
          } catch (e) {
            log.error({ msg: 'promotion_sweep_failed', tenant_id: tenantId, err: String(e?.message || e) });
          }

          for (const it of items) {
            try {
              await pool.query(
                'update approval_requests set executed_at = now(), updated_at = now() where id = $1',
                [it.id]
              );
            } catch (e) {
              /* ignore */
            }
          }
        } catch (e) {
          log.error({ msg: 'offboarding_auto_disable_failed', tenant_id: tenantId, err: String(e?.message || e) });
        }
      }, { continueOnError: true });
    } catch (e) {
      log.error({ msg: 'offboarding_cron_run_for_active_tenants_failed', err: e?.message || String(e) });
    }
  }

  let started = false;
  function startOffboardingPromotionScheduler() {
    if (started) return;
    started = true;
    setInterval(() => {
      void runOffboardingPromotionTick().catch((e) =>
        log.error({ msg: 'offboarding_cron_tick_failed', err: e?.message || String(e) })
      );
    }, 30 * 60 * 1000);
  }

  return { runOffboardingPromotionTick, startOffboardingPromotionScheduler };
}
