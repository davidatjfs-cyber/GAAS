import { normalizeOpsRole } from './config.js';

export function createOpsTaskCreateHelpers({
  pool,
  safeDateOnly,
  getSharedState,
  resolveTenantIdDefault,
  getOpsManagedStores,
  resolveOpsStoreBrand,
  buildOpsTaskTemplates,
  getOpsStoreAssignee,
}) {
  async function createOpsTaskIfAbsent(input) {
    const dedupeKey = String(input?.dedupeKey || '').trim();
    if (!dedupeKey) return;
    await pool.query(
      `insert into ops_tasks (
        biz_date, store, brand, task_type, schedule_key, dedupe_key,
        title, instructions, checklist, required_photos,
        assignee_username, assignee_role, due_at, source, tenant_id
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
      on conflict (dedupe_key, tenant_id) do nothing`,
      [
        input.bizDate,
        input.store,
        input.brand || null,
        input.taskType,
        input.scheduleKey,
        dedupeKey,
        input.title,
        input.instructions || null,
        JSON.stringify(Array.isArray(input.checklist) ? input.checklist : []),
        Math.max(1, Number(input.requiredPhotos || 1)),
        input.assigneeUsername,
        normalizeOpsRole(input.assigneeRole),
        input.dueAt,
        'ops_agent',
        resolveTenantIdDefault()
      ]
    );
  }

  async function ensureOpsTasksForDate(dateStr) {
    const bizDate = safeDateOnly(dateStr);
    if (!bizDate) return;
    const state = (await getSharedState()) || {};
    const stores = getOpsManagedStores(state);
    for (const store of stores) {
      const brand = resolveOpsStoreBrand(state, store);
      if (!brand) continue;
      const templates = buildOpsTaskTemplates(store, brand, bizDate);
      for (const t of templates) {
        const assigneeUsername = getOpsStoreAssignee(state, store, t.assigneeRole);
        if (!assigneeUsername) continue;
        const dedupeKey = `${bizDate}||${store}||${t.scheduleKey}||${assigneeUsername}`;
        await createOpsTaskIfAbsent({
          bizDate,
          store,
          brand,
          taskType: t.taskType,
          scheduleKey: t.scheduleKey,
          dedupeKey,
          title: t.title,
          checklist: t.checklist,
          requiredPhotos: t.requiredPhotos,
          assigneeUsername,
          assigneeRole: t.assigneeRole,
          dueAt: t.dueAt,
          instructions: `${brand} · ${store}：请按检查项完成并上传照片。`
        });
      }
    }
  }

  return { createOpsTaskIfAbsent, ensureOpsTasksForDate };
}
