/**
 * Knowledge base — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { ragUpdateScope } from '../../rag-tool.js';
import { SHARED_TABLES } from '@gaas/shared';
import {
  normalizeCreatedByUuid,
  normalizeKnowledgeGroupName,
  normalizeMultipartFilename,
  normalizeKnowledgeTags,
  parseKnowledgeAudienceFromBody,
  canViewerSeeKnowledgeAudience,
  resolveUploadsFile,
} from './helpers.js';

async function resolveKnowledgeGroupName(pool, groupId, providedName, fallbackName) {
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
      console.warn('[knowledge] resolve group name failed:', e?.message || e);
    }
  }
  return normalizeKnowledgeGroupName(fallbackName) || '未命名项目组';
}


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


export async function listKnowledgeGroups(ctx, { viewer }) {
  const pool = ctx.pool;

    try {
      /* viewer from input */
      const r = await pool.query(
        `select id, group_id, group_name, title, category, tags, scope, audience, created_at, updated_at
         from knowledge_base
         order by updated_at desc nulls last, created_at desc nulls last`
      );
      const visible = (r.rows || []).filter(
        (row) => viewer.role === 'admin' || canViewerSeeKnowledgeAudience(viewer, row.audience)
      );
      const grouped = new Map();
      for (const row of visible) {
        const gid = String(row?.group_id || '').trim();
        if (!gid) continue;
        if (!grouped.has(gid)) {
          grouped.set(gid, {
            group_id: gid,
            title: normalizeKnowledgeGroupName(row?.group_name || row?.title || '') || '未命名项目组',
            category: String(row?.category || '').trim(),
            tags: Array.isArray(row?.tags) ? row.tags : [],
            scope: String(row?.scope || '').trim(),
            file_count: 0,
            created_at: String(row?.created_at || ''),
            updated_at: String(row?.updated_at || '')
          });
        }
        const entry = grouped.get(gid);
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
      const items = Array.from(grouped.values()).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


export async function getKnowledgeGroup(ctx, { viewer, groupId }) {
  const pool = ctx.pool;

    groupId = String(groupId || '').trim();
    if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
    try {
      /* viewer from input */
      const r = await pool.query(
        `select id, title, content, category, tags, file_path, file_type, file_size, step_rubric, ai_explanation,
                created_by, version, created_at, updated_at, audience, group_id, group_name
         from knowledge_base where group_id = $1::uuid
         order by created_at asc`,
        [groupId]
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


export async function getKnowledgeExplanation(ctx, { role, id }) {
  const pool = ctx.pool;
  const callLLM = ctx.callLLM;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      const r = await pool.query(
        'SELECT id, title, content, file_type, ai_explanation, ai_explanation_locked, step_rubric FROM knowledge_base WHERE id = $1::uuid AND enabled = true LIMIT 1',
        [id]
      );
      const row = r.rows?.[0];
      if (!row) return { ok: false, status: 404, error: 'not_found' };
      const rubric = row.step_rubric || null;
      // 锁定状态：管理员手动编辑后锁定，直接返回已有内容，不触发自动生成
      if (row.ai_explanation_locked) {
        return { ok: true, success: true, explanation: row.ai_explanation || '', cached: true, locked: true, rubric };
      }
      if (row.ai_explanation && String(row.ai_explanation).trim().length > 50) {
        return { ok: true, success: true, explanation: row.ai_explanation, cached: true, rubric };
      }
      const rawContent = String(row.content || '').trim();
      // 图片/视频文件无文字内容但可能有图谱，有图谱时不报 no_content
      const isMediaFile = ['img', 'video', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(String(row.file_type || '').toLowerCase());
      if ((!rawContent || rawContent.length < 20) && !isMediaFile) {
        return { ok: true, success: false, error: 'no_content', message: '此文档暂无文字内容，无法生成AI解析', rubric };
      }
      if ((!rawContent || rawContent.length < 20) && isMediaFile) {
        // 媒体文件：只返回图谱（如果有），不调用文字LLM
        if (rubric) return { ok: true, success: true, explanation: null, cached: false, rubric };
        return { ok: true, success: false, error: 'no_content', message: '图片/视频文件请点击「生成步骤图谱」生成AI评分标准', rubric: null };
      }
      // 手册/教材类：多章节综合文档，不能套单一SOP模板
      const titleAndHead = row.title + rawContent.slice(0, 800);
      const isHandbook = /体系手册|培训手册|培训教材|培训体系|操作手册|培训大纲|岗位手册|综合.*培训/.test(titleAndHead);
      // 真正的单操作SOP：含SOP结构词且不是综合手册
      const isSopContent = !isHandbook && /SOP|标准操作|工序|步骤\s*\d|操作动作|质量标准|常见失败|补救/.test(rawContent);
      // 超长文档截断：25000字以内，加截断提示
      const MAX_CONTENT = 25000;
      const contentForPrompt = rawContent.length > MAX_CONTENT
        ? rawContent.slice(0, MAX_CONTENT) + `\n\n【注：原文共${rawContent.length}字，以上为前${MAX_CONTENT}字节选，请基于已有内容完整生成解析】`
        : rawContent;

      let sysPrompt, userPrompt;
      if (isSopContent || isMediaFile) {
        sysPrompt = '你是一名餐饮培训标准制定专家，把操作规程转化成厨房SOP格式培训材料。输出时严格遵守给定结构，不添加多余内容。';
        userPrompt = `请根据以下原始内容，输出严格对齐厨房SOP格式的标准培训解析。每步必须包含：操作动作、质量标准、常见失败、补救措施、是否为关键步骤。

【原始SOP内容】
${contentForPrompt}

请严格按以下结构输出（保留 ## 标题符号）：

## 🍳 工序：${row.title}

## 📋 SOP步骤分解
按原始内容的步骤顺序，每一步用以下格式输出：

### 步骤N：操作动作名称

> **关键步骤**：是/否

- **操作动作**：具体做什么，一线员工能直接照着做的动作描述
- **质量标准**：做到什么程度算合格（可视化可判定）
- **⏱ 建议时长**：N分钟

> **常见失败**：可能会出什么问题

> **补救措施**：出了问题怎么办

### 步骤N+1：...

---

## ⚠️ 一票否决项
列出3-5条绝对不能出现的情况（出现任一即不合格）：

## ✅ 关键记忆
用"到岗→操作→复核"格式的口诀，帮助员工快速记住核心流程。

输出语言：简体中文。不要添加任何开场白或结尾语，直接从"## 🍳 工序"开始输出。`;
      } else if (isHandbook) {
        sysPrompt = '你是一名餐饮人力资源培训专家，负责把综合培训手册转化为结构清晰的管理解析材料。输出时严格忠实原文，不虚构内容，不添加多余内容。';
        userPrompt = `这是一份涵盖多个岗位/多个章节的综合培训手册，请按以下结构生成解析，必须忠实原文内容，不得虚构或替换。

【文件标题】${row.title}

【原始内容】
${contentForPrompt}

请严格按以下结构输出（保留 ## 标题符号）：

## 📌 手册定位
用2-3句话说清楚：这份手册面向谁？覆盖哪些岗位？核心目标是什么？

## 🗂️ 内容框架
按原文章节结构，列出各章节/各岗位的培训模块，每条注明：模块名称 → 核心培训内容（1行概括）

## 📖 各岗位/章节详细解析
严格按原文每个章节/岗位逐一展开，格式如下：

### [章节/岗位名称]
**培训目标**：…
**核心技能/知识点**：列出原文要求的具体内容（含数字、标准、时限等）
**考核标准**：原文中的考核/验收要求
**晋升路径**（如有）：原文中的晋升条件

（按实际章节数量重复，有几个写几个，不要合并）

## ⚠️ 重要制度 & 红线
原文中的纪律要求、不合格标准、强制性规定（用"- "列出，不得自行添加）

## ✅ 使用指南
这份手册如何配合日常培训使用？新员工/管理者分别应关注哪几章？

输出语言：简体中文。忠实原文，不虚构内容，不要添加开场白，直接从"## 📌 手册定位"开始输出。`;
      } else {
        sysPrompt = '你是一名餐饮培训导师，负责把培训文档转化为员工可直接使用的学习材料。输出时严格遵守给定结构，不添加开场白，不输出"好的"、"没问题"等多余内容。';
        userPrompt = `你是一名经验丰富的餐饮培训导师，正在为餐厅一线员工制作培训材料。

【培训文章标题】${row.title}

【原始内容】
${contentForPrompt}

请根据以上内容，生成一份**结构清晰、内容完整、实用性强**的培训解析。核心要求：
- ⚠️ 原始内容中所有的具体数字、温度、时间、百分比、克重等量化数据**必须完整保留**，不得省略或模糊化
- ⚠️ 原始内容中每个具体的操作方法、标准、步骤**必须完整展开**，不能只写标题不写内容
- 语言可以口语化，但技术细节和标准数据必须一字不差保留
- 每个操作流程用数字编号，让员工照着做

请严格按以下结构输出（保留 ## 标题符号）：

## 📌 一句话总结
用一两句话说清楚这篇培训的核心是什么，让员工知道学完能干什么。

## 🎯 必须掌握的要点
列出3-6条最关键的知识点或操作步骤，每条单独一行，用"- "开头，简短有力。

## 📖 详细讲解
把原始内容的每个章节/每个知识点**完整展开**，结合实际工作场景说明。
- 对于每个大要点，列出所有子步骤和具体操作（不能只写标题）
- 所有具体数字、温度、出成率、时间等必须写出来
- 遇到操作流程按 1、2、3 步骤详细列出
- 每个大要点之间用空行分隔，加粗大要点标题

## ⚠️ 常见错误 & 注意事项
列出3-5条实际工作中容易犯的错误或被忽视的细节，用"- "开头。结合具体场景说明后果。

## ✅ 记住这几点就够了
用4-6条口诀或行动清单（含关键数字），帮助员工快速记住核心内容。

输出语言：简体中文。不要添加任何开场白或结尾语，直接从"## 📌 一句话总结"开始输出。`;
      }
      const aiResp = await callLLM([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt }
      ], { max_tokens: 6000 });
      const explanation = String(aiResp?.content || '').trim();
      if (!explanation || explanation.length < 50) {
        return { ok: true, success: false, error: 'ai_failed', message: 'AI生成失败，请稍后重试' };
      }
      await pool.query('UPDATE knowledge_base SET ai_explanation = $1, updated_at = NOW() WHERE id = $2::uuid', [explanation, id]);
      return { ok: true, success: true, explanation, cached: false, rubric };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/invalid input syntax for type uuid/i.test(msg)) return { ok: false, status: 400, error: 'invalid_id' };
      console.error('[knowledge] explanation error:', msg);
      return { ok: false, status: 500, error: 'server_error', message: msg };
    }
  
}


export async function putKnowledgeExplanation(ctx, { role, id, explanation, username }) {
  const pool = ctx.pool;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    explanation = String(explanation || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    if (!explanation) return { ok: false, status: 400, error: 'missing_explanation' };
    try {
      const prev = await pool.query('SELECT ai_explanation FROM knowledge_base WHERE id = $1::uuid LIMIT 1', [id]);
      const oldVal = prev.rows?.[0]?.ai_explanation || null;
      // 手动保存同时设置锁定，防止后续自动生成覆盖管理员精修的内容
      await pool.query('UPDATE knowledge_base SET ai_explanation = $1, ai_explanation_locked = true, updated_at = NOW() WHERE id = $2::uuid', [explanation, id]);
      await pool.query(
        `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
         VALUES ($1::uuid, 'ai_explanation', $2, $3, $4, $5, $6)`,
        [id, oldVal, explanation, username || null, role || null, resolveTenantIdDefault()]
      ).catch((e) => console.error('[knowledge] edit-history(explanation) failed:', e?.message));
      return { ok: true, success: true, locked: true };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: String(e?.message || e) };
    }
  
}


export async function reformatExplanation(ctx, { role, id, username }) {
  const pool = ctx.pool;
  const callLLM = ctx.callLLM;
  const resolveTenantIdDefault = ctx.resolveTenantIdDefault;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      const prev = await pool.query('SELECT ai_explanation FROM knowledge_base WHERE id = $1::uuid LIMIT 1', [id]);
      const row = prev.rows?.[0];
      if (!row) return { ok: false, status: 404, error: 'not_found' };
      const oldVal = String(row.ai_explanation || '').trim();
      if (!oldVal || oldVal.length < 20) return { ok: false, status: 400, error: 'no_content' };
      const aiResp = await callLLM([
        { role: 'system', content: '你是一名文档排版专家。任务是把用户提供的培训资料文本整理成清晰、易读的中文Markdown，但绝对不能增删、改写或归纳原文的实质内容——只调整格式、结构、标点和换行。' },
        { role: 'user', content: `请重新整理以下文本的版面，使其符合标准Markdown格式（合理使用 ## 二级标题、### 三级标题、- 列表、1. 2. 3. 编号步骤、**重点加粗** 等），让排版清晰、便于阅读。要求：
1. 不得删除、增加或改写任何实质信息，只调整格式、分段、标点和换行。
2. 不要添加开场白或结尾语，直接输出整理后的内容。

【原文】
${oldVal.slice(0, 20000)}` }
      ], { max_tokens: 6000 });
      const reformatted = String(aiResp?.content || '').trim();
      if (!reformatted || reformatted.length < 20) {
        return { ok: true, success: false, error: 'ai_failed', message: 'AI整理失败，请稍后重试' };
      }
      // 重新整理排版后同样维持锁定（整理=精修行为，锁定不变）
      await pool.query('UPDATE knowledge_base SET ai_explanation = $1, ai_explanation_locked = true, updated_at = NOW() WHERE id = $2::uuid', [reformatted, id]);
      await pool.query(
        `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
         VALUES ($1::uuid, 'ai_explanation', $2, $3, $4, $5, $6)`,
        [id, oldVal, reformatted, username || null, role || null, resolveTenantIdDefault()]
      ).catch((e) => console.error('[knowledge] edit-history(reformat) failed:', e?.message));
      return { ok: true, success: true, explanation: reformatted };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/invalid input syntax for type uuid/i.test(msg)) return { ok: false, status: 400, error: 'invalid_id' };
      console.error('[knowledge] explanation reformat error:', msg);
      return { ok: false, status: 500, error: 'server_error', message: msg };
    }
  
}


