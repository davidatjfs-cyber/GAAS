import { tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event-employee' });

const INACTIVE_STATUSES = [
  'resigned',
  'deleted',
  'inactive',
  'terminated',
  '离职',
  '已删除',
  '已离职',
];

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object }} ctx
 * @returns {Promise<object|null>} blocked result, or null if active
 */
export async function blockInactiveFeishuEmployee(deps, { openId, feishuUser }) {
  const { pool, getSharedState, sendLarkMessage } = deps;

  try {
    const state = await getSharedState();
    const empList = Array.isArray(state?.employees) ? state.employees : [];
    const empU = String(feishuUser.username || '').trim().toLowerCase();
    const empRec = empList.find((e) => String(e?.username || '').trim().toLowerCase() === empU);

    if (!empRec || INACTIVE_STATUSES.includes(String(empRec.status || '').trim().toLowerCase())) {
      const msg = !empRec
        ? '⚠️ 您的账号已从系统中移除，无法使用智能助理。'
        : '⚠️ 您的账号已离职，无法使用智能助理。';
      await sendLarkMessage(openId, msg);
      try {
        await tenantContext.run(feishuUser.tenant_id || 'default', () =>
          pool().query('UPDATE feishu_users SET registered=FALSE WHERE open_id=$1', [openId])
        );
      } catch {
        /* ignore */
      }
      return { ok: true, blocked: !empRec ? 'deleted' : 'inactive' };
    }
  } catch (e) {
    log.error({ msg: 'status_check_error', err: String(e?.message || e) });
  }

  return null;
}
