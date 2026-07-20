/**
 * 短信模板每日核对：把 sms_templates 表里配置的正文/签名跟阿里云后台真实报备的模板逐条
 * 比对，不一致或审核未通过就飞书报警。
 *
 * 解决的问题：之前"配置里写的模板是不是跟阿里云报备的是同一份"完全靠人工去后台截图核对
 * （这次事故就是这么发现的），多租户/门店多了之后人工核对根本扛不住，必须自动化。
 *
 * registerSmsReconcileJob(pool) — 每天一次，服务启动10分钟后先跑一次。
 */
import { querySmsTemplate } from './sms.js';
import { listSmsTemplates } from './sms-templates.js';
import { getSendGrowthAlert } from './growth-api.js';

function normalize(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

export async function runSmsTemplateReconcile(pool) {
  const rows = await listSmsTemplates(pool, { tenantId: 'default' });
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
      remote = await querySmsTemplate(code);
    } catch (e) {
      mismatches.push(`${code}：查询阿里云失败(${e.message})，可能已被删除/账号异常`);
      continue;
    }
    if (remote.status !== 1) {
      mismatches.push(`${code}：阿里云审核状态异常(status=${remote.status}${remote.reason ? '，原因：' + remote.reason : ''})，不是"已通过"`);
      continue;
    }
    for (const dbRow of dbRows) {
      if (!dbRow.content) continue; // 未登记正文的老模板(见seed脚本注释)，跳过内容比对
      if (normalize(remote.content) !== normalize(dbRow.content)) {
        mismatches.push(
          `${code}（${dbRow.brand_suffix}/${dbRow.slot}）：DB正文与阿里云报备正文不一致\n` +
          `  DB : ${dbRow.content}\n  阿里云: ${remote.content}`
        );
      }
    }
  }

  if (mismatches.length) {
    const msg = `⚠️ 短信模板每日核对发现 ${mismatches.length} 处不一致，请核实：\n\n${mismatches.join('\n\n')}`;
    console.warn('[sms-reconcile]', msg);
    const sendAlert = getSendGrowthAlert();
    if (sendAlert) await sendAlert(msg).catch(() => null);
  } else {
    console.log(`[sms-reconcile] ok: ${byCode.size} 个模板code与阿里云报备一致`);
  }
  return { checked: byCode.size, mismatches: mismatches.length };
}

export function registerSmsReconcileJob(pool) {
  if (globalThis.__smsReconcileTimer) return;
  globalThis.__smsReconcileTimer = setInterval(() => {
    runSmsTemplateReconcile(pool).catch((e) => console.warn('[sms-reconcile] run failed:', e?.message));
  }, 24 * 60 * 60 * 1000);
  setTimeout(() => {
    runSmsTemplateReconcile(pool).catch((e) => console.warn('[sms-reconcile] initial run failed:', e?.message));
  }, 10 * 60 * 1000);
}
