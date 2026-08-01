/**
 * Daily SMS template reconcile vs Aliyun.
 * Signature preserved: runSmsTemplateReconcile(pool) / registerSmsReconcileJob(pool).
 */
import { querySmsTemplate } from '../../sms.js';
import { listSmsTemplates } from '../../sms-templates.js';
import { getSendGrowthAlert } from '../../growth-api.js';
import { childLogger } from '../../utils/logger.js';
import { normalizeSmsContent } from './helpers.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';

const log = childLogger({ domain: 'growth-sms', handler: 'reconcile' });

/**
 * @param {any} pool
 * @param {{ querySmsTemplate?: Function, listSmsTemplates?: Function, getSendGrowthAlert?: Function }} [deps]
 */
export async function runSmsTemplateReconcile(pool, deps = {}) {
  const queryRemote = deps.querySmsTemplate || querySmsTemplate;
  const listLocal = deps.listSmsTemplates || listSmsTemplates;
  const getAlert = deps.getSendGrowthAlert || getSendGrowthAlert;

  const rows = await listLocal(pool, { tenantId: 'default' });
  const byCode = new Map();
  for (const r of rows) {
    if (!r.template_code) continue;
    if (!byCode.has(r.template_code)) byCode.set(r.template_code, []);
    byCode.get(r.template_code).push(r);
  }

  const mismatches = [];
  for (const [code, dbRows] of byCode) {
    let remote;
    try {
      remote = await queryRemote(code);
    } catch (e) {
      mismatches.push(`${code}：查询阿里云失败(${e.message})，可能已被删除/账号异常`);
      continue;
    }
    if (remote.status !== 1) {
      mismatches.push(
        `${code}：阿里云审核状态异常(status=${remote.status}${remote.reason ? '，原因：' + remote.reason : ''})，不是"已通过"`
      );
      continue;
    }
    for (const dbRow of dbRows) {
      if (!dbRow.content) continue;
      if (normalizeSmsContent(remote.content) !== normalizeSmsContent(dbRow.content)) {
        mismatches.push(
          `${code}（${dbRow.brand_suffix}/${dbRow.slot}）：DB正文与阿里云报备正文不一致\n` +
            `  DB : ${dbRow.content}\n  阿里云: ${remote.content}`
        );
      }
    }
  }

  if (mismatches.length) {
    const msg = `⚠️ 短信模板每日核对发现 ${mismatches.length} 处不一致，请核实：\n\n${mismatches.join('\n\n')}`;
    log.warn({ msg: 'sms_template_reconcile_mismatch', mismatch_count: mismatches.length, detail: msg });
    const sendAlert = getAlert();
    if (sendAlert) await sendAlert(msg).catch(() => null);
  } else {
    log.info({ msg: 'sms_template_reconcile_ok', template_code_count: byCode.size });
  }
  return { checked: byCode.size, mismatches: mismatches.length };
}

export function registerSmsReconcileJob(pool) {
  if (globalThis.__smsReconcileTimer) return;
  globalThis.__smsReconcileTimer = setInterval(() => {
    runSmsTemplateReconcile(pool)
      .then(() => beatHeartbeatSimple(pool, 'sms_template_reconcile'))
      .catch((e) =>
        log.warn({ msg: 'sms_template_reconcile_run_failed', err: e?.message })
      );
  }, 24 * 60 * 60 * 1000);
  setTimeout(() => {
    runSmsTemplateReconcile(pool).catch((e) =>
      log.warn({ msg: 'sms_template_reconcile_initial_failed', err: e?.message })
    );
  }, 10 * 60 * 1000);
}
