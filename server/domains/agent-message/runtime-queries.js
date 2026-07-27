/**
 * Agent 知识库 / Bitable / 统一检索（peel from agents.js）。
 */

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {() => Promise<object>} deps.getSharedState
 * @param {{ error: Function }} deps.log
 * @param {() => Promise<{ ragQuery?: Function }|null>} [deps.importRagTool]
 */
export function createRuntimeQueriesApi(deps) {
  const {
    pool,
    getSharedState,
    log,
    importRagTool = async () => {
      try {
        return await import('../../rag-tool.js');
      } catch {
        return null;
      }
    },
  } = deps;

  async function getEmployeePositionForKb(username) {
    const u = String(username || '').trim().toLowerCase();
    if (!u) return '';
    try {
      const state = await getSharedState();
      const employees = Array.isArray(state?.employees) ? state.employees : [];
      const users = Array.isArray(state?.users) ? state.users : [];
      const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === u);
      const usr = users.find((x) => String(x?.username || '').trim().toLowerCase() === u);
      return String(emp?.position || usr?.position || '').trim();
    } catch {
      return '';
    }
  }

  async function queryKnowledgeBase(agent, query, limit = 5, options = {}) {
    try {
      const ragModule = await importRagTool();
      if (ragModule?.ragQuery) {
        const agentName = Array.isArray(agent) ? 'sop_advisor' : String(agent || 'master_agent').trim();
        const queryStr = Array.isArray(query)
          ? query.filter(Boolean).join(' ')
          : (String(query || '').trim()
            || (Array.isArray(agent) ? agent.filter(Boolean).join(' ') : String(agent || '')));
        const result = await ragModule.ragQuery({
          agentName,
          userRole: options?.userRole || 'admin',
          userStore: options?.userStore ?? '',
          userPosition: options?.userPosition ?? '',
          skipKnowledgeAudienceFilter: options?.skipKnowledgeAudienceFilter !== false,
          query: queryStr,
          brandTag: options?.brandTag,
          limit,
        });
        return (result?.results || []).map((r) => ({
          title: r.title,
          content: r.content,
          tags: r.tags,
          created_at: r.createdAt,
        }));
      }
      const brandTag = String(options?.brandTag || '').trim();
      const r = await pool().query(
        `SELECT title, content, tags, created_at FROM knowledge_base WHERE ($1 = '' OR tags && $1) AND (content ILIKE $2 OR title ILIKE $2) ORDER BY created_at DESC LIMIT $3`,
        [brandTag, `%${query}%`, limit],
      );
      return r.rows || [];
    } catch (e) {
      log.error('[agents] queryKnowledgeBase error:', e?.message);
      return [];
    }
  }

  async function queryBitableData(agent, query, limit = 10, options = {}) {
    try {
      const contentType = options?.contentType || '';
      const configKey = options?.configKey || '';

      let whereClause = `content_type IN ('bitable_submission', 'table_visit', 'vision_analysis')`;
      const params = [`%${query}%`, limit];

      if (contentType) {
        whereClause += ` AND content_type = $${params.length + 1}`;
        params.push(contentType);
      }

      if (configKey) {
        whereClause += ` AND agent_data::text ILIKE $${params.length + 1}`;
        params.push(`%"configKey":"${configKey}"%`);
      }

      const r = await pool().query(
        `SELECT content, content_type, agent_data, created_at, sender_name
       FROM agent_messages 
       WHERE ${whereClause} 
         AND (content ILIKE $1 OR agent_data::text ILIKE $1)
       ORDER BY created_at DESC 
       LIMIT $2`,
        params,
      );

      return r.rows || [];
    } catch (e) {
      log.error('[agents] queryBitableData error:', e?.message);
      return [];
    }
  }

  async function queryAgentData(agent, query, limit = 10, options = {}) {
    const includeBitable = options?.includeBitable !== false;
    const includeKnowledge = options?.includeKnowledge !== false;

    const results = {
      knowledge: [],
      bitable: [],
    };

    if (includeKnowledge) {
      results.knowledge = await queryKnowledgeBase(agent, query, limit, options);
    }

    if (includeBitable) {
      results.bitable = await queryBitableData(agent, query, limit, options);
    }

    return results;
  }

  return {
    getEmployeePositionForKb,
    queryKnowledgeBase,
    queryBitableData,
    queryAgentData,
  };
}
