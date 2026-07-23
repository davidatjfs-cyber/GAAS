/**
 * GET /api/promotion/tracks
 * (Wave 4o — behavior-preserving extract from index.js).
 */

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: Function,
 *   stateFindUserRecord: Function,
 *   getPromotionTrackProgress: Function,
 * }} deps
 */
export function registerPromotionTracksRoutes(app, authRequired, deps) {
  const { getSharedState, stateFindUserRecord, getPromotionTrackProgress } = deps;

  app.get('/api/promotion/tracks', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    try {
      const state = (await getSharedState()) || {};
      const list = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
      let items = list;
      if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager')) {
        items = list.filter(t => {
          const applicant = String(t?.applicantUsername || '').trim();
          const mentor = String(t?.mentorUsername || '').trim();
          const store = String(t?.store || '').trim();
          const mine = stateFindUserRecord(state, username) || {};
          const myStore = String(mine?.store || '').trim();
          const myRole = String(mine?.role || role || '').trim();
          const storeManagerMatch = myRole === 'store_manager' && myStore && store === myStore;
          const prodManagerMatch = myRole === 'store_production_manager' && myStore && store === myStore;
          return applicant === username || mentor === username || storeManagerMatch || prodManagerMatch;
        });
      }
      items.sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));

      // 唯一渠道：考核结果由系统根据培训认证进度自动判定，去掉人工考核环节
      items = await Promise.all(items.map(async (t) => {
        if (!Array.isArray(t?.requiredTopicIds)) return t;
        const progress = await getPromotionTrackProgress(t.applicantUsername, t.requiredTopicIds);
        return { ...t, trainingProgress: progress, assessmentStatus: progress.passed ? 'passed' : 'pending' };
      }));

      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
