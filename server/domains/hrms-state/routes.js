/**
 * GET/PUT /api/state (Wave H34 — behavior-preserving extract from index.js).
 * Handlers kept intact; do not expand PUT whitelist here.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'hrms-state' });

/**
 * @param {import('express').Express} app
 * @param {Function} authRequired
 * @param {object} deps
 */
export function registerStateRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    resolveTenantIdDefault,
    deepRepairGarbledStrings,
    hydrateStateFromAuthoritativeTables,
    hydrateEmployeesFromTable,
    hydrateFlowConfigFromTable,
    hydrateNotificationsFromTable,
    hydrateExamResultsFromTable,
    stripPasswordFieldsFromStateForClient,
    applyStatePeopleVisibilityForRole,
    applyStatePutWhitelist,
    upsertPayrollDomainFromState,
    notifyAdminsDualWriteFailure,
    applyHrmsUserAccountGateFromEmployee,
  } = deps;

  app.get('/api/state', authRequired, async (req, res) => {
    const requestId = req.requestId || null;
    try {
      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [tenantIdQ]);
      const row = r.rows?.[0] || null;
      if (!row) return res.status(404).json({ error: 'not_found' });
      const data = row.data;
      // Auto-repair garbled UTF-8 strings and persist if changed
      const repaired = deepRepairGarbledStrings(data);
      const origJson = JSON.stringify(data);
      const repairedJson = JSON.stringify(repaired);
      if (origJson !== repairedJson) {
        log.info({ msg: 'state_utf8_auto_repaired', tenant_id: tenantIdQ, request_id: requestId });
        try {
          await pool.query(
            `update hrms_state set data = $1::jsonb, updated_at = now() where key = $2`,
            [repairedJson, tenantIdQ]
          );
        } catch (saveErr) {
          log.error({ msg: 'state_utf8_repair_persist_failed', err: String(saveErr?.message || saveErr) });
        }
      }
      // 积分/薪资/员工/流程配置/通知/考试成绩以表为权威，覆盖 state 镜像
      let hydrated = await hydrateStateFromAuthoritativeTables(pool, repaired, tenantIdQ);
      hydrated = await hydrateEmployeesFromTable(pool, hydrated, tenantIdQ);
      hydrated = await hydrateFlowConfigFromTable(pool, hydrated, tenantIdQ);
      hydrated = await hydrateNotificationsFromTable(pool, hydrated, tenantIdQ);
      hydrated = await hydrateExamResultsFromTable(pool, hydrated, tenantIdQ);
      const role = String(req.user?.role || '').trim();
      const uname = String(req.user?.username || '').trim();
      let payload = stripPasswordFieldsFromStateForClient(hydrated, role);
      payload = await applyStatePeopleVisibilityForRole(
        payload,
        role,
        uname,
        hydrated,
        req.user?.current_store
      );
      return res.json({ data: payload });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // Wave 4q: employee-password → domains/admin-ops/routes.js (stays in index comment trail)

  app.put('/api/state', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const rawData = req.body?.data;
    if (!rawData || typeof rawData !== 'object') {
      return res.status(400).json({ error: 'missing_data' });
    }
    // Auto-repair garbled UTF-8 before persisting
    const repaired = deepRepairGarbledStrings(rawData);
    try {
      // 白名单写入：以服务端 existing 为底，仅 overlay STATE_PUT_WHITELIST 字段。
      // 禁止再靠「黑名单保护块」拦字段——漏一个就事故一次（请款模块消失 / 审批流乱 / 积分被抹）。
      const existingState = (await getSharedState()) || {};
      const { next: data, ignoredKeys } = applyStatePutWhitelist(existingState, repaired);
      if (ignoredKeys.length) {
        log.warn({
          msg: 'state_put_ignored_keys',
          request_id: req.requestId || null,
          keys: ignoredKeys.slice(0, 30),
        });
      }
      await pool.query(
        `insert into hrms_state (key, data, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (key) do update set data = excluded.data, updated_at = now()`,
        [resolveTenantIdDefault(), JSON.stringify(data)]
      );
      // A1：employees 已移出 PUT 白名单，不再从 PUT /api/state 双写员工表
      setImmediate(async () => {
        try {
          await upsertPayrollDomainFromState(data);
        } catch (e) {
          log.error({ msg: 'state_put_payroll_sync_failed', err: e?.message });
          void notifyAdminsDualWriteFailure('hrms_payroll_domain（PUT /api/state）', e);
        }
      });
      // users 数组仍可能经 PUT 写入；employees 账号门控改由窄 API / mergeSharedStateFields 负责
      setImmediate(async () => {
        try {
          const emps = Array.isArray(data.employees) ? data.employees : [];
          for (const emp of emps) {
            const uname = String(emp?.username || '').trim();
            if (!uname) continue;
            try {
              await applyHrmsUserAccountGateFromEmployee(emp);
            } catch (e) {
              log.error({ msg: 'state_put_account_gate_failed', username: uname, err: e?.message || String(e) });
            }
          }
        } catch (syncErr) {
          log.error({ msg: 'state_put_account_gate_sync_failed', err: syncErr?.message });
        }
      });
      return res.json({ ok: true, ignoredKeys });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
