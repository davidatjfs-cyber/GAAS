/**
 * RAG 多维知识库 HTTP routes (Wave 4p — behavior-preserving extract from index.js).
 */
import { getKnowledgeViewerProfile } from './profile.js';

export function registerRagRoutes(app, authRequired, deps) {
  const { getSharedState, ragStats, ragQuery, ragMultiQuery } = deps;

  app.get('/api/rag/stats', authRequired, async (req, res) => {
    res.json(await ragStats());
  });

  app.post('/api/rag/query', authRequired, async (req, res) => {
    const { query, scope, category, brandTag, limit } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const profile = await getKnowledgeViewerProfile(req, getSharedState);
    const adminRag = profile.role === 'admin';
    const result = await ragQuery({
      agentName: req.body.agentName || 'master_agent',
      userRole: profile.role || req.user?.role,
      userStore: profile.store,
      userPosition: profile.position,
      skipKnowledgeAudienceFilter: adminRag,
      query,
      scope,
      category,
      brandTag,
      limit
    });
    res.json(result);
  });

  app.post('/api/rag/multi-query', authRequired, async (req, res) => {
    const { queries, scope, brandTag, limit } = req.body;
    if (!Array.isArray(queries)) return res.status(400).json({ error: 'queries array required' });
    const profile = await getKnowledgeViewerProfile(req, getSharedState);
    const adminRag = profile.role === 'admin';
    const result = await ragMultiQuery({
      agentName: req.body.agentName || 'master_agent',
      userRole: profile.role || req.user?.role,
      userStore: profile.store,
      userPosition: profile.position,
      skipKnowledgeAudienceFilter: adminRag,
      queries,
      scope,
      brandTag,
      limit
    });
    res.json(result);
  });
}
