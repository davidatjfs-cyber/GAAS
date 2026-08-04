/**
 * 餐饮顾客真实负反馈知识库（Restaurant Negative Feedback Corpus）种子
 * 每条语料绑定：触发条件 + 客户人格 + 当前情绪 + 后续行为。
 * 来源：业务专家提供首批 82 条（2026-08-02）+ 后续真实桌访/差评提取。
 */

const CATEGORY_DEFAULTS = {
  waiting: {
    label: '等位', stage: '等位', severity: 2, emotion: 62,
    expected: ['告知预计时间', '安抚', '按号顺序透明'],
    avoid: ['敷衍', '不知道', '插队安排'],
  },
  no_greeting: {
    label: '没人接待', stage: '进店', severity: 2, emotion: 58,
    expected: ['立即接待', '致歉', '安排落座'],
    avoid: ['当作没看见', '推给其他人'],
  },
  ordering: {
    label: '点菜体验', stage: '点菜', severity: 2, emotion: 60,
    expected: ['耐心介绍', '先了解需求再推荐', '给选择空间'],
    avoid: ['一直催点', '只推贵的', '推荐过多'],
  },
  slow_service: {
    label: '上菜慢', stage: '催菜', severity: 3, emotion: 58,
    expected: ['查询订单', '告知预计时间', '催后厨'],
    avoid: ['敷衍', '不知道', '再等等'],
  },
  wrong_dish: {
    label: '上错菜', stage: '上菜', severity: 3, emotion: 56,
    expected: ['确认事实', '致歉', '换菜并优先出菜'],
    avoid: ['争辩', '否认', '让客人将就'],
  },
  missing_dish: {
    label: '漏菜', stage: '上菜', severity: 3, emotion: 55,
    expected: ['查单确认', '加急补菜', '必要时免单该菜'],
    avoid: ['说不可能', '让客人再等不管'],
  },
  dish_quality: {
    label: '菜品问题', stage: '用餐', severity: 3, emotion: 58,
    expected: ['先致歉', '重做或换菜', '征询口味'],
    avoid: ['辩解', '说别人没说过', '让客人将就'],
  },
  portion: {
    label: '分量', stage: '用餐', severity: 2, emotion: 62,
    expected: ['解释分量口径', '可补量', '不敷衍'],
    avoid: ['说就是这么多', '和客人争'],
  },
  service_attitude: {
    label: '服务态度', stage: '席间', severity: 3, emotion: 54,
    expected: ['主管/店长介入', '致歉', '当场改进'],
    avoid: ['顶撞', '冷漠', '互相推诿'],
  },
  environment: {
    label: '环境', stage: '用餐', severity: 2, emotion: 60,
    expected: ['记录问题', '当场处理', '给补偿或说明'],
    avoid: ['说没办法', '不当回事'],
  },
  checkout: {
    label: '结账', stage: '结账', severity: 2, emotion: 60,
    expected: ['快速处理', '核对账单', '开通快速结账'],
    avoid: ['让客人等', '说系统问题不解决'],
  },
  post_visit: {
    label: '离店后反馈', stage: '离店后', severity: 2, emotion: 50,
    expected: ['认真记录', '回复致歉', '改进承诺'],
    avoid: ['模板化回复', '不处理'],
  },
};

