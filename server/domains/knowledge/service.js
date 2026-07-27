/**
 * Knowledge base — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { ragUpdateScope } from '../../rag-tool.js';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';
import {
  normalizeCreatedByUuid,
  normalizeKnowledgeGroupName,
  normalizeMultipartFilename,
  normalizeKnowledgeTags,
  parseKnowledgeAudienceFromBody,
  canViewerSeeKnowledgeAudience,
  resolveUploadsFile,
} from './helpers.js';
import { runCreateKnowledgeBackgroundBody } from './create-knowledge-background-helpers.js';
import { resolveKnowledgeGroupName } from './knowledge-groups.js';
export {
  deleteGroup,
  getKnowledgeGroup,
  listKnowledgeGroups,
  putGroupMeta,
  putKnowledgeGroupId,
} from './knowledge-groups.js';

const log = childLogger({ domain: 'knowledge', handler: 'service' });


export async function getKnowledgeFile(ctx, { id, getViewer }) {
  const { pool, uploadsDir } = ctx;
  id = String(id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  try {
    const r = await pool.query(
      `select file_path, file_type, audience
       from knowledge_base
       where id = $1
       limit 1`,
      [id]
    );
    const row = r.rows?.[0] || null;
    if (!row?.file_path) return { ok: false, status: 404, error: 'not_found' };
    try {
      const viewer = await getViewer();
      if (viewer.role !== 'admin' && !canViewerSeeKnowledgeAudience(viewer, row.audience)) {
        return { ok: false, status: 403, error: 'forbidden', message: '无权查看该知识库文件' };
      }
    } catch (e) {
      return { ok: false, status: 403, error: 'forbidden', message: '无权查看该知识库文件' };
    }

    const filePath = String(row.file_path || '').trim();
    const uploadsAbs = resolveUploadsFile(uploadsDir, filePath);
    if (uploadsAbs) {
      if (!fs.existsSync(uploadsAbs)) return { ok: false, status: 404, error: 'not_found' };
      return {
        ok: true,
        delivery: 'local',
        absPath: uploadsAbs,
        fileType: String(row.file_type || '').trim(),
      };
    }

    if (!/^https?:\/\//i.test(filePath)) {
      return { ok: false, status: 400, error: 'invalid_file_path' };
    }
    return { ok: true, delivery: 'remote', filePath };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}


export async function listKnowledge(ctx, { viewer, query }) {
  const pool = ctx.pool;
  const buildKnowledgeBrandScopeTag = ctx.buildKnowledgeBrandScopeTag;

    try {
      /* viewer from input */
      const qBrand = buildKnowledgeBrandScopeTag(query?.brandId || query?.brandScope || 'all');
      const withBrandFilter = qBrand && qBrand !== 'brand:all';
      const r = await pool.query(
        `select id, title, category, tags, scope, file_path, file_type, file_size, access_roles, access_departments, created_by, step_rubric, version, created_at, updated_at, audience, group_id, group_name
         from knowledge_base
         ${withBrandFilter ? 'where tags @> $1::text[] or tags @> ARRAY[\'brand:all\']::text[]' : ''}
         order by created_at desc`,
        withBrandFilter ? [[qBrand]] : []
      );
      const rows = (r.rows || []).filter(
        (row) => viewer.role === 'admin' || canViewerSeeKnowledgeAudience(viewer, row.audience)
      );
      return { ok: true, items: rows };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


export async function getKnowledgeContent(ctx, { viewer, id }) {
  const pool = ctx.pool;

    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      /* viewer from input */
      const r = await pool.query(
        'select id, content, audience from knowledge_base where id = $1::uuid limit 1',
        [id]
      );
      const row = r.rows?.[0];
      if (!row) return { ok: false, status: 404, error: 'not_found' };
      if (String(viewer.role || '') !== 'admin' && !canViewerSeeKnowledgeAudience(viewer, row.audience)) {
        return { ok: false, status: 403, error: 'forbidden' };
      }
      return { ok: true, content: String(row.content || '') };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/invalid input syntax for type uuid/i.test(msg)) {
        return { ok: false, status: 400, error: 'invalid_id' };
      }
      return { ok: false, status: 500, error: 'server_error', message: msg };
    }
  
}