export async function regenerateExplanation(ctx, { role, id }) {
  const pool = ctx.pool;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      // 清除缓存并解锁，允许下次访问时按新 prompt 重新生成（解锁才能触发自动生成）
      await pool.query('UPDATE knowledge_base SET ai_explanation = NULL, ai_explanation_locked = false, updated_at = NOW() WHERE id = $1::uuid', [id]);
      return { ok: true, success: true, message: '缓存已清除，重新打开文件将重新生成完整解析' };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/invalid input syntax for type uuid/i.test(msg)) return { ok: false, status: 400, error: 'invalid_id' };
      return { ok: false, status: 500, error: 'server_error', message: msg };
    }
  
}


export async function putKnowledgeGroupId(ctx, { role, id, groupId }) {
  const pool = ctx.pool;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    id = String(id || '').trim();
    groupId = String(groupId || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    if (!groupId) return { ok: false, status: 400, error: 'missing_groupId' };
    try {
      const target = await pool.query('SELECT 1 FROM knowledge_base WHERE group_id = $1::uuid LIMIT 1', [groupId]);
      if (!target.rows?.length) return { ok: false, status: 404, error: 'target_group_not_found' };
      const nextGroupName = await resolveKnowledgeGroupName(pool, groupId, '', '');
      await pool.query(
        'UPDATE knowledge_base SET group_id = $1::uuid, group_name = $2, updated_at = NOW() WHERE id = $3::uuid',
        [groupId, nextGroupName, id]
      );
      return { ok: true, success: true };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: String(e?.message || e) };
    }
  
}