// [code, categoryKey, content, severity覆盖?, emotion覆盖?, style覆盖?]
const ROWS = [
  ['NEG-001', 'waiting', '请问还要多久？'],
  ['NEG-002', 'waiting', '预计不是二十分钟吗？'],
  ['NEG-003', 'waiting', '前面还有几桌？'],
  ['NEG-004', 'waiting', '刚刚来的怎么先进去了？'],
  ['NEG-005', 'waiting', '不是按号码叫的吗？'],
  ['NEG-006', 'waiting', '我们已经等半个小时了。'],
  ['NEG-007', 'waiting', '如果还要这么久我们就换一家了。', 3, 45],
  ['NEG-010', 'no_greeting', '有人吗？'],
  ['NEG-011', 'no_greeting', '不好意思，可以帮我们安排一下吗？'],
  ['NEG-012', 'no_greeting', '站了好几分钟了。'],
  ['NEG-013', 'no_greeting', '是不是没人负责门口？', 2, 52],
  ['NEG-020', 'ordering', '菜单有点看不懂。'],
  ['NEG-021', 'ordering', '哪个是你们招牌？'],
  ['NEG-022', 'ordering', '有没有图片？'],
  ['NEG-023', 'ordering', '服务员一直催我们点。', 3, 50],
  ['NEG-024', 'ordering', '能不能让我们先看看？'],
  ['NEG-025', 'ordering', '推荐这么多，我们都不知道点什么了。'],
  ['NEG-026', 'ordering', '感觉一直在推贵的。', 3, 48],
  ['NEG-100', 'slow_service', '不好意思，我们那个菜还没好吗？', 2, 70, 'polite'],
  ['NEG-101', 'slow_service', '是不是漏掉了？', 2, 62],
  ['NEG-102', 'slow_service', '我们等挺久了。'],
  ['NEG-103', 'slow_service', '隔壁桌比我们晚来都上齐了。', 2, 55],
  ['NEG-104', 'slow_service', '是不是忘记我们这桌了？', 2, 55],
  ['NEG-105', 'slow_service', '要不先取消吧。', 3, 45],
  ['NEG-106', 'slow_service', '后面的菜什么时候能上？'],
  ['NEG-107', 'slow_service', '今天厨房是不是特别忙？', 2, 58],
  ['NEG-108', 'slow_service', '这个速度有点慢。', 2, 58],
  ['NEG-109', 'slow_service', '再不上孩子都饿哭了。', 3, 48],
  ['NEG-110', 'slow_service', '老人已经等不住了。', 3, 48],
  ['NEG-150', 'wrong_dish', '这个不是我们点的。'],
  ['NEG-151', 'wrong_dish', '是不是送错桌了？'],
  ['NEG-152', 'wrong_dish', '我们没点这个。'],
  ['NEG-153', 'wrong_dish', '麻烦帮我们确认一下。'],
  ['NEG-154', 'wrong_dish', '我们点的是另外一个。'],
  ['NEG-170', 'missing_dish', '还有一个菜没上。'],
  ['NEG-171', 'missing_dish', '是不是漏了一道？'],
  ['NEG-172', 'missing_dish', '菜单上这个没有。'],
  ['NEG-173', 'missing_dish', '是不是忘记做了？'],
  ['NEG-200', 'dish_quality', '今天有点咸。'],
  ['NEG-201', 'dish_quality', '这个有点淡。'],
  ['NEG-202', 'dish_quality', '牛肉有点老。'],
  ['NEG-203', 'dish_quality', '这个不够热。'],
  ['NEG-204', 'dish_quality', '烧鹅今天没有之前香。'],
  ['NEG-205', 'dish_quality', '今天火候差一点。'],
  ['NEG-206', 'dish_quality', '感觉没有上次好吃。'],
  ['NEG-207', 'dish_quality', '是不是今天换厨师了？'],
  ['NEG-208', 'dish_quality', '这个有点油。'],
  ['NEG-209', 'dish_quality', '这个有点腥。'],
  ['NEG-210', 'dish_quality', '今天鱼没有那么新鲜。', 3, 52],
  ['NEG-211', 'dish_quality', '这个口感有点奇怪。'],
  ['NEG-212', 'dish_quality', '今天发挥不太稳定。'],
  ['NEG-230', 'portion', '怎么感觉比以前少？'],
  ['NEG-231', 'portion', '这个份量有点小。'],
  ['NEG-232', 'portion', '价格没变，量少了。', 3, 52],
  ['NEG-260', 'service_attitude', '服务员好像一直很忙。'],
  ['NEG-261', 'service_attitude', '叫了几次没人回应。', 3, 50],
  ['NEG-262', 'service_attitude', '可以帮我们一下吗？'],
  ['NEG-263', 'service_attitude', '态度是不是有点冷？', 3, 52],
  ['NEG-264', 'service_attitude', '一直没人理我们。', 3, 50],
  ['NEG-265', 'service_attitude', '感觉服务不是很主动。'],
  ['NEG-266', 'service_attitude', '一直找不到服务员。', 3, 50],
  ['NEG-300', 'environment', '今天有点吵。'],
  ['NEG-301', 'environment', '空调是不是没开？'],
  ['NEG-302', 'environment', '这里有点热。'],
  ['NEG-303', 'environment', '厕所味道有点重。', 3, 48],
  ['NEG-304', 'environment', '桌子没有擦干净。', 3, 50],
  ['NEG-305', 'environment', '餐具还有水。', 2, 55],
  ['NEG-306', 'environment', '这里灯有点暗。'],
  ['NEG-350', 'checkout', '可以结账了吗？'],
  ['NEG-351', 'checkout', '等了挺久了。'],
  ['NEG-352', 'checkout', '扫码怎么一直不行？', 2, 55],
  ['NEG-353', 'checkout', '会员不能用吗？', 3, 48],
  ['NEG-354', 'checkout', '这个价格是不是算错了？', 3, 50],
  ['NEG-355', 'checkout', '帮我核对一下账单。'],
  ['NEG-400', 'post_visit', '今天体验一般。'],
  ['NEG-401', 'post_visit', '菜不错，就是太慢。'],
  ['NEG-402', 'post_visit', '服务还可以，就是不够及时。'],
  ['NEG-403', 'post_visit', '应该不会专门再来了。', 3, 42],
  ['NEG-404', 'post_visit', '朋友来我可能不会推荐。', 3, 42],
  ['NEG-405', 'post_visit', '有点失望。', 3, 45],
  ['NEG-406', 'post_visit', '没有想象中那么好。', 2, 50],
  ['NEG-407', 'post_visit', '下次再看看吧。'],
];

