/**
 * 未成交客户培育节奏：Day1/3/7/14/30 按线索状态生成培育任务(不自动群发，供销售确认后触达)
 */
import { ensureSalesTables, upsertTask } from './sales-store.js';
import { formatCaseBlurb, recommendCasesForLead } from './sales-case-library.js';

const NURTURE_SCHEDULE = [
  { step: 1, afterHours: 24, title: '培育Day1：发送针对性案例', build: (lead) => `给「${lead.company || lead.name || lead.lead_key}」发一条与其痛点(${lead.extracted?.pain_point || '未明'})接近的客户案例，先建立信任，不要催单。` },
  { step: 2, afterHours: 72, title: '培育Day3：追问是否看过案例', build: () => '追问客户是否看过之前发送的案例，了解有没有具体疑问，不要重复介绍功能。' },
  { step: 3, afterHours: 168, title: '培育Day7：发送经营诊断内容', build: (lead) => `再次触达，附上针对「${lead.extracted?.pain_point || '其经营痛点'}」的诊断结论，强化"我们真的懂你的问题"。` },
  { step: 4, afterHours: 336, title: '培育Day14：发送同业客户实际结果', build: () => '发送同品类/同规模客户使用后的具体结果数据(回店率、营业额归因等)，用结果说话。' },
  { step: 5, afterHours: 720, title: '培育Day30：询问近期经营调整计划', build: () => '询问客户近期是否有门店经营调整计划，判断是否重新进入活跃培育，若长期无响应可考虑降级跟进频率。' },
];

let ensureNurtureColumnsPromise = null;
async function ensureNurtureColumns(pool) {
  if (ensureNurtureColumnsPromise) return ensureNurtureColumnsPromise;
  ensureNurtureColumnsPromise = (async () => {
    await ensureSalesTables(pool);
    await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS nurture_step INT NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS nurture_last_sent_at TIMESTAMPTZ`);
  })().catch((e) => { ensureNurtureColumnsPromise = null; throw e; });
  return ensureNurtureColumnsPromise;
}

/**
 * 找出诊断已交付、仍由AI跟进、且距上次互动/培育已达到下一节奏节点的线索，
 * 为销售生成一条培育任务(而非自动发送消息)，由销售确认内容后手动触达。
 */
export async function runNurtureCadence(pool) {
  await ensureNurtureColumns(pool);
  const r = await pool.query(
    `SELECT * FROM sales_leads
      WHERE controller = 'ai'
        AND stage NOT IN ('won', 'lost', 'unfit')
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

    const cases = await recommendCasesForLead(pool, { extracted: lead.extracted }).catch(() => []);
    const caseBlurb = cases?.[0]?._score > 0 ? formatCaseBlurb(cases[0]) : '';
    const detail = [nextStep.build(lead), caseBlurb ? `可引用案例：${caseBlurb}` : ''].filter(Boolean).join('\n');

    await upsertTask(pool, { leadId: lead.id, title: nextStep.title, detail, dueAt: new Date(), assignee: lead.owner_username || null });
    await pool.query(
      `UPDATE sales_leads SET nurture_step = $2, nurture_last_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [lead.id, nextStep.step]
    );
    created.push({ lead_id: lead.id, lead_key: lead.lead_key, step: nextStep.step, title: nextStep.title });
  }
  return created;
}
