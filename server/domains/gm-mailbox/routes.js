import { randomUUID } from 'crypto';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: ()=>Promise<object|null>,
 *   saveSharedState: (state: object)=>Promise<void>,
 *   pickHqManagerUsername: (state: object)=>Promise<string|null>,
 *   pickAdminUsername: (state: object)=>Promise<string|null>,
 *   addStateNotification: (state: object, notif: object)=>object,
 *   makeNotif: (username: string, title: string, msg: string, meta?: object)=>object,
 *   uniqUsernames: (names: Array<string|null|undefined>)=>string[],
 *   hrmsNowISO: ()=>string,
 * }} deps
 */
export function registerGmMailboxRoutes(app, authRequired, deps) {
  const {
    getSharedState,
    saveSharedState,
    pickHqManagerUsername,
    pickAdminUsername,
    addStateNotification,
    makeNotif,
    uniqUsernames,
    hrmsNowISO,
  } = deps;

  app.post('/api/gm-mailbox', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'missing_content' });
    if (content.length < 5) return res.status(400).json({ error: 'content_too_short' });

    try {
      const state0 = (await getSharedState()) || {};
      const gm = (await pickHqManagerUsername(state0)) || (await pickAdminUsername(state0));
      const admin = await pickAdminUsername(state0);

      const item = {
        id: randomUUID(),
        createdAt: hrmsNowISO(),
        content,
        applicantUsername: username,
        anonymous: true
      };

      const mailbox = Array.isArray(state0.gmMailbox) ? state0.gmMailbox.slice() : [];
      mailbox.unshift(item);

      let state = { ...state0, gmMailbox: mailbox };
      const title = '总经理信箱（匿名）';
      const msg = content.length > 120 ? (content.slice(0, 120) + '...') : content;
      const recipients = uniqUsernames([gm, admin]);
      for (const u of recipients) {
        state = addStateNotification(state, makeNotif(u, title, msg, { type: 'gm_mailbox', mailboxId: item.id }));
      }

      await saveSharedState(state);
      return res.json({ ok: true, id: item.id });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