export { getKnowledgeExplanation, putKnowledgeExplanation, reformatExplanation, regenerateExplanation } from './explanations.js';


export async function deleteKnowledge(ctx, { role, id }) {
  const pool = ctx.pool;
  const uploadsDir = ctx.uploadsDir;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      // 先查 file_path，尝试删除磁盘文件（文件不存在也不报错）
      const r = await pool.query('SELECT file_path FROM knowledge_base WHERE id = $1 LIMIT 1', [id]);
      const row = r.rows?.[0];
      if (!row) return { ok: false, status: 404, error: 'not_found' };

      const filePath = String(row.file_path || '').trim();
      if (filePath) {
        try {
          const rel = filePath.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
          const normalized = path.posix.normalize(rel).replace(/^\/+/, '');
          if (normalized && normalized !== '.' && !normalized.includes('..')) {
            const abs = path.join(uploadsDir, normalized);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          }
        } catch (e) {
          log.warn({ msg: 'knowledge_delete_file_cleanup_failed', err: e?.message || String(e) });
        }
      }

      await pool.query('DELETE FROM knowledge_base WHERE id = $1', [id]);
      return { ok: true, ok: true };
    } catch (e) {
      log.error({ msg: 'delete_api_knowledge_id_error', err: e?.message || String(e) });
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


export async function putKnowledge(ctx, { role, id, body, username }) {
  const pool = ctx.pool;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };

    const { title, category, audience, scope, tags, version, content } = body || {};
    const groupNameRaw = Object.prototype.hasOwnProperty.call(body || {}, 'groupName')
      ? body?.groupName
      : undefined;
    const groupName = groupNameRaw === undefined ? undefined : normalizeKnowledgeGroupName(groupNameRaw);
    const sets = [];
    const params = [];
    let idx = 1;

    if (title !== undefined) { sets.push(`title = $${idx}`); params.push(String(title).trim()); idx++; }
    if (content !== undefined) { sets.push(`content = $${idx}`); params.push(String(content)); idx++; }
    if (category !== undefined) { sets.push(`category = $${idx}`); params.push(String(category).trim() || null); idx++; }
    if (scope !== undefined && ['public','business','sensitive'].includes(scope)) { sets.push(`scope = $${idx}`); params.push(scope); idx++; }
    if (version !== undefined) { sets.push(`version = $${idx}`); params.push(String(version).trim() || null); idx++; }
    if (tags !== undefined && Array.isArray(tags)) { sets.push(`tags = $${idx}`); params.push(tags); idx++; }
    if (audience !== undefined) {
      const audObj = (typeof audience === 'object' && audience !== null && !Array.isArray(audience)) ? audience : { type: 'all' };
      sets.push(`audience = $${idx}::jsonb`);
      params.push(JSON.stringify(audObj));
      idx++;
      const accessRoles = [];
      const accessDepts = [];
      if (audObj.type === 'store' && Array.isArray(audObj.stores)) {
        accessDepts.push(...audObj.stores);
        if (audObj.store) accessDepts.push(audObj.store);
      }
      if (audObj.type === 'position' && Array.isArray(audObj.positions)) {
        accessRoles.push(...audObj.positions);
        if (audObj.position) accessRoles.push(audObj.position);
      }
      if (accessRoles.length || accessDepts.length) {
        if (accessRoles.length) { sets.push(`access_roles = $${idx}`); params.push(accessRoles); idx++; }
        if (accessDepts.length) { sets.push(`access_departments = $${idx}`); params.push(accessDepts); idx++; }
      }
    }

    if (!sets.length) return { ok: false, status: 400, error: 'no_fields_to_update' };
    sets.push(`updated_at = now()`);
    params.push(id);

    try {
      let targetGroupId = '';
      if (groupNameRaw !== undefined) {
        if (!groupName) return { ok: false, status: 400, error: 'missing_group_name' };
        const groupLookup = await pool.query('SELECT group_id FROM knowledge_base WHERE id = $1::uuid LIMIT 1', [id]);
        targetGroupId = String(groupLookup.rows?.[0]?.group_id || '').trim();
      }
      let oldContent;
      if (content !== undefined) {
        const prev = await pool.query('SELECT content FROM knowledge_base WHERE id = $1::uuid LIMIT 1', [id]);
        oldContent = prev.rows?.[0]?.content || null;
      }
      const r = await pool.query(
        `UPDATE ${SHARED_TABLES.KNOWLEDGE_BASE} SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, title, category, tags, scope, file_path, file_type, file_size, access_roles, access_departments, created_by, version, created_at, updated_at, audience, group_id, group_name`,
        params
      );
      const row = r.rows?.[0];
      if (!row) return { ok: false, status: 404, error: 'not_found' };
      if (content !== undefined) {
        await pool.query(
          `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
           VALUES ($1::uuid, 'content', $2, $3, $4, $5, $6)`,
          [id, oldContent, content, username || null, role || null, resolveTenantIdDefault()]
        ).catch((e) => log.error({ msg: 'knowledge_edit_history_content_failed', err: e?.message }));
      }
      if (targetGroupId && groupName) {
        await pool.query(
          `UPDATE ${SHARED_TABLES.KNOWLEDGE_BASE}
           SET group_name = $2, updated_at = NOW()
           WHERE group_id = $1::uuid`,
          [targetGroupId, groupName]
        );
        row.group_name = groupName;
      }
      return { ok: true, item: row };
    } catch (e) {
      log.error({ msg: 'put_api_knowledge_id_error', err: e?.message || String(e) });
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


export async function batchUploadKnowledge(ctx, { role, files, body, username, userId, tenantId }) {
  const pool = ctx.pool;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;
  const recordUploadOwnership = ctx.recordUploadOwnership;
  const inferContentType = ctx.inferContentType;
  const buildInlineContentDisposition = ctx.buildInlineContentDisposition;
  const getCosClient = ctx.getCosClient;
  const getOssClient = ctx.getOssClient;
  const buildCosPublicUrl = ctx.buildCosPublicUrl;
  const buildOssPublicUrl = ctx.buildOssPublicUrl;
  const COS_BUCKET = ctx.COS_BUCKET;
  const COS_REGION = ctx.COS_REGION;
  const OSS_PART_SIZE_MB = ctx.OSS_PART_SIZE_MB;
  const OSS_PARALLEL = ctx.OSS_PARALLEL;
  const OSS_RETRY_COUNT = ctx.OSS_RETRY_COUNT;
  const OSS_TIMEOUT_MS = ctx.OSS_TIMEOUT_MS;
  const buildKnowledgeBrandScopeTag = ctx.buildKnowledgeBrandScopeTag;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    files = files || [];
    if (!files.length) return { ok: false, status: 400, error: 'missing_files' };

    const title = String(body?.title || '').trim();
    const category = String(body?.category || '').trim();
    const feedAgent = String(body?.feedAgent || '').trim();
    const brandScopeTag = buildKnowledgeBrandScopeTag(body?.brandId || body?.brandScope || 'all');
    const tags = normalizeKnowledgeTags(body?.tags, feedAgent, brandScopeTag);
    const kbScope = ['public','business','sensitive'].includes(body?.scope) ? body.scope : 'public';
    const version = String(body?.version || '').trim() || null;
    const batchTitleMode = ['filename', 'custom'].includes(String(body?.batchTitleMode || '').trim())
      ? String(body?.batchTitleMode || '').trim()
      : 'filename';
    const customPrefix = String(body?.customPrefix || '').trim();
    const audienceObj = parseKnowledgeAudienceFromBody(body);
    let groupId = String(body?.groupId || '').trim();
    const requestedGroupName = normalizeKnowledgeGroupName(body?.groupName || body?.group_name || '');
    if (!groupId || groupId === 'new') groupId = '';
    let useGroupId = groupId || null;
    if (!useGroupId && title) {
      const existing = await pool.query('SELECT group_id FROM knowledge_base WHERE title = $1 ORDER BY created_at DESC LIMIT 1', [title]);
      if (existing.rows?.[0]?.group_id) useGroupId = existing.rows[0].group_id;
    }
    if (!useGroupId) useGroupId = randomUUID();
    const useGroupName = await resolveKnowledgeGroupName(pool, 
      useGroupId,
      requestedGroupName,
      title || customPrefix || category || '未命名项目组'
    );
    if (!category) return { ok: false, status: 400, error: 'missing_category' };
    if (!feedAgent) return { ok: false, status: 400, error: 'missing_feed_agent' };

    const createdBy = normalizeCreatedByUuid(userId);
    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const normalizedOriginalName = normalizeMultipartFilename(String(f.originalname || ''));
      let fileTitle = title || String(normalizedOriginalName || '').replace(/\.[^.]+$/, '');
      if (batchTitleMode === 'filename') {
        fileTitle = String(normalizedOriginalName || '').replace(/\.[^.]+$/, '');
      } else if (batchTitleMode === 'custom' && customPrefix) {
        fileTitle = customPrefix + (files.length > 1 ? ` (${i + 1}/${files.length})` : '');
      }
      const fileType = String(body?.type || '').trim() || String(f.mimetype || '').trim();
      const size = Number(f.size || 0);
      const filePath = `/uploads/${f.filename}`;

      try {
        const r = await pool.query(
          `insert into ${SHARED_TABLES.KNOWLEDGE_BASE} (title, content, category, tags, file_path, file_type, file_size, access_roles, access_departments, created_by, scope, version, audience, group_id, group_name, tenant_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::uuid,$15,$16)
           returning id, title, category, tags, scope, file_path, file_type, file_size, access_roles, access_departments, created_by, version, created_at, updated_at, audience, group_id, group_name`,
          [fileTitle, '', category || null, tags, filePath, fileType || null, size || null, null, null, createdBy, kbScope, version, audienceObj, useGroupId, useGroupName, resolveTenantIdDefault()]
        );
        results.push(r.rows?.[0] || null);
        await recordUploadOwnership(f.filename, tenantId, username);

        (async (insertedId, localPath, originalName, mimeType) => {
          try {
            if (!localPath || !insertedId) return;
            const ext = path.extname(originalName).slice(0, 16);
            const tenantForKey = String(tenantId || 'default').trim() || 'default';
            const objectKey = `hrms/knowledge/${tenantForKey}/${randomUUID()}${ext}`;
            const contentType = inferContentType({ declaredType: body?.type, originalName, mimeType });
            let finalUrl = '';
            const cos = getCosClient();
            if (cos) {
              await new Promise((resolve, reject) => {
                cos.sliceUploadFile({ Bucket: COS_BUCKET, Region: COS_REGION, Key: objectKey, FilePath: localPath }, (err) => err ? reject(err) : resolve());
              });
              try {
                await new Promise((resolve, reject) => {
                  cos.putObjectCopy({ Bucket: COS_BUCKET, Region: COS_REGION, Key: objectKey, CopySource: `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${objectKey}`, MetadataDirective: 'Replaced', ContentType: contentType, ContentDisposition: buildInlineContentDisposition(originalName) }, (err) => err ? reject(err) : resolve());
                });
              } catch (e2) { /* ignore */ }
              finalUrl = buildCosPublicUrl(objectKey) || '';
            } else {
              const oss = getOssClient();
              if (oss) {
                await oss.multipartUpload(objectKey, localPath, { partSize: Math.max(1, OSS_PART_SIZE_MB) * 1024 * 1024, parallel: Math.max(1, OSS_PARALLEL), retryCount: Math.max(0, OSS_RETRY_COUNT), timeout: Math.max(10000, OSS_TIMEOUT_MS), headers: { 'Content-Type': contentType, 'Content-Disposition': buildInlineContentDisposition(originalName) } });
                finalUrl = buildOssPublicUrl(objectKey) || '';
              }
            }
            if (finalUrl) {
              await pool.query('update knowledge_base set file_path = $1, updated_at = now() where id = $2', [finalUrl, insertedId]);
              try { fs.unlinkSync(localPath); } catch (e) { /* ignore */ }
            }
          } catch (e) {
            log.warn({
              msg: 'knowledge_batch_cloud_upload_failed',
              knowledge_id: insertedId,
              err: e?.message || String(e),
            });
          }
        })(r.rows?.[0]?.id, String(f.path || ''), String(normalizedOriginalName || ''), String(f.mimetype || ''));
      } catch (e) {
        errors.push({ file: normalizedOriginalName || String(f.originalname || ''), error: 'internal_error' });
      }
    }

    return { ok: true, items: results, errors, total: files.length, succeeded: results.length, failed: errors.length };
  
}


export async function putKnowledgeScope(ctx, { role, id, scope }) {
  if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) return { ok: false, status: 403, error: 'forbidden' };
  const result = await ragUpdateScope(id, scope);
  // Preserve original: always HTTP 200 with ragUpdateScope payload as-is
  return { ok: true, passthrough: result };
}


