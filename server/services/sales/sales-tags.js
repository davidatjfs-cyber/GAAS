/**
 * 客户标签体系（规则可追溯，非黑盒）：基础标签 + 需求标签 + 销售标签
 */
const TAG_RULES = [
  // 基础标签
  { key: 'single_store', label: '单店客户', test: (l) => l.store_count === 1 },
  { key: 'chain_store', label: '连锁客户', test: (l) => (l.store_count || 0) >= 2 },
  { key: 'large_chain', label: '大型连锁', test: (l) => (l.store_count || 0) >= 10 },
  { key: 'high_check', label: '高客单餐厅', test: (l) => /粤菜|潮汕菜|日料|西餐|火锅|烧烤|烘焙|高端|宴请|正餐/.test(String(l.cuisine || '')) },
  { key: 'fast_food', label: '快餐客户', test: (l) => /快餐|小吃|粉面|饺子|粥|包子|汉堡|炸鸡|奶茶/.test(String(l.cuisine || '')) },
  { key: 'full_service', label: '正餐客户', test: (l) => /粤菜|潮汕菜|川菜|火锅|日料|西餐|湘菜|本帮菜|淮扬菜|云南菜|新疆菜|西北菜|江浙菜|东北菜|鲁菜|徽菜|闽菜/.test(String(l.cuisine || '')) && !/快餐|小吃/.test(String(l.cuisine || '')) },
  { key: 'new_store', label: '新开店', test: (l) => /新开业|新开店|刚开业|筹备|准备开业|开业不久|新品牌|创业/.test(String(l.notes || '') + String(l.extracted?.store_age || '')) },
  { key: 'mature_store', label: '成熟门店', test: (l) => (l.store_count || 0) >= 2 || /经营多年|老店|多年|开了.*年|成熟/.test(String(l.notes || '') + String(l.extracted?.store_age || '')) },
  { key: 'has_pos_data', label: '有POS数据', test: (l) => l.phone_data_ready === true },
  { key: 'has_member_data', label: '有会员数据', test: (l) => (l.member_estimate || 0) > 0 || l.extracted?.has_member_system === true },
  { key: 'no_data_base', label: '无数据基础', test: (l) => l.phone_data_ready === false && (l.member_estimate || 0) === 0 },

  // 需求标签
  { key: 'low_repurchase', label: '老客复购低', test: (l) => /复购|老客|流失|回店|回头客|复购率|沉睡/.test(String(l.pain_point || '')) },
  { key: 'revenue_decline', label: '营业额下降', test: (l) => /营业额下降|营业额|收入|营收|下滑|下降|赚钱|利润|流水|业绩|生意不好/.test(String(l.pain_point || '')) },
  { key: 'execution_weak', label: '店长执行弱', test: (l) => /门店执行|执行|店长|不会干|跟进|落地|督导|执行差|执行弱|人效|执行力/.test(String(l.pain_point || '')) },
  { key: 'talent_training', label: '员工培训困难', test: (l) => /人才培养|培训|人才|员工|培养|流失|招聘|人效|能力|员工流失|不稳定/.test(String(l.pain_point || '')) },
  { key: 'multi_store_management', label: '多店管理困难', test: (l) => /多店管理|多店|连锁|管理困难|管不过来|门店多|督导|巡店|标准化/.test(String(l.pain_point || '')) },
  { key: 'marketing_attribution', label: '营销无法归因', test: (l) => /营销归因|营销|投放|广告|推广|ROI|抖音|小红书|大众点评|广告费|触达|短信|企微|微信|私域|公域/.test(String(l.pain_point || '')) },
  { key: 'customer_churn', label: '客户流失严重', test: (l) => /流失|流失严重|客户流失|沉睡|流失预警|流失率|客户跑了/.test(String(l.pain_point || '')) },
  { key: 'lack_data', label: '老板缺少经营数据', test: (l) => /缺少经营数据|数据|报表|看不见|不清楚|不知道|数据孤岛|老板要看/.test(String(l.pain_point || '')) },

  // 销售标签
  { key: 'high_intent', label: '高意向', test: (l) => l.intent_level === 'high' },
  { key: 'initial_contact', label: '初步了解', test: (l) => ['new', 'ai_greeting'].includes(l.stage) && !l.pain_point },
  { key: 'clear_need', label: '有明确需求', test: (l) => l.intent_level !== 'high' && !!l.pain_point },
  { key: 'comparing', label: '正在对比产品', test: (l) => /COMPETITOR_MENTIONED/.test(String(JSON.stringify(l.events || []))) },
  { key: 'demo_done', label: '已看Demo', test: (l) => (l.demo_count || 0) > 0 },
  { key: 'quoted', label: '已询价', test: (l) => /ASK_PRICE/.test(String(JSON.stringify(l.events || []))) },
  { key: 'budget_known', label: '有预算', test: (l) => l.budget_range === 'high' || l.budget_range === 'low' || /ASK_PRICE|ASK_CONTRACT/.test(String(JSON.stringify(l.events || []))) },
  { key: 'decision_maker', label: '决策人已参与', test: (l) => l.decision_role === '老板' },
  { key: 'internal_discussion', label: '等待内部讨论', test: (l) => /内部|商量|讨论|审批|申请预算|和领导|和老板|合伙人|股东|董事会|下周回复|过几天|再联系/.test(String(l.notes || '') + String(l.extracted?.timeline || '')) },
  { key: 'on_hold', label: '暂缓', test: (l) => ['lost', 'unfit'].includes(l.stage) || /暂缓|暂不考虑|缓缓|过一段时间|年后再说|明年再说|暂时不需要|不着急|目前不需要/.test(String(l.notes || '')) },
  { key: 'lost', label: '失单', test: (l) => l.stage === 'lost' },
];

