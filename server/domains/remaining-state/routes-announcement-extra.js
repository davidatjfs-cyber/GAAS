/**
 * POST /api/announcements/:id/ack, GET /api/announcements/:id/receipts
 * (behavior-preserving extract from index.js ~12418–12471).
 */

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   mergeSharedStateFields: (patches: object, arrayIdFields?: object, tenantId?: string)=>Promise<void>,
 *   employeeAccountShouldDisable: (emp: object)=>boolean,
 * }} deps
 */
export function registerAnnouncementExtraRoutes(app, authRequired, deps) {
  const { getSharedState, mergeSharedStateFields, employeeAccountShouldDisable } = deps;

  // 公告已读回执：员工标记自己已读/已确认某条公告。
  // announcements 现在直接对每条公告挂 readBy{username: isoTime} 这个map，不另起新表——
  // 用 mergeSharedStateFields 按 id 合并单条公告对象，不会跟其它员工的并发已读/其它字段写入冲突。
  app.post('/api/announcements/:id/ack', authRequired, async (req, res) => {
    try {
      const annId = String(req.params.id || '').trim();
      const username = String(req.user?.username || '').trim().toLowerCase();
      if (!annId) return res.status(400).json({ error: 'missing_id' });
      if (!username) return res.status(400).json({ error: 'missing_user' });
      const state = await getSharedState(req.tenantId);
      const anns = Array.isArray(state?.announcements) ? state.announcements : [];
      const ann = anns.find((a) => String(a?.id || '') === annId);
      if (!ann) return res.status(404).json({ error: 'not_found' });
      const readBy = (ann.readBy && typeof ann.readBy === 'object' && !Array.isArray(ann.readBy)) ? { ...ann.readBy } : {};
      if (!readBy[username]) {
        readBy[username] = new Date().toISOString();
        await mergeSharedStateFields({ announcements: [{ ...ann, readBy }] }, { announcements: 'id' }, req.tenantId);
      }
      return res.json({ ok: true, readAt: readBy[username] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  // 管理员查看某条公告的已读情况：总目标人数/已读人数/未读名单
  app.get('/api/announcements/:id/receipts', authRequired, async (req, res) => {
    if (!['admin', 'hq_manager', 'store_manager'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const annId = String(req.params.id || '').trim();
      const state = await getSharedState(req.tenantId);
      const anns = Array.isArray(state?.announcements) ? state.announcements : [];
      const ann = anns.find((a) => String(a?.id || '') === annId);
      if (!ann) return res.status(404).json({ error: 'not_found' });
      const employees = (Array.isArray(state?.employees) ? state.employees : [])
        .filter((e) => !employeeAccountShouldDisable(e));
      const scope = ann.scope || { type: 'all' };
      const scopeType = String(scope.type || 'all');
      const targets = employees.filter((e) => {
        if (scopeType === 'all') return true;
        if (scopeType === 'hq') return String(e?.store || '') === '总部';
        if (scopeType === 'store') return String(e?.store || '') === String(scope.store || '');
        return false;
      });
      const readBy = (ann.readBy && typeof ann.readBy === 'object') ? ann.readBy : {};
      const unread = targets.filter((e) => !readBy[String(e?.username || '').trim().toLowerCase()]);
      return res.json({
        ok: true,
        total: targets.length,
        readCount: targets.length - unread.length,
        unread: unread.map((e) => ({ username: e.username, name: e.name || e.username, store: e.store || '' }))
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });
}
