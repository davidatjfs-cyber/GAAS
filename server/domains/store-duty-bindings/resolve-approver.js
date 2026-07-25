import { ensureReady as defaultEnsureReady } from './service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'store-duty-bindings', handler: 'resolve-approver' });


// Wave H14: store_manager fallback via can_approve_hrms duty binder.
// Optional ensureReady is for unit tests; production uses service.js ensureReady.
export function createDutyApproverResolver({ pool, ensureReady = defaultEnsureReady }) {
  // 门店若无在岗店长（如喻烽以监管身份兼管马己仙），回退到该门店职责绑定中
  // can_approve_hrms 的负责人，作为审批链的「门店店长」步骤。
  async function resolveDutyApproverForStore(store) {
    const s = String(store || '').trim();
    if (!s) return '';
    try {
      await ensureReady(pool);
      const r = await pool.query(
        `SELECT username FROM store_duty_bindings
        WHERE enabled = true
          AND can_approve_hrms = true
          AND lower(trim(store)) = lower(trim($1))
          AND (effective_from IS NULL OR effective_from <= now())
          AND (effective_to IS NULL OR effective_to >= now())
        ORDER BY is_primary_store DESC, updated_at DESC, id DESC
        LIMIT 1`,
        [s]
      );
      return r.rows?.[0]?.username ? String(r.rows[0].username).trim() : '';
    } catch (e) {
      log.warn({ msg: 'store_duty_bindings_resolvedutyapproverforstore_failed', err: e?.message || e });
      return '';
    }
  }

  return {
    resolveDutyApproverForStore,
    ensureStoreDutyBindingsReady: () => ensureReady(pool),
  };
}
