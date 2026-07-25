/**
 * 日对账调度：
 * - employees / flow-config：表权威 vs hrms_state 镜像
 * - payment-config / stores / remaining-state：无独立表 SoT，做 hrms_state 形状完整性日检
 *   （见 state-only-integrity.js；待未来有表权威后再升级为表↔镜像对账）
 */

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   getActiveTenantIds: (p: import('pg').Pool) => Promise<string[]>,
 *   notifyAdminsDualWriteFailure: (scopeLabel: string, err: Error) => void | Promise<void>,
 *   reconcileEmployeesMirrorAllTenants: typeof import('../employees/mirror-tx.js').reconcileEmployeesMirrorAllTenants,
 *   reconcileFlowConfigMirrorAllTenants: typeof import('../flow-config/reconcile.js').reconcileFlowConfigMirrorAllTenants,
 *   checkStateOnlyDomainsIntegrityAllTenants?: typeof import('./state-only-integrity.js').checkStateOnlyDomainsIntegrityAllTenants,
 * }} deps
 */
export function createMirrorReconcileScheduler(deps) {
  const {
    pool,
    getActiveTenantIds,
    notifyAdminsDualWriteFailure,
    reconcileEmployeesMirrorAllTenants,
    reconcileFlowConfigMirrorAllTenants,
    checkStateOnlyDomainsIntegrityAllTenants,
  } = deps;

  async function runEmployeesMirrorReconcile() {
    try {
      const reports = await reconcileEmployeesMirrorAllTenants(pool, getActiveTenantIds);
      for (const report of reports) {
        if (!report.ok) {
          const driftSample = (report.fieldDrift || []).slice(0, 10).map((d) => d.username).join(',');
          const msg = `employees mirror drift tenant=${report.tenantId} table=${report.tableCount} mirror=${report.mirrorCount} onlyTable=${report.onlyTable.slice(0, 20).join(',')} onlyMirror=${report.onlyMirror.slice(0, 20).join(',')} fieldDrift=${driftSample}`;
          console.error('[employees-mirror-reconcile]', msg);
          void notifyAdminsDualWriteFailure('employees（表/镜像对账）', new Error(msg));
        } else {
          console.log('[employees-mirror-reconcile] ok', report.tenantId, report.tableCount);
        }
      }
    } catch (e) {
      console.error('[employees-mirror-reconcile] failed', e?.message || e);
    }
  }

  async function runFlowConfigMirrorReconcile() {
    try {
      const reports = await reconcileFlowConfigMirrorAllTenants(pool, getActiveTenantIds);
      for (const report of reports) {
        if (!report.ok) {
          const driftSummary = (report.drifts || [])
            .map((d) => `${d.field}:${d.reason}`)
            .slice(0, 20)
            .join(',');
          const msg = `flow-config mirror drift tenant=${report.tenantId} drifts=${driftSummary}`;
          console.error('[flow-config-mirror-reconcile]', msg);
          void notifyAdminsDualWriteFailure('flow-config（表/镜像对账）', new Error(msg));
        } else {
          console.log('[flow-config-mirror-reconcile] ok', report.tenantId);
        }
      }
    } catch (e) {
      console.error('[flow-config-mirror-reconcile] failed', e?.message || e);
    }
  }

  async function runStateOnlyIntegrityChecks() {
    if (typeof checkStateOnlyDomainsIntegrityAllTenants !== 'function') return;
    try {
      const reports = await checkStateOnlyDomainsIntegrityAllTenants(pool, getActiveTenantIds);
      for (const report of reports) {
        if (!report.ok) {
          const bad = (report.domains || [])
            .filter((d) => !d.ok)
            .map((d) => `${d.domain}:${(d.issues || []).map((i) => `${i.field}:${i.reason}`).join('|')}`)
            .join(';');
          const msg = `state-only integrity fail tenant=${report.tenantId} ${bad}`;
          console.error('[state-only-integrity]', msg);
          void notifyAdminsDualWriteFailure('state-only（payment/stores/remaining 形状日检）', new Error(msg));
        } else {
          console.log('[state-only-integrity] ok', report.tenantId);
        }
      }
    } catch (e) {
      console.error('[state-only-integrity] failed', e?.message || e);
    }
  }

  async function runMirrorReconcile() {
    await runEmployeesMirrorReconcile();
    await runFlowConfigMirrorReconcile();
    await runStateOnlyIntegrityChecks();
  }

  function startMirrorReconcileScheduler() {
    setTimeout(() => void runMirrorReconcile(), 60_000);
    setInterval(() => void runMirrorReconcile(), 24 * 60 * 60 * 1000);
  }

  return { startMirrorReconcileScheduler };
}
