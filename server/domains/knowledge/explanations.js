/**
 * Knowledge explanation generation and editing.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'knowledge', handler: 'explanations' });

export async function getKnowledgeExplanation(ctx, { role, id }) {
  const { pool, callLLM } = ctx;

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
    if (row.ai_explanation_locked) {
      return { ok: true, success: true, explanation: row.ai_explanation || '', cached: true, locked: true, rubric };
    }
    if (row.ai_explanation && String(row.ai_explanation).trim().length > 50) {
      return { ok: true, success: true, explanation: row.ai_explanation, cached: true, rubric };
    }
    const rawContent = String(row.content || '').trim();
    const isMediaFile = ['img', 'video', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(String(row.file_type || '').toLowerCase());
    if ((!rawContent || rawContent.length < 20) && !isMediaFile) {
      return { ok: true, success: false, error: 'no_content', message: '此文档暂无文字内容，无法生成AI解析', rubric };
    }
    if ((!rawContent || rawContent.length < 20) && isMediaFile) {
      if (rubric) return { ok: true, success: true, explanation: null, cached: false, rubric };
      return { ok: true, success: false, error: 'no_content', message: '图片/视频文件请点击「生成步骤图谱」生成AI评分标准', rubric: null };
    }
    const titleAndHead = row.title + rawContent.slice(0, 800);
    const isHandbook = /体系手册|培训手册|培训教材|培训体系|操作手册|培训大纲|岗位手册|综合.*培训/.test(titleAndHead);
    const isSopContent = !isHandbook && /SOP|标准操作|工序|步骤\s*\d|操作动作|质量标准|常见失败|补救/.test(rawContent);
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
    log.error({ msg: 'knowledge_explanation_error', detail: [msg] });
    return { ok: false, status: 500, error: 'server_error', message: msg };
  }
}

export async function putKnowledgeExplanation(ctx, { role, id, explanation, username }) {
  const { pool, resolveTenantIdDefault } = ctx;

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
    await pool.query('UPDATE knowledge_base SET ai_explanation = $1, ai_explanation_locked = true, updated_at = NOW() WHERE id = $2::uuid', [explanation, id]);
    await pool.query(
      `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
       VALUES ($1::uuid, 'ai_explanation', $2, $3, $4, $5, $6)`,
      [id, oldVal, explanation, username || null, role || null, resolveTenantIdDefault()]
    ).catch((e) => log.error({ msg: 'knowledge_edit_history_explanation_failed', err: e?.message }));
    return { ok: true, success: true, locked: true };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: String(e?.message || e) };
  }
}

export async function reformatExplanation(ctx, { role, id, username }) {
  const { pool, callLLM, resolveTenantIdDefault } = ctx;

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
    await pool.query('UPDATE knowledge_base SET ai_explanation = $1, ai_explanation_locked = true, updated_at = NOW() WHERE id = $2::uuid', [reformatted, id]);
    await pool.query(
      `INSERT INTO knowledge_edit_history (knowledge_id, field, old_value, new_value, editor, editor_role, tenant_id)
       VALUES ($1::uuid, 'ai_explanation', $2, $3, $4, $5, $6)`,
      [id, oldVal, reformatted, username || null, role || null, resolveTenantIdDefault()]
    ).catch((e) => log.error({ msg: 'knowledge_edit_history_reformat_failed', err: e?.message }));
    return { ok: true, success: true, explanation: reformatted };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/invalid input syntax for type uuid/i.test(msg)) return { ok: false, status: 400, error: 'invalid_id' };
    log.error({ msg: 'knowledge_explanation_reformat_error', detail: [msg] });
    return { ok: false, status: 500, error: 'server_error', message: msg };
  }
}

export async function regenerateExplanation(ctx, { role, id }) {
  const { pool } = ctx;

  if (String(role || '') !== 'admin') {
    return { ok: false, status: 403, error: 'admin_only' };
  }
  id = String(id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  try {
    await pool.query('UPDATE knowledge_base SET ai_explanation = NULL, ai_explanation_locked = false, updated_at = NOW() WHERE id = $1::uuid', [id]);
    return { ok: true, success: true, message: '缓存已清除，重新打开文件将重新生成完整解析' };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/invalid input syntax for type uuid/i.test(msg)) return { ok: false, status: 400, error: 'invalid_id' };
    return { ok: false, status: 500, error: 'server_error', message: msg };
  }
}