export async function presignKnowledge(ctx, { role, body, tenantId }) {
  const inferContentType = ctx.inferContentType;
  const buildInlineContentDisposition = ctx.buildInlineContentDisposition;
  const getOssClient = ctx.getOssClient;
  const buildOssPublicUrl = ctx.buildOssPublicUrl;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'forbidden' };
    }

    const oss = getOssClient();
    if (!oss) return { ok: false, status: 500, error: 'oss_not_configured' };

    const originalName = String(body?.originalName || 'file').trim() || 'file';
    const declaredType = String(body?.type || '').trim();
    const mimeType = String(body?.mimeType || '').trim();
    const size = Number(body?.size || 0);

    try {
      const ext = path.extname(originalName).slice(0, 16);
      const tenantForKey = String(tenantId || 'default').trim() || 'default';
      const objectKey = `hrms/knowledge/${tenantForKey}/${randomUUID()}${ext}`;
      const contentType = inferContentType({ declaredType, originalName, mimeType });
      const disposition = buildInlineContentDisposition(originalName);

      const signedUrl = oss.signatureUrl(objectKey, {
        method: 'PUT',
        expires: 60 * 20,
        'Content-Type': contentType,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': disposition
        }
      });
      const publicUrl = buildOssPublicUrl(objectKey);
      return { ok: true, objectKey,
        publicUrl,
        signedUrl,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': disposition
        },
        size };
    } catch (e) {
      return { ok: false, status: 500, error: 'presign_failed', message: 'internal_error' };
    }
  
}


