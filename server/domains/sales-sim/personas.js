/** 内置人格；库表可覆盖/扩展，启动时 ensureSeed 写入 */

import { BUILTIN_STORE_PERSONAS } from './store-tracks.js';

export const BUILTIN_PERSONAS = [
  {
    persona_key: 'li_boss_skeptical',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '李老板 · 怀疑型（被骗过）',
    opening_line: '你们又是做AI的？去年买过一套SCRM，基本没用上。有事快说。',
    profile: {
      name: '李老板', age: 38, city: '上海', stores: 4, cuisine: '火锅',
      daily_revenue: 30000, pos: '二维火', budget_year: 20000,
      traits: ['被骗过', '讨厌销售', '关注回本', '老婆管钱'],
      objections: ['ai_useless', 'too_expensive', 'has_system'],
    },
  },
  {
    persona_key: 'busy_owner',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 2,
    title: '王总 · 忙碌型老板',
    opening_line: '我在开车，你有一分钟就说重点，没时间听产品介绍。',
    profile: {
      name: '王总', city: '杭州', stores: 2, cuisine: '粤菜',
      traits: ['极忙', '易挂断', '要结果'],
      objections: ['no_time', 'think_again'],
    },
  },
  {
    persona_key: 'price_shopper',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '陈店东 · 比价型',
    opening_line: '你们多少钱一年？竞品报了我一万五，你们呢？',
    profile: {
      name: '陈店东', city: '深圳', stores: 3, cuisine: '烧烤',
      traits: ['比价', '抠预算', '要案例'],
      objections: ['too_expensive', 'ask_features'],
    },
  },
  {
    persona_key: 'cold_gatekeeper',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 2,
    title: '赵运营 · 冷淡非决策人',
    opening_line: '我是运营，这种事得问老板。你先发资料吧。',
    profile: {
      name: '赵运营', role: '运营', traits: ['非决策人', '冷淡'],
      objections: ['think_again', 'no_time'],
    },
  },
  {
    persona_key: 'pos_blocker',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '周店长 · POS对接顾虑',
    opening_line: '我们POS很老，上次有人说能接结果接了两个月没弄好。你们呢？',
    profile: {
      name: '周店长', stores: 1, pos: '老旧定制', traits: ['怕对接翻车', '要周期'],
      objections: ['has_system', 'ai_useless'],
    },
  },
  {
    persona_key: 'silent_closer',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 7,
    title: '高难 · 沉默型客户',
    opening_line: '……（客户很久不说话）你说。',
    profile: { traits: ['沉默', '打断', '高难'], objections: ['think_again', 'no_time'] },
  },
  {
    persona_key: 'last_minute_regret',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 9,
    title: '高难 · 最后一分钟反悔',
    opening_line: '方案我看过了，本来想签，但财务刚说预算砍了，你们再想想吧。',
    profile: { traits: ['临门反悔', '财务卡预算'], objections: ['too_expensive', 'think_again'] },
  },
  {
    persona_key: 'think_again_boss',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 5,
    title: '高难 · 连续「再考虑」',
    opening_line: '嗯，我再考虑考虑。你们先别催。',
    profile: { traits: ['软拒绝'], objections: ['think_again'] },
  },
  {
    persona_key: 'biz_repurchase_gap',
    track: 'sales', audience: 'internal', source_type: 'business', difficulty: 6,
    title: '经营真题 · 复购率18%粤菜老板',
    opening_line: '你一直说AI增长，那你告诉我：我店里现在复购率18%，你第一步准备怎么帮我？别讲功能。',
    profile: {
      cuisine: '粤菜', stores: 3, pos: '二维火', members: 12000, repurchase_rate: 0.18,
      traits: ['要数字方案', '经营真题'], objections: ['ask_features', 'ai_useless'],
      business_question: '复购率18%第一步怎么做',
    },
  },
  {
    persona_key: 'cs_sms_fail',
    track: 'cs', audience: 'both', source_type: 'builtin', difficulty: 2,
    title: '客户 · 短信没发出',
    opening_line: '今天营销短信怎么没发？会员都在问我，你们系统什么情况？',
    profile: { issue: 'sms_not_sent', emotion: 'anxious', objections: ['complaint', 'angry'] },
  },
  {
    persona_key: 'cs_angry_bug',
    track: 'cs', audience: 'both', source_type: 'builtin', difficulty: 3,
    title: '客户 · 功能难用且生气',
    opening_line: '这个后台也太难用了吧，点半天找不到活动，我真的受够了！',
    profile: { issue: 'ux', emotion: 'anger', objections: ['angry', 'ux_bad'] },
  },
  {
    persona_key: 'cs_refund',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '客户 · 要求退款',
    opening_line: '效果完全没达到你们承诺的，我要退款，别跟我绕。',
    profile: { issue: 'refund', emotion: 'disappointed', objections: ['refund', 'angry'] },
  },
  {
    persona_key: 'cs_rage_escalation',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 8,
    title: '高难客服 · 怒气升级要投诉曝光',
    opening_line: '第三次出问题了！再给我推诿我就投诉到市监局，还有媒体！',
    profile: { issue: 'escalation', emotion: 'rage', objections: ['angry', 'complaint', 'refund'] },
  },
  {
    persona_key: 'cs_refund_lawyer',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 9,
    title: '高难客服 · 律师函威胁退款',
    opening_line: '我们法务已经起草律师函了，今天不给退款方案就走流程。',
    profile: { issue: 'legal_refund', emotion: 'cold', objections: ['refund', 'angry'] },
  },
  {
    persona_key: 'cs_multi_issue',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 6,
    title: '高难客服 · 多问题连环抛',
    opening_line: '短信没发、积分错了、活动又上不去——你们到底能不能一次性说清楚？',
    profile: { issue: 'multi', objections: ['complaint', 'ux_bad', 'angry'] },
  },
  {
    persona_key: 'cs_ux_loop',
    track: 'cs', audience: 'both', source_type: 'builtin', difficulty: 5,
    title: '客服 · 反复说不好用',
    opening_line: '我说了不好用，你们别再叫我重启。到底怎么改？',
    profile: { issue: 'ux_loop', objections: ['ux_bad', 'angry'] },
  },
  {
    persona_key: 'cs_account_permission',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 2,
    title: '客服 · 账号与权限问题',
    opening_line: '我们店长账号突然登不进去了，另一个员工看不到该看的报表，你们系统怎么回事？',
    profile: { issue: 'account_permission', emotion: 'anxious', traits: ['要时限', '要解决'], objections: ['complaint', 'angry'] },
  },
  {
    persona_key: 'cs_sync_delay',
    track: 'cs', audience: 'internal', source_type: 'builtin', difficulty: 2,
    title: '客服 · 数据同步延迟',
    opening_line: '今天后台的数据一直不更新，昨天的营业数据到现在还没出来，你们到底怎么了？',
    profile: { issue: 'sync_delay', emotion: 'anxious', traits: ['要时效', '要确认'], objections: ['complaint'] },
  },
  {
    persona_key: 'cs_growth_diagnosis',
    track: 'consult', audience: 'both', source_type: 'builtin', difficulty: 3,
    title: '老板咨询 · 经营诊断怎么用',
    opening_line: '你们说的经营诊断，到底能查出我店里什么问题？数据从哪来的？准不准？',
    profile: { role: '老板', issue: 'growth_diagnosis', emotion: 'curious', traits: ['要数据来源', '要可信度'], objections: [] },
  },
  {
    persona_key: 'cs_marketing_sms',
    track: 'consult', audience: 'both', source_type: 'builtin', difficulty: 3,
    title: '老板咨询 · 短信/企微营销触达',
    opening_line: '我想给老顾客发营销短信，你们系统能按人群发吗？会不会打扰顾客？效果怎么看？',
    profile: { role: '老板', issue: 'marketing_sms', emotion: 'curious', traits: ['要人群分层', '要效果归因'], objections: [] },
  },
  {
    persona_key: 'cs_pos_data_connect',
    track: 'consult', audience: 'both', source_type: 'builtin', difficulty: 2,
    title: '老板咨询 · POS/收银数据接入',
    opening_line: '我们店用的是二维火收银，你们的系统能接上吗？接上后数据多久同步一次？',
    profile: { role: '老板', issue: 'pos_data_connect', emotion: 'neutral', traits: ['要对接范围', '要时效'], objections: [] },
  },
  {
    persona_key: 'cs_report_billing',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '老板对账 · 系统报表口径',
    opening_line: '系统里营业额报表和店里实际流水对不上，你们的口径到底是什么？退款算不算？',
    profile: { role: '老板', issue: 'report_billing', emotion: 'anxious', traits: ['要口径', '要核对流程'], objections: ['complaint'] },
  },
  {
    persona_key: 'cs_activity_setup',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '老板自助 · 活动创建与短信群发',
    opening_line: '我想自己在后台建一个会员日活动，还想群发短信，但不知道从哪开始，你能一步一步教我操作吗？',
    profile: { role: '老板', issue: 'activity_setup', emotion: 'patient', traits: ['要步骤', '要可执行'], objections: [] },
  },
  {
    persona_key: 'cs_ai_service_query',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '老板咨询 · AI客服怎么用',
    opening_line: '你们那个AI客服，能帮我店里自动回顾客消息吗？会不会答错？能转人工吗？',
    profile: { role: '老板', issue: 'ai_service_query', emotion: 'curious', traits: ['要功能边界', '要人工兜底'], objections: [] },
  },
  {
    persona_key: 'cs_employee_perf',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '老板咨询 · 员工考勤与绩效',
    opening_line: '我想用系统管员工考勤和绩效，打卡数据准不准？绩效怎么评的？员工能看到吗？',
    profile: { role: '老板', issue: 'employee_perf', emotion: 'neutral', traits: ['要数据来源', '要权限边界'], objections: [] },
  },
  {
    persona_key: 'cs_approval_flow',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '老板咨询 · 审批与请款流程',
    opening_line: '店里请款、报销能不能走系统审批？流程怎么设？谁来审？留不留记录？',
    profile: { role: '老板', issue: 'approval_flow', emotion: 'neutral', traits: ['要流程配置', '要留痕'], objections: [] },
  },
  {
    persona_key: 'cs_training_qa',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 2,
    title: '老板咨询 · 员工培训认证',
    opening_line: '我想给员工做培训，系统里有现成内容吗？考完试怎么认证？和晋升挂钩吗？',
    profile: { role: '老板', issue: 'training_qa', emotion: 'curious', traits: ['要内容', '要认证闭环'], objections: [] },
  },
  {
    persona_key: 'cs_marketing_strategy',
    track: 'consult', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '老板咨询 · 客户分层与营销策略',
    opening_line: '我们店老客流失不少，系统能帮我分客户吗？针对不同人群该做什么活动？',
    profile: { role: '老板', issue: 'marketing_strategy', emotion: 'curious', traits: ['要分层', '要策略', '要归因'], objections: [] },
  },
  {
    persona_key: 'sales_roi_question',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '经营专业 · ROI 测算质疑',
    opening_line: '你一直说一年两万能帮我们多赚钱，具体怎么算的？给我一个账本，别光说概念。',
    profile: { name: '老板', stores: 2, cuisine: '火锅', daily_revenue: 25000, traits: ['要算账', '要边界'], objections: ['too_expensive'] },
  },
  {
    persona_key: 'sales_competitor_compare',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '经营专业 · 竞品对比',
    opening_line: '隔壁推的那家比你们便宜一半，功能看着也差不多，凭什么选你们？',
    profile: { name: '老板', stores: 3, traits: ['比价', '要证据'], objections: ['too_expensive', 'ask_features'] },
  },
  {
    persona_key: 'sales_solution_demo',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '经营专业 · 落地实施方案',
    opening_line: '别讲功能了，你就告诉我，我们店拿到这套系统后，第一周、第一个月你们的人会做什么？',
    profile: { name: '店长', stores: 1, traits: ['要落地', '要分工'], objections: ['no_time'] },
  },
  {
    persona_key: 'sales_customer_segmentation',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '经营专业 · 客户分层运营方案',
    opening_line: '我们店会员几千个，但我分不清谁值得重点维护。你们能做客户分层吗？分了之后干什么？',
    profile: { name: '老板', stores: 2, traits: ['要分层', '要策略', '要衡量'], objections: ['ask_features'] },
  },
  {
    persona_key: 'sales_channel_growth',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '经营专业 · 堂食外卖增长方案',
    opening_line: '我们店堂食还行，外卖一直起不来，你们能给出具体增长方案吗？',
    profile: { name: '老板', stores: 2, traits: ['要渠道策略', '要落地'], objections: ['too_expensive', 'no_time'] },
  },
  {
    persona_key: 'sales_employee_exec',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 4,
    title: '经营专业 · 员工执行力方案',
    opening_line: '问题都知道，就是下面执行不下去。你们系统怎么保证员工真去做了？',
    profile: { name: '老板', stores: 3, traits: ['要任务闭环', '要验收'], objections: ['ai_useless'] },
  },
  {
    persona_key: 'sales_renew_upgrade',
    track: 'sales', audience: 'internal', source_type: 'builtin', difficulty: 3,
    title: '经营专业 · 续费升级咨询',
    opening_line: '我们用了快一年了，感觉还行但也没特别明显。续费值不值？有没有新东西？',
    profile: { name: '老板', stores: 1, traits: ['要价值回顾', '要升级理由'], objections: ['too_expensive', 'think_again'] },
  },
  {
    persona_key: 'store_diner_complaint',
    track: 'cs', audience: 'tenant', source_type: 'store', difficulty: 2,
    title: '门店 · 堂食客投诉上菜慢',
    opening_line: '等了四十分钟菜还没来，孩子都哭了，你们怎么做事的？',
    profile: { issue: 'slow_service', channel: 'dine_in', objections: ['angry', 'complaint'] },
  },
  {
    persona_key: 'store_delivery_late',
    track: 'cs', audience: 'tenant', source_type: 'store', difficulty: 3,
    title: '门店 · 外卖超时索赔',
    opening_line: '外卖超时一小时，餐凉了，我要全额退款加补偿！',
    profile: { issue: 'delivery_late', objections: ['refund', 'angry'] },
  },
  {
    persona_key: 'store_member_points',
    track: 'cs', audience: 'tenant', source_type: 'store', difficulty: 3,
    title: '门店 · 会员积分不对',
    opening_line: '我充值的积分怎么少了两百？你们是不是系统又出错了？',
    profile: { issue: 'points', objections: ['complaint', 'ux_bad'] },
  },
  ...BUILTIN_STORE_PERSONAS,
];

