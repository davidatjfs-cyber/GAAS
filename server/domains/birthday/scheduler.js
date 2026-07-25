import { childLogger } from '../../utils/logger.js';
import { parseBirthdayMonthDay, getNextMonth, isEndOfMonth } from './helpers.js';

const log = childLogger({ domain: 'birthday', handler: 'scheduler' });

export function createBirthdayScheduler({
  getSharedState,
  saveSharedState,
  runForActiveTenants,
  addStateNotification,
  makeNotif,
  hrmsNowISO,
  isInactiveStatus,
  employeeAccountShouldDisable,
  pickAdminUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
  getNow = () => new Date(),
}) {
  async function runBirthdayGreetingTick() {
    try {
      await runForActiveTenants(async (tenantId) => {
        try {
          const now = getNow();
          const todayMonth = now.getMonth() + 1;
          const todayDay = now.getDate();
          const todayStr = `${now.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
          const hour = now.getHours();

          let state = (await getSharedState(tenantId)) || {};
          const employees = Array.isArray(state.employees) ? state.employees : [];
          const activeEmployees = employees.filter(
            (e) => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e)
          );

          // 记录已发送的生日祝福，避免重复
          const birthdayGreetingsSent = state.birthdayGreetingsSent || {};
          const birthdayRemindersSent = state.birthdayRemindersSent || {};
          const monthlyRemindersSent = state.monthlyRemindersSent || {};

          let changed = false;

          // === 1. 生日当天自动发送祝福（每天8-10点之间执行一次）===
          if (hour >= 8 && hour <= 10) {
            const adminUsername = await pickAdminUsername(state);
            const adminName = adminUsername
              ? stateFindUserRecord(state, adminUsername)?.name || adminUsername
              : '总部';

            for (const emp of activeEmployees) {
              const bd = parseBirthdayMonthDay(emp?.birthday);
              if (!bd || bd.month !== todayMonth || bd.day !== todayDay) continue;

              const empUsername = String(emp?.username || '').trim();
              const empName = String(emp?.name || '').trim() || empUsername;
              const greetingKey = `${empUsername}_${todayStr}`;

              if (birthdayGreetingsSent[greetingKey]) continue;

              const message = `${empName}，今天是你的生日，公司代表门店及总部所有人员祝你生日快乐，感谢你在过去一年里的努力与付出，你的专业与责任心让团队更加稳固可靠。愿新的一岁事业顺遂、生活明朗，收获成长与喜悦。公司很荣幸与你一路同行，期待与你共同创造更好的未来。\n\n来自总部 ${adminName}（${todayStr}）`;

              state = addStateNotification(
                state,
                makeNotif(empUsername, '🎂 生日快乐', message, { type: 'birthday_greeting' })
              );
              birthdayGreetingsSent[greetingKey] = hrmsNowISO();
              changed = true;
              log.info({
                msg: 'birthday_greeting_sent',
                employee_name: empName,
                username: empUsername,
              });
            }
          }

          // === 2. 生日前1天提醒店长（每天8-10点之间执行一次）===
          if (hour >= 8 && hour <= 10) {
            const tomorrow = new Date(now.getTime() + 86400000);
            const tomorrowMonth = tomorrow.getMonth() + 1;
            const tomorrowDay = tomorrow.getDate();
            const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrowMonth).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')}`;

            const storeMap = new Map();
            for (const emp of activeEmployees) {
              const bd = parseBirthdayMonthDay(emp?.birthday);
              if (!bd || bd.month !== tomorrowMonth || bd.day !== tomorrowDay) continue;
              const store = String(emp?.store || '').trim() || '总部';
              if (!storeMap.has(store)) storeMap.set(store, []);
              storeMap.get(store).push(emp);
            }

            for (const [store, emps] of storeMap) {
              const storeManager = activeEmployees.find(
                (e) =>
                  String(e?.store || '').trim() === store &&
                  String(e?.role || '').trim() === 'store_manager'
              );
              if (!storeManager) continue;

              const smUsername = String(storeManager?.username || '').trim();
              const reminderKey = `${smUsername}_${tomorrowStr}`;
              if (birthdayRemindersSent[reminderKey]) continue;

              const names = emps.map((e) => String(e?.name || e?.username || '').trim()).join('、');
              const message = `温馨提醒：明天（${tomorrowStr}）是以下员工的生日，请提前准备祝福：\n\n${names}`;

              state = addStateNotification(
                state,
                makeNotif(smUsername, '🎂 明日生日提醒', message, { type: 'birthday_reminder_1day' })
              );
              birthdayRemindersSent[reminderKey] = hrmsNowISO();
              changed = true;
            }
          }

          // === 3. 月底提醒：下月生日员工名单（每月最后3天的8-10点执行一次）===
          if (hour >= 8 && hour <= 10 && isEndOfMonth(now)) {
            const nextMonth = getNextMonth(now);
            const monthKey = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}`;

            const nextMonthBirthdays = activeEmployees.filter((e) => {
              const bd = parseBirthdayMonthDay(e?.birthday);
              return bd && bd.month === nextMonth.month;
            });

            if (nextMonthBirthdays.length > 0) {
              const storeMap = new Map();
              for (const emp of nextMonthBirthdays) {
                const store = String(emp?.store || '').trim() || '总部';
                if (!storeMap.has(store)) storeMap.set(store, []);
                storeMap.get(store).push(emp);
              }

              for (const [store, emps] of storeMap) {
                const storeManager = activeEmployees.find(
                  (e) =>
                    String(e?.store || '').trim() === store &&
                    String(e?.role || '').trim() === 'store_manager'
                );
                if (!storeManager) continue;

                const smUsername = String(storeManager?.username || '').trim();
                const reminderKey = `monthly_${smUsername}_${monthKey}`;
                if (monthlyRemindersSent[reminderKey]) continue;

                const lines = emps
                  .map((e) => {
                    const bd = parseBirthdayMonthDay(e?.birthday);
                    return `• ${String(e?.name || e?.username || '').trim()}（${nextMonth.month}月${bd?.day}日）`;
                  })
                  .join('\n');
                const message = `以下是${store}门店${nextMonth.month}月份过生日的员工名单，请提前准备祝福：\n\n${lines}`;

                state = addStateNotification(
                  state,
                  makeNotif(smUsername, `📋 ${nextMonth.month}月生日员工名单`, message, {
                    type: 'birthday_monthly_reminder',
                  })
                );
                monthlyRemindersSent[reminderKey] = hrmsNowISO();
                changed = true;
              }

              const hrUsername = await pickHrManagerUsername(state);
              if (hrUsername) {
                const hrReminderKey = `monthly_hr_${monthKey}`;
                if (!monthlyRemindersSent[hrReminderKey]) {
                  const lines = nextMonthBirthdays
                    .map((e) => {
                      const bd = parseBirthdayMonthDay(e?.birthday);
                      const store = String(e?.store || '').trim() || '总部';
                      return `• ${String(e?.name || e?.username || '').trim()}（${store}，${nextMonth.month}月${bd?.day}日）`;
                    })
                    .sort()
                    .join('\n');
                  const message = `以下是公司所有门店（含总部）${nextMonth.month}月份过生日的员工名单：\n\n${lines}`;

                  state = addStateNotification(
                    state,
                    makeNotif(hrUsername, `📋 ${nextMonth.month}月全公司生日员工名单`, message, {
                      type: 'birthday_monthly_reminder_hr',
                    })
                  );
                  monthlyRemindersSent[hrReminderKey] = hrmsNowISO();
                  changed = true;
                }
              }
            }
          }

          if (changed) {
            state.birthdayGreetingsSent = birthdayGreetingsSent;
            state.birthdayRemindersSent = birthdayRemindersSent;
            state.monthlyRemindersSent = monthlyRemindersSent;
            await saveSharedState(state, tenantId);
          }
        } catch (e) {
          log.error({
            msg: 'birthday_greeting_tenant_failed',
            tenant_id: tenantId,
            err: e?.message || String(e),
          });
        }
      }, { continueOnError: true });
    } catch (e) {
      log.error({ msg: 'birthday_greeting_run_failed', err: e?.message || String(e) });
    }
  }

  let started = false;
  function startBirthdayGreetingScheduler() {
    if (started) return;
    started = true;
    // Do not run immediately on start (legacy: setInterval only, no immediate tick)
    setInterval(() => {
      runBirthdayGreetingTick().catch((e) =>
        log.error({ msg: 'birthday_greeting_tick_failed', err: e?.message || String(e) })
      );
    }, 60 * 60 * 1000);
  }

  return { runBirthdayGreetingTick, startBirthdayGreetingScheduler };
}