export async function directCreateKnowledge(ctx, { role, body, userId }) {
  const pool = ctx.pool;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;
  const buildKnowledgeBrandScopeTag = ctx.buildKnowledgeBrandScopeTag;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'forbidden' };
    }

    const title = String(body?.title || '').trim();
    const category = String(body?.category || '').trim();
    const fileType = String(body?.type || '').trim();
    const feedAgent = String(body?.feedAgent || '').trim();
    const brandScopeTag = buildKnowledgeBrandScopeTag(body?.brandId || body?.brandScope || 'all');
    const tags = normalizeKnowledgeTags(body?.tags, feedAgent, brandScopeTag);
    const filePath = String(body?.filePath || '').trim();
    const size = Number(body?.size || 0);
    const version = String(body?.version || '').trim() || null;
    const videoSummary = fileType === 'video' ? String(body?.videoSummary || '').trim() : '';
    let groupId = String(body?.groupId || '').trim();
    const requestedGroupName = normalizeKnowledgeGroupName(body?.groupName || body?.group_name || '');
    if (!groupId || groupId === 'new') groupId = '';

    if (!title) return { ok: false, status: 400, error: 'missing_title' };
    if (!category) return { ok: false, status: 400, error: 'missing_category' };
    if (!filePath) return { ok: false, status: 400, error: 'missing_file_path' };

    try {
      const createdBy = normalizeCreatedByUuid(userId);
      const kbScope = ['public','business','sensitive'].includes(body?.scope) ? body.scope : 'public';
      const audienceObj = parseKnowledgeAudienceFromBody(body);
      let useGroupId = groupId || null;
      if (!useGroupId && title) {
        const existing = await pool.query('SELECT group_id FROM knowledge_base WHERE title = $1 ORDER BY created_at DESC LIMIT 1', [title]);
        if (existing.rows?.[0]?.group_id) useGroupId = existing.rows[0].group_id;
      }
      if (!useGroupId) useGroupId = randomUUID();
      const useGroupName = await resolveKnowledgeGroupName(pool, useGroupId, requestedGroupName, title || category || '未命名项目组');
      const r = await pool.query(
        `insert into ${SHARED_TABLES.KNOWLEDGE_BASE} (title, content, category, tags, file_path, file_type, file_size, access_roles, access_departments, created_by, scope, version, audience, group_id, group_name, tenant_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::uuid,$15,$16)
         returning id, title, category, tags, scope, file_path, file_type, file_size, access_roles, access_departments, created_by, version, created_at, updated_at, audience, group_id, group_name`,
        [title, videoSummary, category || null, tags, filePath, fileType || null, size || null, null, null, createdBy, kbScope, version, audienceObj, useGroupId, useGroupName, resolveTenantIdDefault()]
      );
      return { ok: true, item: r.rows?.[0] || null };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


export async function createKnowledge(ctx, { role, body, file, userId, username, tenantId }) {
  const pool = ctx.pool;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;
  const uploadsDir = ctx.uploadsDir;
  const recordUploadOwnership = ctx.recordUploadOwnership;
  const buildKnowledgeBrandScopeTag = ctx.buildKnowledgeBrandScopeTag;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'forbidden' };
    }

    const title = String(body?.title || '').trim();
    const category = String(body?.category || '').trim();
    const feedAgent = String(body?.feedAgent || '').trim();
    const brandScopeTag = buildKnowledgeBrandScopeTag(body?.brandId || body?.brandScope || 'all');
    const tags = normalizeKnowledgeTags(body?.tags, feedAgent, brandScopeTag);
    const fileType = String(body?.type || '').trim() || String(file?.mimetype || '').trim();
    const size = Number(file?.size || 0);
    const version = String(body?.version || '').trim() || null;
    const videoSummary = fileType === 'video' ? String(body?.videoSummary || '').trim() : '';
    let groupId = String(body?.groupId || '').trim();
    const requestedGroupName = normalizeKnowledgeGroupName(body?.groupName || body?.group_name || '');
    if (!groupId || groupId === 'new') groupId = '';

    const localPath = file ? path.join(uploadsDir, file.filename) : '';
    if (!localPath || !fs.existsSync(localPath)) {
      return { ok: false, status: 400, error: 'file_not_found' };
    }

    let inserted = null;
    const audienceObj = parseKnowledgeAudienceFromBody(body);
    try {
      const createdBy = normalizeCreatedByUuid(userId);
      const kbScope = ['public','business','sensitive'].includes(body?.scope) ? body.scope : 'public';
      let useGroupId = groupId || null;
      if (!useGroupId && title) {
        const existing = await pool.query('SELECT group_id FROM knowledge_base WHERE title = $1 ORDER BY created_at DESC LIMIT 1', [title]);
        if (existing.rows?.[0]?.group_id) useGroupId = existing.rows[0].group_id;
      }
      if (!useGroupId) useGroupId = randomUUID();
      const useGroupName = await resolveKnowledgeGroupName(pool, useGroupId, requestedGroupName, title || category || '未命名项目组');
      const r = await pool.query(
        `insert into ${SHARED_TABLES.KNOWLEDGE_BASE} (title, content, category, tags, file_path, file_type, file_size, access_roles, access_departments, created_by, scope, version, audience, group_id, group_name, tenant_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::uuid,$15,$16)
         returning id, title, category, tags, scope, file_path, file_type, file_size, access_roles, access_departments, created_by, version, created_at, updated_at, audience, group_id, group_name`,
        [title, videoSummary, category || null, tags, `uploads/${file.filename}`, fileType || null, size || null, null, null, createdBy, kbScope, version, audienceObj, useGroupId, useGroupName, resolveTenantIdDefault()]
      );
      inserted = r.rows?.[0] || null;
      await recordUploadOwnership(file.filename, tenantId, username);
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }

    
    return { ok: true, item: inserted, queued: true, background: {
      inserted,
      localPath,
      title,
      body,
      file,
      tenantId,
    }};

}


export async function runCreateKnowledgeBackground(ctx, payload) {
  return runCreateKnowledgeBackgroundBody(ctx, payload);
}
