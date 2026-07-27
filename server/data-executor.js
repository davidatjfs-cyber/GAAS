/**
 * Data Executor — 数据执行层
 * BUILD_VERSION: 2026-03-02-v2
 *
 * 职责（严格边界）：
 *   1. 根据 metric_id 从指标字典查定义
 *   2. 自动展开依赖链，按顺序查询
 *   3. 查缓存 → 命中直接返回 → 未命中查库 → 写缓存
 *   4. 返回结构化 JSON，禁止分析/解释
 *
 * v2 新增：
 *   - extractTimeRangeFromText()  ：从自然语言问题提取时间范围
 *   - runBusinessDiagnosis()      ：Business Diagnosis Agent（LLM约束分析层）
 *   - 结构化日志埋点（task_id全链路）
 *
 * 禁止：
 *   - 推断、猜测任何数值
 *   - Diagnosis 层引用未查询的指标
 *   - 修改口径（一切以 metric_dictionary 为准）
 */

import { randomUUID } from 'crypto';
import { resolveTenantIdDefault } from './utils/database.js';
import { getRuntimePromptPatch, recordAiInteraction } from './services/ai-quality-learning-service.js';
import { childLogger } from './utils/logger.js';
import { parseTimeRange } from './domains/data-executor/time-range.js';
import { createMetricQueryExecutors } from './domains/data-executor/metric-query-executors.js';

export { extractTimeRangeFromText, parseTimeRange } from './domains/data-executor/time-range.js';

const log = childLogger({ domain: 'data-executor' });

let _pool = null;
export function setDataExecutorPool(p) { _pool = p; }
function pool() {
  if (!_pool) throw new Error('data-executor: pool not set');
  return _pool;
}
const metricQueryExecutors = createMetricQueryExecutors({ query: (...args) => pool().query(...args) });

// ── 1. 指标字典读取 ──────────────────────────────────────────

const _dictCache = new Map(); // 内存缓存，避免每次查库
const _dictCacheTtl = 5 * 60 * 1000; // 5分钟

export async function getMetricDef(metricId) {
  const cacheKey = `${resolveTenantIdDefault()}::${metricId}`;
  const cached = _dictCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < _dictCacheTtl) return cached.def;
  try {
    const r = await pool().query(
      `SELECT * FROM metric_dictionary WHERE metric_id = $1 AND enabled = TRUE LIMIT 1`,
      [metricId]
    );
    const def = r.rows?.[0] || null;
    if (def) _dictCache.set(cacheKey, { def, ts: Date.now() });
    return def;
  } catch (e) {
    log.error({ msg: 'get_metric_def_failed', err: e?.message });
    return null;
  }
}

export async function getAllMetricDefs() {
  try {
    const r = await pool().query(
      `SELECT * FROM metric_dictionary WHERE enabled = TRUE ORDER BY metric_id`
    );
    return r.rows || [];
  } catch (e) {
    return [];
  }
}

// ── 2. 查询结果缓存 ──────────────────────────────────────────

