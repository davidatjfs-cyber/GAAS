import { parseBirthdayMonthDay } from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'birthday', handler: 'routes-upcoming' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerBirthdayUpcomingRoute(app, authRequired, deps) {
  const {
    getSharedState,
    isInactiveStatus,
    employeeAccountShouldDisable,
  } = deps;

  app.get('/api/birthday/upcoming', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      const username = String(req.user?.username || '').trim();
      const _canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role.startsWith('custom_人事');

      const state = (await getSharedState()) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const activeEmployees = employees.filter(e => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e));

      let myStore = '';
      if (role === 'store_manager') {
        const me = activeEmployees.find(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
        myStore = String(me?.store || '').trim();
      }

      const now = new Date();
      const _todayMonth = now.getMonth() + 1;
      const _todayDay = now.getDate();
      const daysParam = Math.max(1, Math.min(90, Number(req.query?.days) || 30));

      const results = [];
      for (const emp of activeEmployees) {
        const bd = parseBirthdayMonthDay(emp?.birthday);
        if (!bd) continue;

        if (role === 'store_manager' && myStore) {
          const empStore = String(emp?.store || '').trim();
          if (empStore !== myStore) continue;
        }

        const thisYearBd = new Date(now.getFullYear(), bd.month - 1, bd.day);
        let nextBd = thisYearBd;
        if (thisYearBd < now) {
          nextBd = new Date(now.getFullYear() + 1, bd.month - 1, bd.day);
        }
        const diffDays = Math.ceil((nextBd.getTime() - now.getTime()) / 86400000);

        if (diffDays <= daysParam) {
          results.push({
            username: String(emp?.username || '').trim(),
            name: String(emp?.name || '').trim(),
            store: String(emp?.store || '').trim() || '总部',
            birthday: String(emp?.birthday || '').trim(),
            birthdayDisplay: `${bd.month}月${bd.day}日`,
            daysUntil: diffDays,
            isToday: diffDays === 0
          });
        }
      }

      results.sort((a, b) => a.daysUntil - b.daysUntil);
      res.json({ ok: true, upcoming: results });
    } catch (e) {
      log.error({ msg: 'get_api_birthday_upcoming_error', err: e?.message || String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