export async function putGroupMeta(ctx, { role, groupId, body }) {
  const pool = ctx.pool;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    groupId = String(groupId || '').trim();
    const groupName = normalizeKnowledgeGroupName(body?.groupName || body?.title || '');
    if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
    if (!groupName) return { ok: false, status: 400, error: 'missing_group_name' };
    try {
      const r = await pool.query(
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
  const pool = ctx.pool;
  const uploadsDir = ctx.uploadsDir;

    if (String(role || '') !== 'admin') {
      return { ok: false, status: 403, error: 'admin_only' };
    }
    groupId = String(groupId || '').trim();
    if (!groupId) return { ok: false, status: 400, error: 'missing_group_id' };
    try {
      const r = await pool.query(
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
          const rel = filePath.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
          const normalized = path.posix.normalize(rel).replace(/^\/+/, '');
          if (normalized && normalized !== '.' && !normalized.includes('..')) {
            const abs = path.join(uploadsDir, normalized);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          }
        } catch (e) {
          console.log('knowledge group delete file cleanup (non-fatal):', e?.message || e);
        }
      }
      await pool.query('DELETE FROM knowledge_base WHERE group_id = $1::uuid', [groupId]);
      return { ok: true, ok: true, deleted: rows.length };
    } catch (e) {
      console.error('DELETE /api/knowledge/group/:groupId error:', e);
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}


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
          console.log('knowledge delete file cleanup (non-fatal):', e?.message || e);
        }
      }

      await pool.query('DELETE FROM knowledge_base WHERE id = $1', [id]);
      return { ok: true, ok: true };
    } catch (e) {
      console.error('DELETE /api/knowledge/:id error:', e);
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
        ).catch((e) => console.error('[knowledge] edit-history(content) failed:', e?.message));
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
      console.error('PUT /api/knowledge/:id error:', e);
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
            console.log('Batch knowledge cloud upload failed for', insertedId, e?.message || e);
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