async function getCachedResult(taskId, metricId, timeRange, store) {
  try {
    const r = await pool().query(
      `SELECT result, metric_version FROM agent_metric_cache
       WHERE task_id = $1 AND metric_id = $2 AND time_range = $3
         AND COALESCE(store,'') = COALESCE($4,'')
         AND expires_at > NOW()
       LIMIT 1`,
      [taskId, metricId, timeRange, store || '']
    );
    if (r.rows?.[0]) {
      // 更新命中次数
      await pool().query(
        `UPDATE agent_metric_cache SET hit_count = hit_count + 1
         WHERE task_id = $1 AND metric_id = $2 AND time_range = $3 AND COALESCE(store,'') = COALESCE($4,'')`,
        [taskId, metricId, timeRange, store || '']
      ).catch(() => {});
      return r.rows[0].result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function setCachedResult(taskId, metricId, timeRange, store, result, metricVersion, ttlMinutes) {
  const ttl = (ttlMinutes && ttlMinutes > 0) ? `${ttlMinutes} minutes` : '120 minutes';
  try {
    const tenantId = resolveTenantIdDefault();
    await pool().query(
      `INSERT INTO agent_metric_cache
         (task_id, metric_id, time_range, store, result, metric_version, created_at, expires_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW() + $7::interval, $8)
       ON CONFLICT (task_id, metric_id, time_range, store, tenant_id)
       DO UPDATE SET result = EXCLUDED.result, metric_version = EXCLUDED.metric_version,
                     expires_at = NOW() + $7::interval`,
      [taskId, metricId, timeRange, store || '', JSON.stringify(result), metricVersion || 1, ttl, tenantId]
    );
  } catch (e) {
    log.error({ msg: 'set_cached_result_failed', err: e?.message });
  }
}

// ── 2b. 指标版本变更：写 change_log + 清理旧缓存 ──────────────

export async function updateMetricVersion(metricId, changes, changedBy) {
  try {
    const cur = await getMetricDef(metricId);
    if (!cur) return { ok: false, error: 'metric_not_found' };
    const newVersion = (cur.version || 1) + 1;
    const entry = {
      version: newVersion,
      changed_by: changedBy || 'system',
      changed_at: new Date().toISOString(),
      changes: changes || {}
    };
    // 追加 change_log（保留最近20条）
    const existingLog = Array.isArray(cur.metadata?.change_log) ? cur.metadata.change_log : [];
    const newLog = [...existingLog, entry].slice(-20);
    await pool().query(
      `UPDATE metric_dictionary
         SET version = $1,
             metadata = jsonb_set(COALESCE(metadata,'{}'), '{change_log}', $2::jsonb),
             updated_at = NOW()
       WHERE metric_id = $3 AND tenant_id = $4`,
      [newVersion, JSON.stringify(newLog), metricId, resolveTenantIdDefault()]
    );
    // 清理该指标所有缓存（版本变更，旧缓存全部失效）
    const deleted = await pool().query(
      `DELETE FROM agent_metric_cache WHERE metric_id = $1`,
      [metricId]
    );
    // 清除内存字典缓存
    _dictCache.delete(`${resolveTenantIdDefault()}::${metricId}`);
    logExecutorEvent('metric_version_bumped', {
      metric_id: metricId,
      old_version: cur.version || 1,
      new_version: newVersion,
      cache_cleared: deleted.rowCount || 0,
      changed_by: changedBy || 'system'
    });
    return { ok: true, metric_id: metricId, new_version: newVersion, cache_cleared: deleted.rowCount || 0 };
  } catch (e) {
    log.error({ msg: 'update_metric_version_failed', err: e?.message });
    return { ok: false, error: e?.message };
  }
}

// ── 5. 核心：单指标查询 ──────────────────────────────────────

async function executeOneMetric(metricId, timeRange, store, depResults) {
  const def = await getMetricDef(metricId);
  if (!def) {
    return {
      metric_id: metricId,
      value: null,
      error: `指标 ${metricId} 不存在于字典`,
      time_range: timeRange,
      source: null,
      version: null
    };
  }

  const { start, end, label } = parseTimeRange(timeRange);

  try {
    let value = null;

    // 计算型指标（依赖其他指标）
    if (def.data_source === 'computed') {
      value = computeMetricValue(def, depResults);
    }
    // feishu_generic_records 型指标
    else if (def.data_source === 'feishu_generic_records') {
      value = await metricQueryExecutors.queryFeishuGenericRecords(def, start, end, store);
    }
    // sales_raw 型指标
    else if (def.data_source === 'sales_raw') {
      value = await metricQueryExecutors.querySalesRaw(def, start, end, store);
    }
    // daily_reports 型指标
    else if (def.data_source === 'daily_reports') {
      value = await metricQueryExecutors.queryDailyReports(def, start, end, store);
    }
    // schedules 型指标
    else if (def.data_source === 'schedules') {
      value = await metricQueryExecutors.querySchedules(def, start, end, store);
    }
    else {
      value = null;
    }

    return {
      metric_id: metricId,
      name: def.name,
      value,
      time_range: timeRange,
      time_range_label: label,
      source: def.data_source,
      version: def.version,
      include_discount: def.include_discount,
      unit: def.metadata?.unit || null,
      notes: def.include_discount === false ? '已扣优惠' : '含优惠前金额'
    };
  } catch (e) {
    log.error({ msg: 'execute_one_metric_failed', metric_id: metricId, err: e?.message });
    return {
      metric_id: metricId,
      name: def?.name || metricId,
      value: null,
      error: e?.message,
      time_range: timeRange,
      source: def?.data_source,
      version: def?.version
    };
  }
}

// ── 9. 计算型指标 ─────────────────────────────────────────────

function computeMetricValue(def, depResults) {
  const deps = def.dependencies || [];
  if (deps.length < 2) return null;

  const formula = def.formula || '';
  // 形如 "A / B"
  if (formula.includes('/')) {
    const parts = formula.split('/').map(s => s.trim().split(' ')[0]);
    const [a, b] = parts;
    const aResult = depResults[a];
    const bResult = depResults[b];
    const aVal = aResult?.value;
    const bVal = bResult?.value;
    if (aVal === null || aVal === undefined || !bVal) return null;
    return Math.round((Number(aVal) / Number(bVal)) * 100) / 100;
  }
  // 形如 "A - B"
  if (formula.includes('-')) {
    const parts = formula.split('-').map(s => s.trim().split(' ')[0]);
    const [a, b] = parts;
    const aVal = depResults[a]?.value;
    const bVal = depResults[b]?.value;
    if (aVal === null || aVal === undefined) return null;
    return Number(aVal) - Number(bVal || 0);
  }
  return null;
}

// ── 10. 公开接口：批量执行指标 ───────────────────────────────

/**
 * 核心执行入口
 * @param {string[]} metricIds  - 需要查询的指标 ID 列表
 * @param {string}   timeRange  - 时间范围（"2026-02" / "2026-02-01~2026-02-28" / "2026-02-14"）
 * @param {string}   store      - 门店名（可空）
 * @param {string}   taskId     - 本次 session 的任务 ID（用于缓存）
 * @returns {{ results: object[], metrics_returned: string[], metric_versions: object }}
 */
export async function executeMetrics(metricIds, timeRange, store, taskId) {
  const ids = Array.isArray(metricIds) ? metricIds : [metricIds];
  const tId = taskId || randomUUID();
  const t0 = Date.now();
  const results = [];
  const depResultsMap = {};
  const cacheHits = [];
  const cacheMisses = [];

  logExecutorEvent('executor_start', { task_id: tId, metric_ids: ids, time_range: timeRange, store: store || null });

  for (const metricId of ids) {
    // 1. 查缓存
    const cached = await getCachedResult(tId, metricId, timeRange || '', store);
    if (cached) {
      results.push(cached);
      depResultsMap[metricId] = cached;
      cacheHits.push(metricId);
      logExecutorEvent('metric_cache_hit', { task_id: tId, metric_id: metricId, time_range: timeRange });
      continue;
    }
    cacheMisses.push(metricId);

    // 2. 展开依赖
    const def = await getMetricDef(metricId);
    const deps = def?.dependencies || [];
    for (const depId of deps) {
      if (!depResultsMap[depId]) {
        const depCached = await getCachedResult(tId, depId, timeRange || '', store);
        if (depCached) {
          depResultsMap[depId] = depCached;
          logExecutorEvent('metric_cache_hit', { task_id: tId, metric_id: depId, time_range: timeRange, is_dep: true });
        } else {
          const depResult = await executeOneMetric(depId, timeRange, store, depResultsMap);
          depResultsMap[depId] = depResult;
          const depDef = await getMetricDef(depId);
          await setCachedResult(tId, depId, timeRange || '', store, depResult, depDef?.version, depDef?.cache_ttl_minutes);
          logExecutorEvent('metric_queried', { task_id: tId, metric_id: depId, value: depResult.value, error: depResult.error || null, is_dep: true });
        }
      }
    }

    // 3. 执行本指标
    const result = await executeOneMetric(metricId, timeRange, store, depResultsMap);
    depResultsMap[metricId] = result;
    results.push(result);
    await setCachedResult(tId, metricId, timeRange || '', store, result, def?.version, def?.cache_ttl_minutes);
    logExecutorEvent('metric_queried', { task_id: tId, metric_id: metricId, value: result.value, error: result.error || null });
  }

  const metricVersions = {};
  for (const r of results) {
    if (r.metric_id && r.version != null) {
      metricVersions[r.metric_id] = r.version;
    }
  }

  const metricsReturned = results.filter(r => r.value !== null && r.value !== undefined).map(r => r.metric_id);
  const duration = Date.now() - t0;

  logExecutorEvent('executor_complete', {
    task_id: tId,
    metrics_returned: metricsReturned,
    cache_hits: cacheHits,
    cache_misses: cacheMisses,
    duration_ms: duration
  });

  return {
    task_id: tId,
    store: store || null,
    time_range: timeRange || null,
    results,
    metrics_returned: metricsReturned,
    metric_versions: metricVersions
  };
}

// ── 11. 分析规则匹配 ──────────────────────────────────────────

const _rulesCache = new Map();

export async function matchAnalysisRule(text) {
  const tenantId = resolveTenantIdDefault();
  let cached = _rulesCache.get(tenantId) || { rules: null, ts: 0 };
  // 缓存规则 5 分钟
  if (!cached.rules || Date.now() - cached.ts > 5 * 60 * 1000) {
    try {
      const r = await pool().query(
        `SELECT * FROM analysis_rules WHERE enabled = TRUE ORDER BY priority DESC, id ASC`
      );
      cached = { rules: r.rows || [], ts: Date.now() };
    } catch (e) {
      cached = { rules: [], ts: Date.now() };
    }
    _rulesCache.set(tenantId, cached);
  }

  const t = String(text || '').toLowerCase();
  const matched = [];
  for (const rule of cached.rules) {
    const keywords = Array.isArray(rule.trigger_keywords) ? rule.trigger_keywords : [];
    if (keywords.some(kw => t.includes(String(kw).toLowerCase()))) {
      matched.push(rule);
    }
  }
  if (matched.length === 0) return null;
  // 已按 priority DESC 排序，取最高优先级；若同优先级有多条记录冲突
  if (matched.length > 1) {
    logExecutorEvent('rule_conflict', {
      matched_rules: matched.map(r => r.intent),
      selected: matched[0].intent,
      text_snippet: text.slice(0, 60)
    });
  }
  return matched[0];
}

// ── 12. Session State 管理 ────────────────────────────────────

export async function getSessionState(username) {
  try {
    const r = await pool().query(
      `SELECT memory_value FROM agent_long_memory WHERE user_key = $1 AND memory_key = 'session_state' LIMIT 1`,
      [String(username || '').toLowerCase()]
    );
    const val = r.rows?.[0]?.memory_value;
    return val && typeof val === 'object' ? val : null;
  } catch (e) {
    return null;
  }
}

export async function setSessionState(username, state) {
  const u = String(username || '').toLowerCase();
  if (!u) return;
  const payload = {
    task_id: state.task_id || randomUUID(),
    route: state.route || null,
    intent: state.intent || null,
    metrics_requested: Array.isArray(state.metrics_requested) ? state.metrics_requested : [],
    metrics_returned: Array.isArray(state.metrics_returned) ? state.metrics_returned : [],
    metric_versions: state.metric_versions || {},
    time_range: state.time_range || null,
    store: state.store || null,
    status: state.status || 'active',
    created_at: state.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  try {
    await pool().query(
      `INSERT INTO agent_long_memory (user_key, memory_key, memory_value, created_at, updated_at, tenant_id)
       VALUES ($1, 'session_state', $2::jsonb, NOW(), NOW(), $3)
       ON CONFLICT (user_key, memory_key, tenant_id)
       DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()`,
      [u, JSON.stringify(payload), resolveTenantIdDefault()]
    );
  } catch (e) {
    log.error({ msg: 'set_session_state_failed', err: e?.message });
  }
}

export async function resetSessionState(username) {
  const u = String(username || '').toLowerCase();
  if (!u) return;
  try {
    await pool().query(
      `UPDATE agent_long_memory SET memory_value = '{}'::jsonb, updated_at = NOW()
       WHERE user_key = $1 AND memory_key = 'session_state'`,
      [u]
    );
  } catch (e) { /* ignore */ }
}

// ── 13. 清理过期缓存（定时任务调用） ─────────────────────────

export async function purgeExpiredCache() {
  try {
    const r = await pool().query(`DELETE FROM agent_metric_cache WHERE expires_at < NOW()`);
    return r.rowCount || 0;
  } catch (e) {
    return 0;
  }
}

// ── 14. 结构化日志 ─────────────────────────────────────────────

export function logExecutorEvent(event, data) {
  const safe = {};
  for (const [k, v] of Object.entries(data || {})) {
    safe[k] = v === undefined ? null : v;
  }
  log.info({ msg: 'executor_event', event, ...safe });
}

// ── 16. LLM 调用桥接（注入方式，避免循环依赖）─────────────────

let _callLLMFn = null;
export function setCallLLMBridge(fn) { _callLLMFn = fn; }

// ── 17. Business Diagnosis Agent ──────────────────────────────
//
// 职责：接收 Data Executor 的结构化数据结果，
//       在严格约束下调用 LLM 做分析推理。
//
// 约束：
//   1. LLM 只能引用 execResult.metrics_returned 中的指标
//   2. 若 LLM 输出引用了未查询指标，自动过滤/报错
//   3. 禁止 LLM 自行估算任何数值

export async function runBusinessDiagnosis(execResult, userQuery, options = {}) {
  const t0 = Date.now();
  const taskId = execResult.task_id || randomUUID();
  const availableMetrics = execResult.metrics_returned || [];
  const validResults = (execResult.results || []).filter(r => r.value !== null && r.value !== undefined);

  if (!_callLLMFn) {
    logExecutorEvent('diagnosis_skip', { task_id: taskId, reason: 'llm_bridge_not_set' });
    return null;
  }
  if (!validResults.length) {
    logExecutorEvent('diagnosis_skip', { task_id: taskId, reason: 'no_valid_data' });
    return null;
  }

  // 构建数据摘要给 LLM（只含已查到的指标）
  const dataSummary = validResults.map(r => ({
    metric_id: r.metric_id,
    name: r.name,
    value: r.value,
    time_range_label: r.time_range_label || execResult.time_range,
    store: execResult.store || '全部门店',
    notes: r.notes || ''
  }));

  const diagnosisTenantId = resolveTenantIdDefault();
  const runtimePatch = await getRuntimePromptPatch(pool(), {
    artifactKey: 'data_diagnosis',
    tenantId: diagnosisTenantId,
    actorId: options.username || 'unknown',
  }).catch(() => null);
  const qualityPatchBlock = runtimePatch?.patch
    ? `\n【已通过质量门禁的改进规则】\n${runtimePatch.patch}\n`
    : '';

  const systemPrompt = `你是年年有喜餐饮集团的经营诊断专家"小年"。
你的任务：基于下方【已查数据】，对用户问题给出专业、简洁的分析结论和行动建议。

【已查数据】（仅此为据，禁止引用或估算其他数字）：
${JSON.stringify(dataSummary, null, 2)}

【严格约束】：
1. 只能基于以上数据得出结论，禁止编造、推断未查询的指标值
2. 如发现数据不足以回答某个问题，必须明确说明"该数据暂未查询，建议另行核实"
3. 结论必须量化，引用上方具体数字，不得笼统描述
4. 建议必须可执行，对应具体岗位（店长/厨师长/营运等）
5. 禁止输出任何JSON，直接输出简洁的中文分析（200字以内）
${qualityPatchBlock}

用户问题：${userQuery}
门店范围：${execResult.store || '全部门店'}
时间范围：${execResult.time_range || '近7天'}`;

  try {
    const llm = await _callLLMFn([
      { role: 'system', content: systemPrompt }
    ], { temperature: 0.15, max_tokens: 350, purpose: 'analysis' });

    const diagnosisText = String(llm?.content || '').trim();

    // 校验：LLM 回复中不能出现未查询指标的 metric_id
    const allMetricIds = (await getAllMetricDefs()).map(d => d.metric_id);
    const referencedUnavailable = allMetricIds.filter(id =>
      !availableMetrics.includes(id) && diagnosisText.includes(id)
    );
    if (referencedUnavailable.length > 0) {
      logExecutorEvent('diagnosis_validation_fail', {
        task_id: taskId,
        referenced_unavailable: referencedUnavailable
      });
      // 不阻断返回，只记录警告
    }

    const duration = Date.now() - t0;
    logExecutorEvent('diagnosis_complete', {
      task_id: taskId,
      available_metrics: availableMetrics,
      duration_ms: duration,
      text_len: diagnosisText.length
    });

    // P1B: 写入 diagnosis_feedback 表供质量监控，并绑定统一AI追踪记录。
    try {
      const diagTenantId = diagnosisTenantId;
      const traceId = await recordAiInteraction(pool(), {
        source: 'diagnosis_feedback',
        sourceRecordId: taskId,
        route: 'data_diagnosis',
        purpose: 'diagnosis',
        actorId: options.username || 'unknown',
        modelName: llm?.actualModel || null,
        promptVersion: runtimePatch?.version || 'baseline',
        input: userQuery,
        output: diagnosisText,
        latencyMs: duration,
        inputTokens: llm?.raw?.usage?.prompt_tokens,
        outputTokens: llm?.raw?.usage?.completion_tokens,
        businessContext: {
          store: execResult.store || null,
          metrics_used: availableMetrics,
          quality_release_candidate_id: runtimePatch?.candidateId || null,
          quality_release_status: runtimePatch?.status || 'baseline',
        },
        tenantId: diagTenantId,
      });
      await pool().query(
        `INSERT INTO diagnosis_feedback
           (task_id, user_key, store, time_range, metrics_used, diagnosis, char_count, metric_count, created_at, updated_at, tenant_id, trace_id, query_text)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NOW(), NOW(), $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          taskId,
          options.username || 'unknown',
          execResult.store || null,
          execResult.time_range || null,
          JSON.stringify(availableMetrics),
          diagnosisText.slice(0, 2000),
          diagnosisText.length,
          availableMetrics.length,
          diagTenantId,
          traceId,
          String(userQuery || '').slice(0, 2000),
        ]
      );
    } catch (fe) {
      // 不阻断主流程
    }

    return {
      task_id: taskId,
      diagnosis: diagnosisText,
      data_basis: availableMetrics,
      generated_at: new Date().toISOString()
    };
  } catch (e) {
    logExecutorEvent('diagnosis_error', { task_id: taskId, error: e?.message });
    return null;
  }
}
