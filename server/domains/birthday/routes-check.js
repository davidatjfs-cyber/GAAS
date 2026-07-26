import { parseBirthdayMonthDay, getNextMonth, isEndOfMonth } from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'birthday', handler: 'routes-check' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerBirthdayCheckRoute(app, authRequired, deps) {
  const {
    getSharedState,
    saveSharedState,
    isInactiveStatus,
    employeeAccountShouldDisable,
    addStateNotification,
    makeNotif,
    hrmsNowISO,
    pickAdminUsername,
    pickHrManagerUsername,
    stateFindUserRecord,
  } = deps;

  app.post('/api/birthday/check', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });

      const forceDate = String(req.body?.date || '').trim();
      const now = forceDate ? new Date(forceDate + 'T09:00:00') : new Date();
      if (isNaN(now.getTime())) return res.status(400).json({ error: 'invalid_date' });

      const todayMonth = now.getMonth() + 1;
      const todayDay = now.getDate();
      const todayStr = `${now.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;

      let state = (await getSharedState()) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const activeEmployees = employees.filter(e => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e));

      const birthdayGreetingsSent = state.birthdayGreetingsSent || {};
      const birthdayRemindersSent = state.birthdayRemindersSent || {};
      const monthlyRemindersSent = state.monthlyRemindersSent || {};

      let changed = false;
      const results = { greetings: [], reminders1day: [], monthlyReminders: [] };

      const adminUsername = await pickAdminUsername(state);
      const adminName = adminUsername ? (stateFindUserRecord(state, adminUsername)?.name || adminUsername) : '总部';

      for (const emp of activeEmployees) {
        const bd = parseBirthdayMonthDay(emp?.birthday);
        if (!bd || bd.month !== todayMonth || bd.day !== todayDay) continue;

        const empUsername = String(emp?.username || '').trim();
        const empName = String(emp?.name || '').trim() || empUsername;
        const greetingKey = `${empUsername}_${todayStr}`;

        if (birthdayGreetingsSent[greetingKey]) {
          results.greetings.push({ name: empName, status: 'already_sent' });
          continue;
        }

        const message = `${empName}，今天是你的生日，公司代表门店及总部所有人员祝你生日快乐，感谢你在过去一年里的努力与付出，你的专业与责任心让团队更加稳固可靠。愿新的一岁事业顺遂、生活明朗，收获成长与喜悦。公司很荣幸与你一路同行，期待与你共同创造更好的未来。\n\n来自总部 ${adminName}（${todayStr}）`;

        state = addStateNotification(state, makeNotif(empUsername, '🎂 生日快乐', message, { type: 'birthday_greeting' }));
        birthdayGreetingsSent[greetingKey] = hrmsNowISO();
        changed = true;
        results.greetings.push({ name: empName, status: 'sent' });
      }

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
        const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
        if (!storeManager) continue;

        const smUsername = String(storeManager?.username || '').trim();
        const reminderKey = `${smUsername}_${tomorrowStr}`;
        if (birthdayRemindersSent[reminderKey]) {
          results.reminders1day.push({ store, status: 'already_sent' });
          continue;
        }

        const names = emps.map(e => String(e?.name || e?.username || '').trim()).join('、');
        const message = `温馨提醒：明天（${tomorrowStr}）是以下员工的生日，请提前准备祝福：\n\n${names}`;

        state = addStateNotification(state, makeNotif(smUsername, '🎂 明日生日提醒', message, { type: 'birthday_reminder_1day' }));
        birthdayRemindersSent[reminderKey] = hrmsNowISO();
        changed = true;
        results.reminders1day.push({ store, employees: names, status: 'sent' });
      }

      if (isEndOfMonth(now)) {
        const nextMonth = getNextMonth(now);
        const monthKey = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}`;

        const nextMonthBirthdays = activeEmployees.filter(e => {
          const bd = parseBirthdayMonthDay(e?.birthday);
          return bd && bd.month === nextMonth.month;
        });

        if (nextMonthBirthdays.length > 0) {
          const storeMap2 = new Map();
          for (const emp of nextMonthBirthdays) {
            const store = String(emp?.store || '').trim() || '总部';
            if (!storeMap2.has(store)) storeMap2.set(store, []);
            storeMap2.get(store).push(emp);
          }

          for (const [store, emps] of storeMap2) {
            const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
            if (!storeManager) continue;

            const smUsername = String(storeManager?.username || '').trim();
            const reminderKey = `monthly_${smUsername}_${monthKey}`;
            if (monthlyRemindersSent[reminderKey]) {
              results.monthlyReminders.push({ store, status: 'already_sent' });
              continue;
            }

            const lines = emps.map(e => {
              const bd = parseBirthdayMonthDay(e?.birthday);
              return `• ${String(e?.name || e?.username || '').trim()}（${nextMonth.month}月${bd?.day}日）`;
            }).join('\n');
            const message = `以下是${store}门店${nextMonth.month}月份过生日的员工名单，请提前准备祝福：\n\n${lines}`;

            state = addStateNotification(state, makeNotif(smUsername, `📋 ${nextMonth.month}月生日员工名单`, message, { type: 'birthday_monthly_reminder' }));
            monthlyRemindersSent[reminderKey] = hrmsNowISO();
            changed = true;
            results.monthlyReminders.push({ store, count: emps.length, status: 'sent' });
          }

          const hrUsername = await pickHrManagerUsername(state);
          if (hrUsername) {
            const hrReminderKey = `monthly_hr_${monthKey}`;
            if (!monthlyRemindersSent[hrReminderKey]) {
              const lines = nextMonthBirthdays.map(e => {
                const bd = parseBirthdayMonthDay(e?.birthday);
                const store = String(e?.store || '').trim() || '总部';
                return `• ${String(e?.name || e?.username || '').trim()}（${store}，${nextMonth.month}月${bd?.day}日）`;
              }).sort().join('\n');
              const message = `以下是公司所有门店（含总部）${nextMonth.month}月份过生日的员工名单：\n\n${lines}`;

              state = addStateNotification(state, makeNotif(hrUsername, `📋 ${nextMonth.month}月全公司生日员工名单`, message, { type: 'birthday_monthly_reminder_hr' }));
              monthlyRemindersSent[hrReminderKey] = hrmsNowISO();
              changed = true;
              results.monthlyReminders.push({ target: 'HR', count: nextMonthBirthdays.length, status: 'sent' });
            }
          }
        }
      }

      if (changed) {
        state.birthdayGreetingsSent = birthdayGreetingsSent;
        state.birthdayRemindersSent = birthdayRemindersSent;
        state.monthlyRemindersSent = monthlyRemindersSent;
        await saveSharedState(state);
      }

      res.json({ ok: true, date: todayStr, isEndOfMonth: isEndOfMonth(now), results });
    } catch (e) {
      log.error({ msg: 'post_api_birthday_check_error', err: e?.message || String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
