/**
 * Knowledge base project-group operations.
 */
import path from 'path';
import fs from 'fs';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';
import {
  canViewerSeeKnowledgeAudience,
  normalizeKnowledgeGroupName,
} from './helpers.js';

const log = childLogger({ domain: 'knowledge', handler: 'groups' });

export async function resolveKnowledgeGroupName(pool, groupId, providedName, fallbackName) {
  const named = normalizeKnowledgeGroupName(providedName);
  if (named) return named;
  const gid = String(groupId || '').trim();
  if (gid) {
    try {
      const r = await pool.query(
        `SELECT group_name, title
         FROM knowledge_base
         WHERE group_id = $1::uuid
         ORDER BY updated_at DESC NULLS LAST, created_at ASC NULLS LAST
         LIMIT 1`,
        [gid]
      );
      const row = r.rows?.[0] || {};
      const existing = normalizeKnowledgeGroupName(row.group_name || row.title || '');
      if (existing) return existing;
    } catch (e) {
      log.warn({ msg: 'knowledge_resolve_group_name_failed', err: e?.message || e });
    }
  }
  return normalizeKnowledgeGroupName(fallbackName) || '未命名项目组';
}

export async function listKnowledgeGroups(ctx, { viewer }) {
  try {
    const r = await ctx.pool.query(
      `select id, group_id, group_name, title, category, tags, scope, audience, created_at, updated_at
       from knowledge_base
       order by updated_at desc nulls last, created_at desc nulls last`
    );
    const visible = (r.rows || []).filter(
      (row) => viewer.role === 'admin' || canViewerSeeKnowledgeAudience(viewer, row.audience)
    );
    const grouped = new Map();
    for (const row of visible) {
      const groupId = String(row?.group_id || '').trim();
      if (!groupId) continue;
      if (!grouped.has(groupId)) {
        grouped.set(groupId, {
          group_id: groupId,
          title: normalizeKnowledgeGroupName(row?.group_name || row?.title || '') || '未命名项目组',
          category: String(row?.category || '').trim(),
          tags: Array.isArray(row?.tags) ? row.tags : [],
          scope: String(row?.scope || '').trim(),
          file_count: 0,
          created_at: String(row?.created_at || ''),
          updated_at: String(row?.updated_at || ''),
        });
      }
      const entry = grouped.get(groupId);
      entry.file_count += 1;
      if (!entry.category && row?.category) entry.category = String(row.category || '').trim();
      if ((!entry.title || entry.title === '未命名项目组') && (row?.group_name || row?.title)) {
        entry.title = normalizeKnowledgeGroupName(row?.group_name || row?.title || '') || entry.title;
      }
      const updatedAt = String(row?.updated_at || '');
      const createdAt = String(row?.created_at || '');
      if (updatedAt && (!entry.updated_at || updatedAt > entry.updated_at)) entry.updated_at = updatedAt;
      if (createdAt && (!entry.created_at || createdAt < entry.created_at)) entry.created_at = createdAt;
    }
    const items = Array.from(grouped.values()).sort((a, b) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    );
    return { ok: true, items };
  } catch {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function getKnowledgeGroup(ctx, { viewer, groupId }) {
  groupId = String(groupId || '').trim();
  if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
  try {
    const r = await ctx.pool.query(
      `select id, title, content, category, tags, file_path, file_type, file_size, step_rubric, ai_explanation,
              created_by, version, created_at, updated_at, audience, group_id, group_name
       from knowledge_base where group_id = $1::uuid
       order by created_at asc`,
      [groupId]
    );
    const items = (r.rows || []).filter(
      (row) => viewer.role === 'admin' || canViewerSeeKnowledgeAudience(viewer, row.audience)
    );
    return { ok: true, items };
  } catch {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function putKnowledgeGroupId(ctx, { role, id, groupId }) {
  if (String(role || '') !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
  id = String(id || '').trim();
  groupId = String(groupId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  if (!groupId) return { ok: false, status: 400, error: 'missing_groupId' };
  try {
    const target = await ctx.pool.query(
      'SELECT 1 FROM knowledge_base WHERE group_id = $1::uuid LIMIT 1',
      [groupId]
    );
    if (!target.rows?.length) return { ok: false, status: 404, error: 'target_group_not_found' };
    const groupName = await resolveKnowledgeGroupName(ctx.pool, groupId, '', '');
    await ctx.pool.query(
      'UPDATE knowledge_base SET group_id = $1::uuid, group_name = $2, updated_at = NOW() WHERE id = $3::uuid',
      [groupId, groupName, id]
    );
    return { ok: true, success: true };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: String(e?.message || e) };
  }
}

export async function putGroupMeta(ctx, { role, groupId, body }) {
  if (String(role || '') !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
  groupId = String(groupId || '').trim();
  const groupName = normalizeKnowledgeGroupName(body?.groupName || body?.title || '');
  if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
  if (!groupName) return { ok: false, status: 400, error: 'missing_group_name' };
  try {
    const r = await ctx.pool.query(
      `UPDATE ${SHARED_TABLES.KNOWLEDGE_BASE}
       SET group_name = $2, updated_at = NOW()
       WHERE group_id = $1::uuid
       RETURNING id`,
      [groupId, groupName]
    );
    if (!r.rowCount) return { ok: false, status: 404, error: 'group_not_found' };
    return { ok: true, success: true, updated: Number(r.rowCount || 0), groupId, groupName };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: String(e?.message || e) };
  }
}

export async function deleteGroup(ctx, { role, groupId }) {
  if (String(role || '') !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
  groupId = String(groupId || '').trim();
  if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
  try {
    const r = await ctx.pool.query(
      `SELECT id, file_path
       FROM knowledge_base
       WHERE group_id = $1::uuid`,
      [groupId]
    );
    const rows = r.rows || [];
    if (!rows.length) return { ok: false, status: 404, error: 'group_not_found' };
    for (const row of rows) {
      const filePath = String(row?.file_path || '').trim();
      if (!filePath) continue;
      try {
        const relativePath = filePath.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
        const normalized = path.posix.normalize(relativePath).replace(/^\/+/, '');
        if (normalized && normalized !== '.' && !normalized.includes('..')) {
          const absolutePath = path.join(ctx.uploadsDir, normalized);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        }
      } catch (e) {
        log.warn({ msg: 'knowledge_group_delete_file_cleanup_failed', err: e?.message || String(e) });
      }
    }
    await ctx.pool.query('DELETE FROM knowledge_base WHERE group_id = $1::uuid', [groupId]);
    return { ok: true, deleted: rows.length };
  } catch (e) {
    log.error({ msg: 'delete_api_knowledge_group_groupid_error', err: e?.message || String(e) });
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
