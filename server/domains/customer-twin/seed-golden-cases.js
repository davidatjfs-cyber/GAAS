/**
 * 黄金基准集首批已批准案例（2026-08-05 专家确认，Ground Truth）。
 * 判卷总则：情绪连续、符合真实消费者心理、行为可判卷、恢复效果有限。
 * Recovery Ceiling（恢复上限）：食安65 / 服务态度60 / 招牌售罄58 / 菜品口味70 / 催菜85。
 */

const GOLDEN_CASES = [
  {
    case_id: 'G_TV_5508d9f9',
    title: '食安事件（蟑螂+苍蝇）与完整恢复',
    difficulty: 4,
    purpose: '测试食安底线型事件 + 恢复链 + 不写差评诉求',
    status: 'approved',
    schema_version: 'v1',
    payload: {
      persona: {
        visit: '首次到店（大桌/高消费）', intent: '家庭聚餐', service: '高敏感',
        environment: '高敏感（食安零容忍）', food: '高', expression: '委婉',
        complaint: '低（给机会）', recovery: '高（真诚处理可恢复）',
      },
      background: '2026-12-08｜洪潮大宁久光店｜多人包房｜消费 2802 元',
      goal: ['体验', '聊天', '吃好'],
      expectation: '对菜品包房满意，正常用餐',
      timeline: [
        { t: '入座点菜', emotion: 85 },
        { t: 'v1桌跑出蟑螂', emotion: 35 },
        { t: '处理异物并致歉', emotion: 55 },
        { t: '餐中苍蝇再现', emotion: 42 },
        { t: '打折并再次致歉', emotion: 58 },
        { t: '买单离店', emotion: 62 },
      ],
      emotion_curve: [85, 35, 55, 42, 58, 62],
      standard_feedback: [
        '服务员，这边有只蟑螂。',
        '麻烦过来看一下。',
        '说实话，这样真的影响胃口。',
        '（苍蝇再现）怎么又来了？',
        '菜其实不错，就是卫生这块一定得整改。',
      ],
      standard_complaint: '菜是好吃的，但这卫生让人心里发毛，一晚上又是蟑螂又是苍蝇。',
      negative: ['不会直接报警/曝光/辱骂/离店', '不会说"再也不来"（接受处理但卫生记忆留存）'],
      ordering_behavior: '高消费桌，接受菜品/饮料/折扣补偿；对"不要写差评"的要求未直接承诺',
      recommendation_acceptance: { 热菜饮料: '接受', 打折: '接受', 领导致歉: '接受' },
      recovery: [
        { action: '立即处理异物', value: 8 },
        { action: '负责人道歉', value: 6 },
        { action: '赠送菜品饮品', value: 5 },
        { action: '菜品打折', value: 4 },
        { action: '领导沟通', value: 4 },
      ],
      recovery_max: 27,
      recovery_ceiling: 65,
      final_satisfaction: { 菜: 38, 服务: 27, 环境: 8, 等待: 18, 补偿: 8, 总分: '63~66' },
      final_behavior: { 现场投诉: '否', 点评: '未写差评（原文）', 复购: '会（给改正机会）', 推荐: '一般' },
      expert_note: '食安事件属于"底线型事件"，任何补偿都只能减轻情绪，无法完全消除风险记忆；恢复后的满意度原则上不得高于事件发生前水平的 80%。',
      judgment_rules: [
        '食安事件恢复后满意度不得高于事件发生前水平的 80%（判卷规则）',
        '补偿只能减轻情绪，不能消除卫生风险记忆；AI 恢复到接近满分即判失真',
      ],
    },
    source_record_ids: ['table_visit_records:G_TV_5508d9f9'],
  },
  {
    case_id: 'G_BR_c3869c2e',
    title: '服务员态度恶劣（擦桌带情绪/烟灰缸不收）',
    difficulty: 4,
    purpose: '测试服务态度软性伤害 + 情绪升级 + 线上差评',
    status: 'approved',
    schema_version: 'v1',
    payload: {
      persona: {
        visit: '到店用餐（外摆桌）', intent: '家庭/聚餐', service: '高敏感',
        environment: '中高（要求擦桌）', expression: '直接', complaint: '线上（大众点评 3 星）',
        recovery: '中（态度问题难恢复）',
      },
      background: '06/03｜马己仙大宁店｜外摆区域｜多人',
      goal: ['干净', '正常用餐体验'],
      expectation: '基本服务到位',
      timeline: [
        { t: '入座点菜', emotion: 80 },
        { t: '要求擦拭桌子', emotion: 72 },
        { t: '服务员带情绪擦桌', emotion: 58 },
        { t: '烟灰缸未收要求收走', emotion: 48 },
        { t: '态度依旧不好', emotion: 42 },
        { t: '结账离店 → 3 星', emotion: 42 },
      ],
      emotion_curve: [80, 72, 58, 48, 42],
      standard_feedback: [
        '麻烦帮我们擦一下桌子，谢谢。',
        '烟灰缸也麻烦一起收一下。',
        '是不是我们哪里让你不高兴了？',
        '如果一直这样，我们这顿饭体验真的很差。',
      ],
      standard_complaint: '服务员态度恶劣，擦桌带情绪，烟灰缸不收，体验极差。',
      negative: ['不会当场大吵', '不会辱骂', '不会报警'],
      ordering_behavior: '正常点餐，不满集中在服务过程',
      recommendation_acceptance: {},
      recovery: [
        { action: '经理 2 分钟内主动换服务员', value: 10 },
        { action: '经理未出现', value: 0 },
      ],
      recovery_max: 10,
      recovery_ceiling: 60,
      final_satisfaction: { 菜: 30, 服务: 15, 环境: 20, 等待: 0, 补偿: 0, 总分: '约 50-55' },
      final_behavior: { 现场投诉: '否', 点评: '大众点评 3 星', 复购: '不确定' },
      expert_note: '服务态度类扣分最难恢复——不是送东西能解决的，需要"人"的转变；态度事件后情绪曲线持续低位。',
      judgment_rules: [
        '态度冲突后若 AI 仍让原服务员继续服务，判定为失真（判卷规则）',
        '态度问题必须换人处理；经理及时介入换人恢复 +10，经理未出现恢复 0',
      ],
    },
    source_record_ids: ['agent_messages:G_BR_c3869c2e'],
  },
  {
    case_id: 'G_BR_355da999',
    title: '招牌烧鹅售罄 + 沟通措辞不当 → 0.5 星',
    difficulty: 4,
    purpose: '测试招牌售罄的期望管理 + 沟通措辞',
    status: 'approved',
    schema_version: 'v1',
    payload: {
      persona: {
        visit: '慕名而来（专为吃招牌）', intent: 'taste', food: '高（烧鹅）',
        expression: '直接', complaint: '线上（大众点评 0.5 星）', recovery: '中',
      },
      background: '05/15 19:30｜马己仙大宁店｜特意来吃烧鹅',
      goal: ['吃到招牌', '体验'],
      expectation: '今天来店原因：专门为了烧鹅',
      timeline: [
        { t: '到店', emotion: 82 },
        { t: '被告知烧鹅售罄', emotion: 52 },
        { t: '沟通措辞不当', emotion: 38 },
        { t: '气愤离店 → 0.5 星', emotion: 32 },
      ],
      emotion_curve: [82, 52, 38, 32],
      standard_feedback: [
        '我们就是冲着烧鹅来的。',
        '七点半就卖完了吗？',
        '那你们应该提前告诉客人。',
        '这样处理我们确实接受不了。',
      ],
      standard_complaint: '七点半烧鹅就没了，服务员说话还那么难听，没培训过就上岗。',
      negative: ['不会说"留一份"', '不会当场闹', '不会要求赔偿'],
      ordering_behavior: '到店即点招牌，未点替代菜',
      recommendation_acceptance: {},
      recovery: [
        { action: '提前致歉', value: 6 },
        { action: '说明原因', value: 3 },
        { action: '推荐替代菜', value: 3 },
        { action: '赠送小菜', value: 2 },
        { action: '预约下次预留', value: 4 },
      ],
      recovery_max: 18,
      recovery_ceiling: 58,
      final_satisfaction: { 菜: 20, 服务: 15, 环境: 25, 等待: 0, 补偿: 0, 总分: '约 45' },
      final_behavior: { 现场投诉: '否', 点评: '大众点评 0.5 星（情绪强烈）', 复购: '否' },
      expert_note: '沽清是运营问题但可解释；真正引爆 0.5 星的是沟通措辞——培训重点是"售罄话术"（先致歉+给预期+给替代/预约方案）。',
      judgment_rules: [
        'AI 直接回答"没有了"→ 判定失败（判卷规则）',
        '话术达标："今天已经售罄，非常抱歉，这是我们准备不足，可以推荐现烤叉烧/黑金叉烧，方便的话下次提前帮您预留烧鹅"→ 判定优秀',
      ],
    },
    source_record_ids: ['agent_messages:G_BR_355da999'],
  },
];

export async function ensureGoldenCaseSeed(pool) {
  for (const c of GOLDEN_CASES) {
    await pool.query(
      `INSERT INTO customer_twin_golden_cases
         (case_id, title, difficulty, purpose, status, schema_version, payload, source_record_ids, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'default')
       ON CONFLICT (case_id) DO UPDATE SET
         title=EXCLUDED.title, difficulty=EXCLUDED.difficulty, purpose=EXCLUDED.purpose,
         status=EXCLUDED.status, schema_version=EXCLUDED.schema_version,
         payload=EXCLUDED.payload, source_record_ids=EXCLUDED.source_record_ids,
         updated_at=NOW()`,
      [c.case_id, c.title, c.difficulty, c.purpose, c.status, c.schema_version,
        JSON.stringify(c.payload), JSON.stringify(c.source_record_ids)]
    );
  }
}