export async function runCreateKnowledgeBackground(ctx, { inserted, localPath, title, body, file, tenantId }) {
  const pool = ctx.pool;
  const notifyAdminsOcrFailed = ctx.notifyAdminsOcrFailed;
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

      try {
        if (inserted?.id && localPath && fs.existsSync(localPath)) {
          const declaredType = String(body?.type || '').trim();
          const mime0 = String(file?.mimetype || '').trim();
          const origName = String(file?.originalname || '');
          const itemTitle = title || origName.replace(/\.[^.]+$/, '') || '未命名文件';
          const looksLikeImage =
            /^image\//i.test(mime0) ||
            declaredType === 'img' ||
            /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(origName);
          const looksLikePDF =
            /^application\/pdf/i.test(mime0) ||
            declaredType === 'pdf' ||
            /\.pdf$/i.test(origName);
          const looksLikeVideo =
            /^video\//i.test(mime0) ||
            declaredType === 'video' ||
            /\.(mp4|mov|webm|avi)$/i.test(origName);
          const looksLikeDoc =
            /^application\/(vnd\.openxmlformats-officedocument\.wordprocessingml|msword)/i.test(mime0) ||
            declaredType === 'doc' ||
            /\.(docx?|odt)$/i.test(origName);
          let parseSuccess = false;

          if (looksLikeImage) {
            try {
              const { callVisionLLM } = await import('../../agents.js');
              const vr = await callVisionLLM(
                localPath,
                '请完整提取图片中的全部文字（含标题、表格、列表、备注），按阅读顺序输出，使用简体中文。',
                { maxTokens: 8192 }
              );
              if (vr?.ok && String(vr.content || '').trim()) {
                await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
                  String(vr.content).trim(),
                  inserted.id
                ]);
                parseSuccess = true;
              } else {
                const reason = vr?.error || '视觉模型返回内容为空';
                console.warn('[knowledge] image OCR failed:', reason);
                void notifyAdminsOcrFailed(itemTitle, '图片', reason);
              }
            } catch (ocrErr) {
              const reason = String(ocrErr?.message || ocrErr);
              console.warn('[knowledge] image OCR error:', reason);
              void notifyAdminsOcrFailed(itemTitle, '图片', reason);
            }
          }

          // Video — extract frames with ffmpeg, analyze with Qwen-VL
          if (looksLikeVideo) {
            let tmpDir = null;
            try {
              tmpDir = `/tmp/video_frames_${inserted.id}`;
              fs.mkdirSync(tmpDir, { recursive: true });

              const probe = execFileSync('ffprobe', [
                '-v', 'error', '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1', localPath
              ], { encoding: 'utf-8', timeout: 15000 });
              const duration = parseFloat(probe.trim()) || 30;
              const frameCount = Math.min(Math.max(6, Math.ceil(duration / 3)), 18);
              const interval = duration / (frameCount + 1);

              const frames = [];
              for (let i = 1; i <= frameCount; i++) {
                const t = interval * i;
                const outFile = `${tmpDir}/frame_${String(i).padStart(3, '0')}.jpg`;
                execFileSync('ffmpeg', [
                  '-ss', String(t), '-i', localPath,
                  '-vframes', '1', '-q:v', '3',
                  '-vf', 'scale=1280:-1',
                  '-y', outFile
                ], { encoding: 'utf-8', timeout: 30000 });
                if (fs.existsSync(outFile)) frames.push(outFile);
              }

              if (frames.length > 0) {
                const qwenApiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
                const qwenBaseUrl = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
                const qwenModel = 'qwen-vl-max';

                const messages = [{
                  type: 'text',
                  text: '你是资深餐饮SOP编写专家。视频标题为「' + itemTitle + '」。分析截图编写标准操作流程(SOP)。\n\n重要说明：如果视频中多个物料（如多只鸭子）依次进行相同操作，这是**同一工序**应用于多个物料，不是多道工序。请正确合并为一道工序。标题已明确食材，请直接使用。\n\n要求：(1)分步骤格式，每步包含：步骤编号、操作动作、建议时长、操作要点、注意事项；(2)使用专业烹饪术语；(3)包括设备、工具、温度参考值。输出简体中文Markdown。'
                }];
                for (const f of frames) {
                  const buf = fs.readFileSync(f);
                  messages.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } });
                }

                let rawText = '';
                if (qwenApiKey) {
                  const resp = await axios.post(
                    `${qwenBaseUrl}/chat/completions`,
                    {
                      model: qwenModel,
                      messages: [{ role: 'user', content: messages }],
                      temperature: 0.1, max_tokens: 8192
                    },
                    { headers: { 'Authorization': `Bearer ${qwenApiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 }
                  );
                  rawText = String(resp.data?.choices?.[0]?.message?.content || '').trim();
                } else {
                  const { callVisionLLM } = await import('../../agents.js');
                  const vr = await callVisionLLM(messages, '', { maxTokens: 8192 });
                  rawText = String(vr?.content || '').trim();
                }

                if (rawText) {
                  const { callLLM } = await import('../../agents.js');
                  const fmtResp = await callLLM([
                    { role: 'system', content: '你是餐饮SOP编辑专家。你的任务：(1)用专业知识纠正AI视觉分析的工序误判——特别是"烫皮"工序，标准工艺为**一道烫皮**（过程中多次浸入沸水以确保均匀受热），如果原文出现"第二次烫皮""重复烫皮""再次烫皮"或类似内容，必须**合并进第一次烫皮步骤**，保留其时间数据和操作要点，不得作为独立步骤；(2)格式化输出：每步有编号、操作动作、建议时长、操作要点、注意事项；(3)添加标题和关键控制点。输出简体中文Markdown。' },
                    { role: 'user', content: '整理以下SOP内容，纠正工序误判：\n\n' + rawText }
                  ], { maxTokens: 4096 });
                  const finalText = String(fmtResp?.content || rawText).trim();
                  await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [finalText, inserted.id]);
                  parseSuccess = true;
                } else {
                  console.warn('[knowledge] video analysis returned empty');
                  void notifyAdminsOcrFailed(itemTitle, '视频', '视觉模型返回为空');
                }
              } else {
                void notifyAdminsOcrFailed(itemTitle, '视频', 'ffmpeg 未提取到帧');
              }
            } catch (vidErr) {
              const reason = String(vidErr?.message || vidErr);
              console.warn('[knowledge] video process error:', reason);
              void notifyAdminsOcrFailed(itemTitle, '视频', reason);
            } finally {
              if (tmpDir) {
                try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
              }
            }
          }

          // PDF — try pdftotext first, then pdftoppm + vision for scanned PDFs
          if (looksLikePDF) {
            try {
              // Try extracting embedded text (for text-based PDFs)
              try {
                const text = execFileSync('pdftotext', [localPath, '-'], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
                if (text) {
                  await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [text, inserted.id]);
                  parseSuccess = true;
                }
              } catch (pdftotextErr) {
                // pdftotext not available or PDF is scanned — fall through
              }

              // Scanned PDF — convert to images and OCR with vision model
              if (!parseSuccess) {
                let tmpDir = null;
                try {
                  tmpDir = `/tmp/pdf_ocr_${inserted.id}`;
                  fs.mkdirSync(tmpDir, { recursive: true });
                  execFileSync('pdftoppm', ['-png', '-r', '200', localPath, `${tmpDir}/page`], { encoding: 'utf-8', timeout: 30000 });
                  const pages = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
                  if (pages.length > 0) {
                    const { callVisionLLM } = await import('../../agents.js');
                    const content = [
                      { type: 'text', text: '请完整提取这份文档中所有文字内容，包括标题、正文、列表等，按阅读顺序输出，使用简体中文。' }
                    ];
                    for (const page of pages) {
                      const buf = fs.readFileSync(`${tmpDir}/${page}`);
                      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } });
                    }
                    const vr = await callVisionLLM(content, '', { maxTokens: 8192 });
                    if (vr?.ok && String(vr.content || '').trim()) {
                      await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [String(vr.content).trim(), inserted.id]);
                      parseSuccess = true;
                    } else {
                      const reason = vr?.error || 'PDF 图片转换后视觉模型返回为空';
                      console.warn('[knowledge] PDF OCR failed:', reason);
                      void notifyAdminsOcrFailed(itemTitle, 'PDF 扫描件', reason);
                    }
                  } else {
                    void notifyAdminsOcrFailed(itemTitle, 'PDF', 'pdftoppm 转换 PDF 页面数为 0');
                  }
                } finally {
                  if (tmpDir) {
                    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore cleanup error */ }
                  }
                }
              }
            } catch (pdfErr) {
              const reason = String(pdfErr?.message || pdfErr);
              console.warn('[knowledge] PDF parse error:', reason);
              void notifyAdminsOcrFailed(itemTitle, 'PDF', reason);
            }
          }

          // Word (.docx/.doc) — extract text with mammoth, then use LLM for structure if needed
          if (looksLikeDoc) {
            try {
              const mammoth = require('mammoth');
              const docResult = await mammoth.extractRawText({ path: localPath });
              const docText = String(docResult?.value || '').trim();
              if (docText) {
                await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [docText, inserted.id]);
                parseSuccess = true;
              } else {
                console.warn('[knowledge] Word document returned empty text:', itemTitle);
                void notifyAdminsOcrFailed(itemTitle, 'Word文档', 'mammoth提取文本为空');
              }
            } catch (docErr) {
              const reason = String(docErr?.message || docErr);
              console.warn('[knowledge] Word document parse error:', reason);
              void notifyAdminsOcrFailed(itemTitle, 'Word文档', reason);
            }
          }
        }
      } catch (e) {
        console.warn('[knowledge] file parse block:', e?.message || e);
      }
      try {
        if (!localPath || !inserted?.id) return;
        const orig = String(file?.originalname || 'file');
        const ext = path.extname(orig).slice(0, 16);
        const tenantForKey = String(tenantId || 'default').trim() || 'default';
        const objectKey = `hrms/knowledge/${tenantForKey}/${randomUUID()}${ext}`;
        const contentType = inferContentType({
          declaredType: body?.type,
          originalName: orig,
          mimeType: file?.mimetype
        });

        let finalUrl = '';
        const cos = getCosClient();
        if (cos) {
          await new Promise((resolve, reject) => {
            cos.sliceUploadFile(
              {
                Bucket: COS_BUCKET,
                Region: COS_REGION,
                Key: objectKey,
                FilePath: localPath
              },
              (err, data) => {
                if (err) return reject(err);
                return resolve(data);
              }
            );
          });
          try {
            await new Promise((resolve, reject) => {
              cos.putObjectCopy(
                {
                  Bucket: COS_BUCKET,
                  Region: COS_REGION,
                  Key: objectKey,
                  CopySource: `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${objectKey}`,
                  MetadataDirective: 'Replaced',
                  ContentType: contentType,
                  ContentDisposition: buildInlineContentDisposition(orig)
                },
                (err, data) => {
                  if (err) return reject(err);
                  return resolve(data);
                }
              );
            });
          } catch (e) { /* ignore */ }
          finalUrl = buildCosPublicUrl(objectKey) || '';
        } else {
          const oss = getOssClient();
          if (oss) {
            const partSize = Math.max(1, OSS_PART_SIZE_MB) * 1024 * 1024;
            const parallel = Math.max(1, OSS_PARALLEL);
            await oss.multipartUpload(objectKey, localPath, {
              partSize,
              parallel,
              retryCount: Math.max(0, OSS_RETRY_COUNT),
              timeout: Math.max(10000, OSS_TIMEOUT_MS),
              headers: {
                'Content-Type': contentType,
                'Content-Disposition': buildInlineContentDisposition(orig)
              }
            });
            finalUrl = buildOssPublicUrl(objectKey) || '';
          }
        }

        if (!finalUrl) return;
        await pool.query('update knowledge_base set file_path = $1, updated_at = now() where id = $2', [finalUrl, inserted.id]);
        try {
          fs.unlinkSync(localPath);
        } catch (e) { /* ignore */ }
      } catch (e) {
        console.log('Async knowledge cloud upload failed:', e?.message || e);
      }
    
}
