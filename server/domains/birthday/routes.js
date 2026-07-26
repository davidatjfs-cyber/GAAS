import { registerBirthdayCheckRoute } from './routes-check.js';
import { registerBirthdayUpcomingRoute } from './routes-upcoming.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: () => Promise<object>,
 *   saveSharedState: (state: object) => Promise<void>,
 *   isInactiveStatus: (status: string) => boolean,
 *   employeeAccountShouldDisable: (emp: object) => boolean,
 *   addStateNotification: (state: object, notif: object) => object,
 *   makeNotif: (...args: unknown[]) => object,
 *   hrmsNowISO: () => string,
 *   pickAdminUsername: (state: object) => Promise<string | null>,
 *   pickHrManagerUsername: (state: object) => Promise<string | null>,
 *   stateFindUserRecord: (state: object, username: string) => object | null,
 * }} deps
 */
export function registerBirthdayRoutes(app, authRequired, deps) {
  registerBirthdayCheckRoute(app, authRequired, deps);
  registerBirthdayUpcomingRoute(app, authRequired, deps);
}
