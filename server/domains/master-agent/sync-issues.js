/**
 * Sync data_auditor agent_issues → master_tasks (P4 peel from master-agent.js).
 */
import { classifySkippedAuditorIssue } from './sync-issues-helpers.js';

/**
 * @param {{
 *   pool: () => { query: Function },
 *   log: { info: Function, error: Function },
 *   createTask: Function,
 * }} deps
 */
export function createSyncDataAuditorIssues(deps) {
  const { pool, log, createTask } = deps;

  return async function syncDataAuditorIssuesToMasterTasks(newIssueIds, tenantId = 'default') {
    if (!newIssueIds?.length) return 0;
    let created = 0;
    for (const issueId of newIssueIds) {
      try {
        const ir = await pool().query(
          `SELECT * FROM agent_issues WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [String(issueId), tenantId]
        );
        const issue = ir.rows?.[0];
        if (!issue) continue;

        const skip = classifySkippedAuditorIssue(issue);
        const cat = String(issue.category || '');
        const ttl = String(issue.title || '');
        if (skip === 'legacy_bi') {
          log.info('[master:data_auditor] skip deprecated anomaly → master_tasks', issueId, cat, ttl.slice(0, 80));
          continue;
        }
        if (skip === 'material') {
          log.info('[master:data_auditor] skip deprecated material issue → master_tasks', issueId, ttl.slice(0, 80));
          continue;
        }

        const dup = await pool().query(
          `SELECT id FROM master_tasks WHERE source_ref = $1 AND source = 'data_auditor' AND tenant_id = $2 LIMIT 1`,
          [String(issueId), tenantId]
        );
        if (dup.rows?.length) continue;

        const taskId = await createTask({
          source: 'data_auditor',
          sourceRef: String(issueId),
          category: issue.category,
          severity: issue.severity,
          store: issue.store,
          brand: issue.brand,
          title: issue.title,
          detail: issue.detail,
          sourceData: issue.data,
        }, tenantId);
        if (taskId) created += 1;
      } catch (e) {
        log.error('[master:data_auditor] Failed to sync issue to master_tasks:', e?.message);
      }
    }
    if (created > 0) log.info(`[master:data_auditor] Created ${created} new tasks`);
    return created;
  };
}
