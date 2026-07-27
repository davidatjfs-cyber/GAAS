import { runWithSystemTenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'ai-quality-learning' });

export async function runPlatformQualityModelTask(pool, {
  operation,
  route = null,
  execute,
} = {}) {
  if (typeof execute !== 'function') throw new Error('quality_model_execute_required');
  const op = String(operation || '').trim().slice(0, 40);
  if (!op) throw new Error('quality_model_operation_required');
  const dailyLimit = Math.max(1, Math.min(10000, Number(process.env.AI_QUALITY_DAILY_CALL_LIMIT) || 100));
  const used = await runWithSystemTenantContext(() => pool.query(
    `SELECT COUNT(*)::int AS count FROM ai_quality_model_calls
      WHERE created_at >= date_trunc('day',NOW())`
  ));
  if (Number(used.rows[0]?.count || 0) >= dailyLimit) {
    return { ok: false, error: 'ai_quality_daily_call_limit_exceeded' };
  }
  const startedAt = Date.now();
  let result;
  try {
    result = await execute();
    return result;
  } catch (error) {
    result = { ok: false, error: error?.message || 'quality_model_call_failed' };
    return result;
  } finally {
    await runWithSystemTenantContext(() => pool.query(
      `INSERT INTO ai_quality_model_calls (
         operation,route,provider,model_name,success,latency_ms,
         input_tokens,output_tokens,error_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [op, route == null ? null : String(route).slice(0, 80),
        String(process.env.AI_QUALITY_LLM_PROVIDER || '').slice(0, 60) || null,
        String(result?.actualModel || process.env.AI_QUALITY_LLM_MODEL || '').slice(0, 160) || null,
        result?.ok === true, Number(result?.responseTime || (Date.now() - startedAt)),
        Number(result?.raw?.usage?.prompt_tokens || 0) || null,
        Number(result?.raw?.usage?.completion_tokens || 0) || null,
        result?.ok === true ? null : String(result?.error || 'quality_model_call_failed').slice(0, 120)]
    )).catch((error) => log.error({ msg: 'model_call_audit_failed', err: error?.message || String(error) }));
  }
}