export async function ensurePersonaSeed(pool) {
  for (const p of BUILTIN_PERSONAS) {
    await pool.query(
      `INSERT INTO sales_sim_personas
         (persona_key, track, title, difficulty, profile, opening_line, audience, source_type)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (persona_key) DO UPDATE SET
         track=EXCLUDED.track, title=EXCLUDED.title, difficulty=EXCLUDED.difficulty,
         profile=EXCLUDED.profile, opening_line=EXCLUDED.opening_line,
         audience=EXCLUDED.audience, source_type=EXCLUDED.source_type, active=TRUE`,
      [
        p.persona_key, p.track, p.title, p.difficulty,
        JSON.stringify(p.profile), p.opening_line,
        p.audience || 'internal', p.source_type || 'builtin',
      ]
    );
  }
}

export async function listPersonas(pool, track, { audience = null, tenantId = null } = {}) {
  await ensurePersonaSeed(pool);
  const r = await pool.query(
    `SELECT persona_key, track, title, difficulty, profile, opening_line, audience, source_type, tenant_id
       FROM sales_sim_personas
      WHERE active=TRUE
        AND ($1::text IS NULL OR track=$1)
        AND (
          $2::text IS NULL
          OR audience=$2
          OR audience='both'
          OR ($2='internal' AND audience IN ('internal','both'))
        )
        AND ($3::text IS NULL OR tenant_id IS NULL OR tenant_id=$3)
      ORDER BY track, difficulty, persona_key`,
    [track || null, audience, tenantId]
  );
  return r.rows || [];
}

export async function getPersona(pool, personaKey) {
  await ensurePersonaSeed(pool);
  const r = await pool.query(`SELECT * FROM sales_sim_personas WHERE persona_key=$1 AND active=TRUE`, [personaKey]);
  return r.rows?.[0] || null;
}

export async function upsertBusinessPersona(pool, persona) {
  await pool.query(
    `INSERT INTO sales_sim_personas
       (persona_key, track, title, difficulty, profile, opening_line, audience, source_type, tenant_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     ON CONFLICT (persona_key) DO UPDATE SET
       title=EXCLUDED.title, difficulty=EXCLUDED.difficulty, profile=EXCLUDED.profile,
       opening_line=EXCLUDED.opening_line, audience=EXCLUDED.audience,
       source_type=EXCLUDED.source_type, tenant_id=EXCLUDED.tenant_id, active=TRUE`,
    [
      persona.persona_key, persona.track || 'sales', persona.title, persona.difficulty || 5,
      JSON.stringify(persona.profile || {}), persona.opening_line,
      persona.audience || 'internal', persona.source_type || 'business', persona.tenant_id || null,
    ]
  );
  return getPersona(pool, persona.persona_key);
}
