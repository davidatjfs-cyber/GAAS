/**
 * 未成交客户培育节奏：Day1/3/7/14/30 按线索状态生成培育任务(不自动群发，供销售确认后触达)
 */
import { ensureSalesTables, upsertTask } from './sales-store.js';
import { formatCaseBlurb, recommendCasesForLead } from './sales-case-library.js';
import { listSendableContentAssets, sendContentAssetToLead } from './sales-content-delivery.js';

const NURTURE_SCHEDULE = [
  { step: 1, afterHours: 24, title: '培育Day1：发送针对性案例', build: (lead) => `给「${lead.company || lead.name || lead.lead_key}」发一条与其痛点(${lead.extracted?.pain_point || '未明'})接近的客户案例，先建立信任，不要催单。` },
  { step: 2, afterHours: 72, title: '培育Day3：追问是否看过案例', build: () => '追问客户是否看过之前发送的案例，了解有没有具体疑问，不要重复介绍功能。' },
  { step: 3, afterHours: 168, title: '培育Day7：发送经营诊断内容', build: (lead) => `再次触达，附上针对「${lead.extracted?.pain_point || '其经营痛点'}」的诊断结论，强化"我们真的懂你的问题"。` },
  { step: 4, afterHours: 336, title: '培育Day14：发送同业客户实际结果', build: () => '发送同品类/同规模客户使用后的具体结果数据(回店率、营业额归因等)，用结果说话。' },
  { step: 5, afterHours: 720, title: '培育Day30：询问近期经营调整计划', build: () => '询问客户近期是否有门店经营调整计划，判断是否重新进入活跃培育，若长期无响应可考虑降级跟进频率。' },
];

// nurture_step/nurture_last_sent_at 已经收进正式migration(124)，这里不再用业务请求触发
// ALTER TABLE——只做只读的schema完整性检查，缺列时报错而不是静默尝试建表结构，
// 逼着运维去跑 node migrate.js 而不是让cron悄悄改生产schema。
let schemaCheckPromise = null;
async function ensureNurtureColumns(pool) {
  if (schemaCheckPromise) return schemaCheckPromise;
  schemaCheckPromise = (async () => {
    await ensureSalesTables(pool);
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='sales_leads' AND column_name IN ('nurture_step','nurture_last_sent_at')`
    );
    const found = new Set((r.rows || []).map((row) => row.column_name));
    if (!found.has('nurture_step') || !found.has('nurture_last_sent_at')) {
      throw new Error('sales_leads 缺少 nurture_step/nurture_last_sent_at 列，请先执行 node migrate.js（migration 124）');
    }
  })().catch((e) => { schemaCheckPromise = null; throw e; });
  return schemaCheckPromise;
}

/**
 * 找出诊断已交付、仍由AI跟进、且距上次互动/培育已达到下一节奏节点的线索，
 * 默认生成待办；只有销售显式为客户开启 auto_nurture_enabled 且素材已经审批为
 * auto_send_allowed 时，才通过企业微信客服真实发送。这样不会把“自动化”变成无授权群发。
 */
export async function runNurtureCadence(pool) {
  await ensureNurtureColumns(pool);
  const r = await pool.query(
    `SELECT * FROM sales_leads
      WHERE controller = 'ai'
        AND stage NOT IN ('won', 'unfit')
        AND (stage <> 'lost' OR auto_nurture_enabled = true)
        AND extracted->>'diagnosis_delivered' = 'true'
        AND nurture_step < ${NURTURE_SCHEDULE.length}
        AND last_message_at IS NOT NULL
      ORDER BY last_message_at ASC
      LIMIT 100`
  );

  const created = [];
  for (const lead of r.rows || []) {
    const nextStep = NURTURE_SCHEDULE[lead.nurture_step];
    if (!nextStep) continue;
    const sinceLast = lead.nurture_last_sent_at || lead.last_message_at;
    const dueThresholdMs = nextStep.afterHours * 3600000;
    if (Date.now() - new Date(sinceLast).getTime() < dueThresholdMs) continue;

    // 先"认领"这一步(乐观锁：WHERE nurture_step=旧值)，抢到才继续生成任务；两个并发tick
    // 同时跑到这里时，第二个UPDATE会因为行已被改动而影响0行，直接跳过，不会重复推进/重复建任务。
    const claim = await pool.query(
      `UPDATE sales_leads SET nurture_step = $2, nurture_last_sent_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND nurture_step = $3`,
      [lead.id, nextStep.step, lead.nurture_step]
    );
    if (!claim.rowCount) continue;

    const cases = await recommendCasesForLead(pool, { extracted: lead.extracted }).catch(() => []);
    const caseBlurb = cases?.[0]?._score > 0 ? formatCaseBlurb(cases[0]) : '';
    const detail = [nextStep.build(lead), caseBlurb ? `可引用案例：${caseBlurb}` : ''].filter(Boolean).join('\n');

    let autoSent = false;
    if (lead.auto_nurture_enabled && lead.open_kfid && lead.external_userid) {
      const assets = await listSendableContentAssets(pool, { limit: 50 }).catch(() => []);
      const approved = assets.find((asset) => asset.auto_send_allowed && Number(asset.nurture_step || 0) === Number(nextStep.step))
        || assets.find((asset) => asset.auto_send_allowed && asset.nurture_step == null);
      if (approved) {
        try {
          await sendContentAssetToLead(pool, lead, approved, { deliveryType: 'ai_nurture', sentBy: 'customer_ai' });
          autoSent = true;
        } catch (e) {
          console.warn('[sales-nurture] auto delivery failed:', e?.message || e);
        }
      }
    }
    if (!autoSent) await upsertTask(pool, {
      leadId: lead.id, title: nextStep.title, detail, dueAt: new Date(), assignee: lead.owner_username || null,
      dedupKey: `nurture:${lead.id}:${nextStep.step}`, taskDomain: 'nurture', taskType: 'nurture_touch',
      tenantId: lead.tenant_id || null, sourceType: 'sales_leads', sourceId: String(lead.id), createdBy: 'cron:nurture',
    });
    created.push({ lead_id: lead.id, lead_key: lead.lead_key, step: nextStep.step, title: nextStep.title, auto_sent: autoSent });
  }
  return created;
}
