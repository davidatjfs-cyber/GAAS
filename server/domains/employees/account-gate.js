/**
 * Account disable / login gate helpers.
 * Pure status checks are named exports; DB sync / assert need the factory.
 */

export function isInactiveStatus(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return false;
  return ['inactive', 'disabled', 'disable', 'off', '0', 'resigned', 'leave', 'left', '离职', '禁用', '停用'].includes(v);
}

/**
 * 是否应对该员工关闭 HRMS 登录与飞书侧绑定（含：档案为离职类 / 离职审批已通过）
 */
export function employeeAccountShouldDisable(emp) {
  if (!emp || typeof emp !== 'object') return false;
  if (isInactiveStatus(emp.status)) return true;
  const ob =
    emp.offboardingApproved === true
    || String(emp.offboardingApproved || '').trim().toLowerCase() === 'true'
    || String(emp.offboardingApproved || '').trim() === '1';
  if (ob) {
    const obDate = String(emp.offboardingDate || emp.extra_json?.offboardingDate || '').trim().slice(0, 10);
    if (obDate) {
      const today = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
      if (obDate > today) return false;
    }
    return true;
  }
  return false;
}

export function createAccountGateHelpers({
  pool,
  DATABASE_URL,
  tenantContext,
  storeSessionNonce,
  randomUUID,
  getSharedState,
  stateFindUserRecord,
}) {
  /**
   * 根据员工档案同步：PostgreSQL users.is_active、飞书 feishu_users.registered、并作废现有 JWT（换 session nonce）
   * 在 mergeSharedStateFields(employees)、PUT /api/state、离职定时任务等路径调用。
   */
  async function applyHrmsUserAccountGateFromEmployee(emp) {
    const uname = String(emp?.username || '').trim();
    if (!uname || !DATABASE_URL) return;
    const disable = employeeAccountShouldDisable(emp);
    try {
      // 调用方有HTTP路由(已有ALS)也有定时任务(没有)，函数内部自己反查真实租户并
      // tenantContext.run()包裹，不依赖调用方是否已设好上下文。
      let tenantId = 'default';
      try {
        const tr = await pool.query('SELECT tenant_id FROM users WHERE lower(username) = lower($1) LIMIT 1', [uname]);
        tenantId = String(tr.rows?.[0]?.tenant_id || '').trim() || 'default';
      } catch (_e) { /* ignore */ }
      await tenantContext.run(tenantId, async () => {
      if (disable) {
        await pool.query(
          'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE lower(username) = lower($1)',
          [uname]
        );
        await pool.query(
          'UPDATE feishu_users SET registered = FALSE, updated_at = NOW() WHERE lower(username) = lower($1)',
          [uname]
        );
        const sn = randomUUID().replace(/-/g, '').slice(0, 16);
        await storeSessionNonce(uname, sn);
      } else {
        await pool.query(
          'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1)',
          [uname]
        );
        await pool.query(
          `UPDATE feishu_users
              SET registered = TRUE,
                  role = $2,
                  store = $3,
                  name = $4,
                  updated_at = NOW()
            WHERE lower(username) = lower($1)`,
          [uname, String(emp.role || ''), String(emp.store || ''), String(emp.name || '')]
        );
      }
      });
    } catch (e) {
      console.error('[account-gate]', uname, disable ? 'disable' : 'enable', e?.message || e);
    }
  }

  async function assertEmployeeLoginAllowedByState(username) {
    const un = String(username || '').trim();
    if (!un) return;
    const st = (await getSharedState().catch(() => null)) || {};
    const rec = stateFindUserRecord(st, un);
    if (!rec) return;
    if (employeeAccountShouldDisable(rec)) {
      const err = new Error('account_disabled');
      err.statusCode = 403;
      throw err;
    }
  }

  return {
    applyHrmsUserAccountGateFromEmployee,
    assertEmployeeLoginAllowedByState,
    isInactiveStatus,
    employeeAccountShouldDisable,
  };
}