/**
 * 输入线索当前字段状态，输出标签数组。
 */
export function deriveTagsForLead(lead = {}) {
  return TAG_RULES.filter((rule) => rule.test(lead)).map((rule) => rule.label);
}

/**
 * 推荐最匹配案例/话术主题（按痛点+阶段）
 */
export function recommendCaseTheme(lead = {}) {
  const pain = lead.pain_point || lead.extracted?.pain_point || '';
  if (/复购|老客|流失|营销|私域|公域|触达|短信/.test(pain)) return '老客回店增长案例';
  if (/营业额|收入|业绩|下滑|营销归因|ROI/.test(pain)) return '营业额归因与增长案例';
  if (/执行|店长|督导|落地|人效|执行力/.test(pain)) return '门店执行闭环案例';
  if (/培训|人才|员工|流失|能力|不稳定/.test(pain)) return '人才培养与绩效案例';
  if (/多店|连锁|管理困难|标准化|巡店/.test(pain)) return '多店统一管理案例';
  if (/数据|报表|看不见|不清楚|数据孤岛/.test(pain)) return '老板经营日报案例';
  return '30天试跑案例';
}

/**
 * 按标签反推适合发送给客户的资料/案例
 */
export function recommendAssets(lead = {}) {
  const tags = lead.tags || [];
  const assets = [];
  if (tags.includes('老客复购低')) assets.push('老客回店增长案例', '客户分层自动营销介绍');
  if (tags.includes('营业额下降')) assets.push('营业额归因案例', '30天试跑结果样例');
  if (tags.includes('店长执行弱')) assets.push('门店执行闭环案例', 'AI店长日报样例');
  if (tags.includes('员工培训困难')) assets.push('人才培养与绩效案例');
  if (tags.includes('多店管理困难')) assets.push('多店统一管理案例', '督导巡店看板');
  if (tags.includes('营销无法归因')) assets.push('营销ROI归因案例');
  if (tags.includes('老板缺少经营数据')) assets.push('老板经营日报案例');
  if (tags.includes('连锁客户')) assets.push('连锁客户方案与报价');
  if (tags.includes('单店客户')) assets.push('单店启动方案');
  if (assets.length === 0) assets.push('30天试跑方案');
  return Array.from(new Set(assets));
}

/**
 * 推荐下一步动作（按阶段）
 */
export function recommendNextSteps(lead = {}) {
  const stage = lead.stage || 'new';
  const pain = lead.pain_point || lead.extracted?.pain_point || '';
  const steps = [];
  if (['new', 'ai_greeting'].includes(stage)) {
    steps.push('确认门店数量');
    if (!pain) steps.push('确认核心经营痛点');
    if (lead.phone_data_ready == null) steps.push('确认POS客户数据');
  }
  if (['need_identified'].includes(stage)) {
    steps.push('发送匹配案例');
    if (!lead.demo_count) steps.push('邀约Demo');
  }
  if (lead.demo_count > 0) {
    steps.push('询问最认可的功能');
    if (lead.decision_role !== '老板') steps.push('确认决策人是否参与');
    steps.push('确认接入条件与试跑门店');
  }
  if (/ASK_PRICE/.test(String(JSON.stringify(lead.events || [])))) {
    steps.push('不催单，发送ROI/试跑案例');
    steps.push('询问内部最大顾虑');
  }
  if (lead.trial_status === 'in_progress') {
    steps.push('检查试跑数据与目标达成');
  }
  return steps.length ? steps : ['保持触达，补齐关键信息'];
}
