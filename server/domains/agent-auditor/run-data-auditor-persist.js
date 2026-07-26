import { getCategoryAssigneeRoleMap } from '../../agent-config-manager.js';
import { childLogger } from '../../utils/logger.js';
import { buildKpiRadarAlertJson, isDisabledLegacyBiCategory } from './run-data-auditor.js';

const log = childLogger({ domain: 'agent-auditor', handler: 'run-data-auditor-persist' });

export async function persistAuditorIssues(
  ctx,
  { issues, state, tenantId }
) {
  const { pool, normalizeStoreKey, findStoreManager } = ctx;
  let created = 0;
  const newIssueIds = [];
  for (const issue of issues) {
    try {
      if (isDisabledLegacyBiCategory(issue?.category)) {
        log.info({
          msg: 'skip_legacy_bi_issue',
          category: issue?.category,
          title: String(issue?.title || '').slice(0, 100),
        });
        continue;
      }
      const issueDate = String(issue.data?.date || '').trim();
      const auditeeRole = String(issue.data?._auditee_role || '').trim();
      const existing = await pool().query(
        `SELECT id FROM agent_issues
         WHERE store = $1 AND category = $2
           AND COALESCE(data->>'date','') = COALESCE($3,'')
           AND COALESCE(data->>'_auditee_role','') = COALESCE($4,'')
           AND (
             ($3 <> '' AND created_at > NOW() - INTERVAL '7 days')
             OR ($3 = '' AND created_at > NOW() - INTERVAL '24 hours')
           )
           AND tenant_id = $5
         LIMIT 1`,
        [issue.store, issue.category, issueDate, auditeeRole, tenantId]
      );
      if (existing.rows?.length) continue;

      let assignee = null;
      try {
        const roleMap = await getCategoryAssigneeRoleMap();
        const targetRole = auditeeRole || roleMap[issue.category] || 'store_manager';
        const normalizedStore = normalizeStoreKey(issue.store);
        const allUsers = [
          ...(Array.isArray(state?.employees) ? state.employees : []),
          ...(Array.isArray(state?.users) ? state.users : []),
        ];
        let assigneeUser = allUsers.find(
          (u) =>
            normalizeStoreKey(u?.store) === normalizedStore &&
            String(u?.role || '').trim() === targetRole
        );
        if (!assigneeUser && targetRole === 'store_production_manager') {
          assigneeUser = allUsers.find(
            (u) =>
              normalizeStoreKey(u?.store) === normalizedStore &&
              String(u?.role || '').trim() === 'store_manager'
          );
        }
        assignee = assigneeUser ? String(assigneeUser.username || '').trim() : null;
      } catch {
        assignee = await findStoreManager(state, issue.store);
      }
      const r = await pool().query(
        `INSERT INTO agent_issues (agent, brand, store, category, severity, title, detail, data, assignee_username, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
        [
          issue.agent,
          issue.brand,
          issue.store,
          issue.category,
          issue.severity,
          issue.title,
          issue.detail,
          JSON.stringify(issue.data),
          assignee,
          tenantId,
        ]
      );

      const radarPayload = buildKpiRadarAlertJson(issue);
      await pool().query(
        `INSERT INTO agent_messages (direction, channel, sender_name, routed_to, content_type, content, agent_data, tenant_id)
         VALUES ('out', 'system', 'BI Radar', 'master', 'kpi_radar_alert', $1, $2::jsonb, $3)`,
        [
          JSON.stringify(radarPayload),
          JSON.stringify({ route: 'master', kpiRadar: true, payload: radarPayload }),
          tenantId,
        ]
      );

      created++;
      if (r.rows?.[0]?.id) newIssueIds.push(r.rows[0].id);
    } catch (e) {
      log.error({ msg: 'insert_issue_failed', err: String(e?.message || e) });
    }
  }
  return { created, newIssueIds };
}