function buildEntries() {
  const seen = new Set();
  const entries = [];
  for (const row of ROWS) {
    const [code, category, content, severity, emotion, style] = row;
    if (seen.has(code)) throw new Error(`duplicate corpus code ${code}`);
    seen.add(code);
    const d = CATEGORY_DEFAULTS[category];
    if (!d) throw new Error(`unknown corpus category ${category}`);
    entries.push({
      code,
      category,
      sub_category: d.label,
      scene: '',
      customer_type: '',
      emotion: emotion ?? d.emotion,
      stage: d.stage,
      severity: severity ?? d.severity,
      trigger: '',
      expression_style: style || guessStyle(content),
      content,
      expected_action: d.expected,
      avoid_action: d.avoid,
      source: 'expert',
    });
  }
  return entries;
}

function guessStyle(content) {
  if (/不好意思|麻烦|可以.*吗|请/.test(content)) return 'polite';
  if (/感觉|有点|应该|一般/.test(content)) return '委婉';
  if (/？|吗/.test(content)) return 'direct';
  return 'direct';
}

export const NEGATIVE_FEEDBACK_SEED = buildEntries();

export async function ensureNegativeFeedbackSeed(pool) {
  for (const e of NEGATIVE_FEEDBACK_SEED) {
    await pool.query(
      `INSERT INTO customer_twin_negative_feedback
         (code, category, sub_category, scene, customer_type, emotion, stage, severity,
          trigger, expression_style, content, expected_action, avoid_action, source, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'default')
       ON CONFLICT (code) DO NOTHING`,
      [
        e.code, e.category, e.sub_category, e.scene, e.customer_type, e.emotion, e.stage,
        e.severity, e.trigger, e.expression_style, e.content, e.expected_action, e.avoid_action,
        e.source,
      ]
    );
  }
}
