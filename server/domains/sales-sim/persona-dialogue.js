/**
 * 人格路径对话推进引擎（2026-08-02 短期方案）
 *
 * 解决「AI 客户不读上下文、一直重复提问」：
 * 1. 每个 cs 人格一个追问队列（coverage 驱动）：学员每答对一问，客户承认并推进下一问；
 * 2. sales 按「已提出异议」跟踪覆盖：异议被回应 → 承认/购买信号，未回应 → 换角度追问，
 *    有限次数后升级或收束；
 * 3. 所有线路 used 去重 + 同意图上限：同一意图最多追问两次，之后必须升级/推进/收束。
 */

import { detectCustomerTriggers } from './principles.js';

/** 知识题查证承诺：不确定时的专业答法（查证后答复，不编造） */
const VERIFY_COMMIT_RE = /我.{0,3}(查|核实|确认|问|看)一下|确认后(答复|回复|告诉|发您)|稍后(给|答复|回复|告诉)|问清楚(再|后)|查清楚(再|后|给)|核实后/;

const normKey = (s) => String(s || '')
  .replace(/[「」""'：:，,。！？?\s]/g, '')
  .slice(0, 36);

function pickUnused(lines, usedKeys) {
  for (const line of lines || []) {
    if (!usedKeys.includes(normKey(line))) return line;
  }
  return null;
}

function isCovered(texts, patterns) {
  const joined = texts.filter(Boolean).join('\n');
  return (patterns || []).some((re) => re.test(joined));
}

const ESCALATE_LINES = {
  cs: ['都这么久了还没个说法，我很失望。你们到底能不能解决？'],
  sales: ['你一直说不清楚重点，我先不耽误时间了。'],
};

const CLOSE_LINES = {
  cs: ['行了，先这样吧，我这边自己看着办。', '好，我先等你的结果。'],
  sales: ['行了，我先忙了，有需要再联系你们。'],
};

/**
 * cs 人格追问队列：concerns 按顺序推进；
 * covered 命中全部学员发言 → 该问已答；ack 用于「刚答对时承认并推进」。
 */
const CS_SCRIPTS = {
  cs_sms_fail: {
    concerns: [
      {
        key: 'timeline',
        covered: [/马上|立刻|尽快|分钟|小时|稍后|预计|答复|今天内|先查/],
        press: [
          '那到底什么时候能解决？给个大概时间。',
          '会员一直催我，你总得给我一个准信儿吧？',
        ],
        ack: [
          '行，那赶紧查，查到什么原因第一时间告诉我。',
          '好，我等你消息，查出结果马上跟我说。',
        ],
      },
      {
        key: 'cause',
        covered: [/原因|因为|冲突|故障|卡死|卡在|查到了|查明|排查|确认是|已恢复|恢复了|修复|解决|运营商|系统/],
        press: [
          '你们查到原因了吗？短信到底卡在哪个环节？',
          '为什么会突然发不出去？给我说清楚原因。',
        ],
        ack: [
          '找到原因就好，那短信现在能正常发出去了吗？',
          '明白了。那接下来怎么处理，多久能恢复？',
        ],
      },
      {
        key: 'verification',
        covered: [/确认.{0,8}(收到|送达|发出|发送|成功|没问题)|回访|通知|验证|跟进|盯|随时|发出去|全部|补发|汇报|结果|告诉|说一声|监控/],
        press: [
          '你说解决了，我怎么确认会员真的都收到了？',
          '那这批短信会补发吗？什么时候能全部发完？',
        ],
        ack: [
          '好，那就按你说的来，处理完务必跟我说一声。',
        ],
      },
    ],
    resolved: [
      '行，那你们盯紧点，处理完了跟我说一声，谢谢。',
      '好，先这样，希望这次能彻底解决。',
    ],
  },

  cs_angry_bug: {
    concerns: [
      {
        key: 'empathy',
        covered: [/理解|明白|知道了|您的感受|我懂|确实有问题|抱歉|对不起|不好意思|换我|也会|着急|一起|马上帮|先安抚|重视/],
        press: [
          '我点半天都找不到活动，你们自己用过这个后台吗？我真的很生气。',
          '你倒是说说到底怎么回事，别总让我等。',
        ],
        ack: [
          '谢谢理解。反正我是真的受够了，你们打算怎么处理？',
        ],
      },
      {
        key: 'expectation',
        covered: [/希望.{0,6}怎么|期望|方便告诉|想怎么|当时想|怎么操作|您觉得|建议|按您|按你说|明白|收到|很有道理|记录|反馈|采纳|会尽快|没问题|可以|一定改|安排/],
        press: [
          '那你们到底打算怎么改？',
          '我就想知道这个功能怎么用，或者能不能改简单点？',
        ],
        ack: [
          '行，那我等你改完告诉我。',
        ],
      },
      {
        key: 'fix',
        covered: [/修复|优化|改进|更新|版本|安排|处理|时间|马上|尽快|改好/],
        press: [
          '改完什么时候能用上？给我个时间。',
          '别光说会改，具体什么时候上线？',
        ],
        ack: [
          '好，那改好第一时间通知我。',
        ],
      },
    ],
    resolved: [
      '可以，我先用着看，希望这次真的能用。',
    ],
  },

  cs_refund: {
    concerns: [
      {
        key: 'root_cause',
        covered: [/未达预期|哪里没达到|哪方面|没达到|失望|没效果|具体|原因|说清楚|不满意|了解|核实|调查/],
        press: [
          '别绕弯子，你们到底能不能退？',
          '我说了没效果，你们还要我重复几遍？',
        ],
        ack: [
          '原因说清楚了，那你们打算怎么处理？',
        ],
      },
      {
        key: 'remedy',
        covered: [/补偿|方案|解决|处理|挽回|延长|退款|退钱|换|赠送|优惠|弥补/],
        press: [
          '光道歉没用，给我个实际方案。',
          '如果不能退，你们能做什么让我留下？',
        ],
        ack: [
          '这个方案可以接受的话，我就再考虑看看。',
        ],
      },
    ],
    resolved: [
      '行，那就按这个来，希望你们说到做到。',
    ],
  },

  cs_rage_escalation: {
    concerns: [
      {
        key: 'commitment',
        covered: [/抱歉|对不起|责任|马上|立刻|亲自|重视|处理|解决|负责/],
        press: [
          '我已经录音了，再推诿我就投诉到市监局！',
          '第三次了！你们到底负不负责？',
        ],
        ack: [
          '行，那我听你说，你们打算怎么解决？',
        ],
      },
      {
        key: 'plan',
        covered: [/方案|安排|步骤|谁负责|责任人|怎么处理|解决|补偿|时间|尽快/],
        press: [
          '说具体点，谁来办？多久？',
          '别给我空话，我要看到实际动作。',
        ],
        ack: [
          '可以，这是最后一次机会。处理不好我直接曝光。',
        ],
      },
      {
        key: 'compensation',
        covered: [/补偿|赔偿|减免|优惠|赠送|道歉|方案|损失/],
        press: [
          '出了问题，光处理完就完了？你们总得表示表示吧？',
          '这次给我们造成了损失，你们怎么赔？',
        ],
        ack: [
          '行，如果真做到位，这事我就不追究了。',
        ],
      },
    ],
    resolved: [
      '好，这次先相信你们，希望不要再有下次。',
    ],
  },

  cs_refund_lawyer: {
    concerns: [
      {
        key: 'legal_response',
        covered: [/合规|按合同|按协议|法务|律师|条款|流程|规定|答复|处理|核实|调查/],
        press: [
          '我们法务已经起草律师函了，你们打算怎么回应？',
          '别拖时间，今天就要个说法。',
        ],
        ack: [
          '好，那我听你们的答复，别让我走流程。',
        ],
      },
      {
        key: 'root_cause',
        covered: [/未达预期|原因|了解|核实|调查|核查|具体情况|哪方面/],
        press: [
          '让你们负责人来，别让客服跟我绕。',
          '我现在只想知道，这件事你们到底认不认？',
        ],
        ack: [
          '情况了解清楚就好，那解决方案呢？',
        ],
      },
      {
        key: 'remedy',
        covered: [/补偿|方案|退款|解决|处理|时间|尽快|书面/],
        press: [
          '给出书面方案，今天必须给我。',
          '别口头承诺，白纸黑字写下来。',
        ],
        ack: [
          '可以，那按这个执行，我不再走法律程序。',
        ],
      },
    ],
    resolved: [
      '好，那就按书面方案执行，我们保留追责权利。',
    ],
  },

  cs_multi_issue: {
    concerns: [
      {
        key: 'triage',
        covered: [/短信|积分|活动|逐个|一项|一起|三件事|每件|分别|先解决|都处理|全部/],
        press: [
          '短信没发、积分错了、活动上不去，你们一次说清楚怎么办！',
          '先别废话，这几件事你们能处理吗？',
        ],
        ack: [
          '行，那一件一件来，先告诉我每件事的处理方式。',
        ],
      },
      {
        key: 'plan',
        covered: [/方案|处理|解决|安排|谁负责|分别|每件|恢复/],
        press: [
          '每件事具体怎么处理？给个清单。',
          '你倒是挨个说，别只说总体的。',
        ],
        ack: [
          '可以，那三件事分别什么时候搞定？',
        ],
      },
      {
        key: 'eta',
        covered: [/时间|分钟|小时|今天|周|天|马上|尽快|稍后/],
        press: [
          '什么时候能全部解决？给个时间。',
          '我客户还在等，你给个明确时限。',
        ],
        ack: [
          '好，我等你处理结果。',
        ],
      },
    ],
    resolved: [
      '行，三件事都处理好，我再观察两天。',
    ],
  },

  cs_ux_loop: {
    concerns: [
      {
        key: 'repro',
        covered: [/具体|哪一步|哪个|页面|操作|复现|截图|路径|描述|方便告诉|怎么操作/],
        press: [
          '我说了不好用，你们到底听没听懂？',
          '每次都让我重启，你们不烦我还烦呢。',
        ],
        ack: [
          '对，就是那个活动编辑页，你们准备怎么改？',
        ],
      },
      {
        key: 'expectation',
        covered: [/希望.{0,6}怎么|期望|想怎么|简单|直接|一键|更好用|建议|明白|收到|很有道理|记录|反馈|采纳|会尽快|没问题|可以|一定改|安排/],
        press: [
          '我就想要简单点，这要求过分吗？',
          '你们做产品的人自己不用吗？',
        ],
        ack: [
          '行，那按我说的方向改，改完通知我。',
        ],
      },
      {
        key: 'fix',
        covered: [/修复|优化|改进|更新|版本|安排|处理|时间|马上|尽快|改/],
        press: [
          '什么时候能改好？',
          '别光说会优化，给个时间。',
        ],
        ack: [
          '好，我等着，希望这次真的能用。',
        ],
      },
    ],
    resolved: [
      '行，改好告诉我，我再用用看。',
    ],
  },

  cs_growth_diagnosis: {
    concerns: [
      {
        key: 'data_source',
        covered: [/POS|收银|日报|订单|消费|流水|同步|对接|数据源/],
        press: [
          '诊断的数据从哪来？是我们自己填还是系统自动拿？',
          '数据多久更新一次？',
        ],
        ack: [
          '数据来源清楚了。那你们主要看哪些指标？',
        ],
      },
      {
        key: 'indicator',
        covered: [/营业额|毛利|复购|客流|客单|执行|指标|异常|成本/],
        press: [
          '主要看哪些经营指标？',
          '能查出什么问题？',
        ],
        ack: [
          '指标明白了。诊断出问题之后，系统会做什么？',
        ],
      },
      {
        key: 'diagnosis_action',
        covered: [/任务|责任人|整改|方案|证据|验收|跟踪|改善|跟进/],
        press: [
          '查出问题之后呢？就给我个报告？',
          '谁会负责改？怎么验收？',
        ],
        ack: [
          '有闭环就好。',
        ],
      },
      {
        key: 'confidence',
        covered: [/口径|以实际|核对|不能保证|参考|辅助|前提|数据完整/],
        press: [
          '你们能保证诊断一定准吗？',
          '数据不准怎么办？',
        ],
        ack: [
          '边界我明白了。',
        ],
      },
    ],
    resolved: [
      '行，那我先看看我们店的诊断报告，有问题再找你。',
      '好，把诊断报告的指标口径发我一份。',
    ],
  },

  cs_marketing_sms: {
    concerns: [
      {
        key: 'audience',
        covered: [/分层|人群|标签|会员|活跃|沉睡|筛选|回店|流失/],
        press: [
          '能按人群发吗？比如只发3个月没来的老客？',
          '人群怎么选？',
        ],
        ack: [
          '人群能选就好。通过什么渠道触达？',
        ],
      },
      {
        key: 'channel',
        covered: [/短信|企微|公众号|触达|发送|通道|模板/],
        press: [
          '通过短信还是企微？',
          '能同时发吗？',
        ],
        ack: [
          '渠道知道了。会不会打扰顾客？',
        ],
      },
      {
        key: 'compliance',
        covered: [/退订|投诉|频次|上限|时间|扰|合规|封号|拦截/],
        press: [
          '老发会不会被投诉？',
          '有频次限制吗？',
        ],
        ack: [
          '合规上能放心。那效果怎么看？',
        ],
      },
      {
        key: 'attribution',
        covered: [/归因|ROI|回店|转化|效果|报表|统计|核销/],
        press: [
          '发了之后怎么知道有没有用？',
          '能看回店和消费吗？',
        ],
        ack: [
          '归因能看就行。',
        ],
      },
    ],
    resolved: [
      '行，那我先小范围试一批，看效果再扩大。',
      '好，把人群筛选和效果报表的操作方式发我。',
    ],
  },

  cs_pos_data_connect: {
    concerns: [
      {
        key: 'support',
        covered: [/二维火|美团|收银|支持|对接|接口|品牌|主流/],
        press: [
          '我们店二维火能接吗？',
          '支持哪些收银系统？',
        ],
        ack: [
          '能接就好。数据多久同步一次？',
        ],
      },
      {
        key: 'sync',
        covered: [/同步|实时|当天|次日|定时|分钟|每天|自动/],
        press: [
          '数据多久同步一次？',
          '当天能看到吗？',
        ],
        ack: [
          '同步时效可以。历史数据能导入吗？',
        ],
      },
      {
        key: 'history',
        covered: [/历史|导入|迁移|之前|存量|上线前|导出/],
        press: [
          '之前的历史数据能带过来吗？',
          '要我们自己导吗？',
        ],
        ack: [
          '历史数据能处理。数据安全方面呢？',
        ],
      },
      {
        key: 'security',
        covered: [/权限|安全|加密|只看|范围|授权|保密/],
        press: [
          '数据安全怎么保证？',
          '谁能看到我们店的数据？',
        ],
        ack: [
          '安全没问题就行。',
        ],
      },
    ],
    resolved: [
      '行，能接就行，那你们安排人对接我们店。',
      '好，把对接需要的资料清单发我。',
    ],
  },

  cs_report_billing: {
    concerns: [
      {
        key: 'scope',
        covered: [/堂食|外卖|渠道|口径|包含|范围|所有订单|订单/],
        press: [
          '报表到底统计哪些？堂食和外卖都算吗？',
          '口径是什么？',
        ],
        ack: [
          '口径清楚了。退款怎么算？',
        ],
      },
      {
        key: 'refund',
        covered: [/退款|退|扣除|冲减|净额|不算|原路/],
        press: [
          '退款在报表里怎么算？',
          '会冲减营业额吗？',
        ],
        ack: [
          '退款处理明白了。日结怎么算？',
        ],
      },
      {
        key: 'settle',
        covered: [/日结|结算|当天|次日|汇总|营业日|零点/],
        press: [
          '日结按什么时间算？',
          '当天几点能看到？',
        ],
        ack: [
          '结算时间清楚了。',
        ],
      },
      {
        key: 'reconcile',
        covered: [/核对|排查|导出|明细|对账|查|差异/],
        press: [
          '对不上怎么办？',
          '能导出明细核对吗？',
        ],
        ack: [
          '好，那你们帮我核一遍。',
        ],
      },
    ],
    resolved: [
      '行，那你们帮我核一遍，把口径说明发我。',
      '好，我这边配合导出明细。',
    ],
  },

  cs_activity_setup: {
    concerns: [
      {
        key: 'entry',
        covered: [/创建|新建|入口|菜单|页面|找到|进入|后台|活动中心/],
        press: [
          '第一步去哪创建？',
          '入口在哪，我怎么找不到？',
        ],
        ack: [
          '好，创建入口知道了。那活动时间、参与人群怎么设？',
        ],
      },
      {
        key: 'config',
        covered: [/时间|人群|会员|规则|名称|内容|条件|设置|配置/],
        press: [
          '活动时间、参与条件在哪设置？',
          '要填哪些内容？',
        ],
        ack: [
          '配置会了。那短信群发怎么发？',
        ],
      },
      {
        key: 'send',
        covered: [/短信|群发|发送|模板|审核|签名|内容/],
        press: [
          '群发短信在哪操作？',
          '会不会审核？多久能发出去？',
        ],
        ack: [
          '发送也清楚了。',
        ],
      },
      {
        key: 'verify',
        covered: [/预览|测试|确认|小范围|发送记录|报表|查|试/],
        press: [
          '发之前能预览测试吗？',
          '发送后在哪看结果？',
        ],
        ack: [
          '好，那我按你说的试一下。',
        ],
      },
    ],
    resolved: [
      '步骤都清楚了，我操作一遍，有问题再找你。',
    ],
  },

  cs_ai_service_query: {
    concerns: [
      {
        key: 'ai_scope',
        covered: [/自动回复|知识库|常见问题|接待|咨询|功能|范围|场景|支持/],
        press: [
          'AI能自动回哪些消息？',
          '能处理我们店的什么咨询？',
        ],
        ack: [
          '功能范围清楚了。答错了怎么办？能转人工吗？',
        ],
      },
      {
        key: 'ai_handoff',
        covered: [/转人工|人工接管|真人|兜底|介入|转接|交给(门店|人工)|门店客服|人工客服/],
        press: [
          'AI答不上来或答错时，能转人工吗？',
          '顾客要求找真人怎么办？',
        ],
        ack: [
          '有人工兜底就好。AI怎么配置和训练？',
        ],
      },
      {
        key: 'ai_train',
        covered: [/知识库|配置|维护|训练|内容|导入|编辑|更新/],
        press: [
          'AI的知识库我们能自己配吗？',
          '怎么维护内容？',
        ],
        ack: [
          '配置明白了。那效果怎么看？',
        ],
      },
      {
        key: 'ai_measure',
        covered: [/数据|报表|效果|满意|转人工率|统计|衡量|回复率/],
        press: [
          'AI到底帮没帮上忙，怎么看？',
          '有数据报表吗？',
        ],
        ack: [
          '能看效果就行。',
        ],
      },
    ],
    resolved: [
      '行，那我先小范围试一下AI客服，看效果再放开。',
    ],
  },

  cs_employee_perf: {
    concerns: [
      {
        key: 'perf_data',
        covered: [/考勤|打卡|排班|数据|来源|同步|导出|记录/],
        press: [
          '考勤数据从哪来？准不准？',
          '是员工自己打卡吗？',
        ],
        ack: [
          '数据来源清楚了。绩效怎么评？',
        ],
      },
      {
        key: 'perf_rule',
        covered: [/绩效|评级|规则|指标|目标|评分|权重|自动/],
        press: [
          '绩效评级按什么算？',
          '规则我们能自己设吗？',
        ],
        ack: [
          '规则明白了。员工能看到吗？',
        ],
      },
      {
        key: 'perf_visibility',
        covered: [/员工|看到|权限|可见|查看|档案|申诉/],
        press: [
          '员工能看到自己的绩效吗？',
          '有异议怎么办？',
        ],
        ack: [
          '可见范围清楚了。',
        ],
      },
      {
        key: 'perf_loop',
        covered: [/调整|修正|确认|审批|闭环|月度|周期|复核/],
        press: [
          '绩效结果多久出一次？错了能改吗？',
          '谁复核？',
        ],
        ack: [
          '闭环清楚，那我先试用考勤。',
        ],
      },
    ],
    resolved: [
      '行，先把考勤跑起来，绩效规则我们再定。',
    ],
  },

  cs_approval_flow: {
    concerns: [
      {
        key: 'flow_setup',
        covered: [/审批|流程|设置|配置|请款|报销|类型|表单/],
        press: [
          '审批流程怎么设？',
          '请款和报销都能走吗？',
        ],
        ack: [
          '流程能设就好。谁来审？',
        ],
      },
      {
        key: 'flow_actor',
        covered: [/审批人|店长|经理|谁审|角色|指定|主管/],
        press: [
          '谁来审批？能指定店长吗？',
          '可以多人审批吗？',
        ],
        ack: [
          '审批人明白了。记录会留吗？',
        ],
      },
      {
        key: 'flow_record',
        covered: [/记录|留痕|凭证|流水|历史|可查|导出|存档/],
        press: [
          '审批记录会保留吗？',
          '事后能查到谁批的？',
        ],
        ack: [
          '留痕清楚。审批一般多久能完？',
        ],
      },
      {
        key: 'flow_eta',
        covered: [/时效|多久|当天|次日|小时|提醒|催促|未处理/],
        press: [
          '审批拖着没人理怎么办？',
          '有提醒吗？',
        ],
        ack: [
          '好，那我们把请款流程先配上。',
        ],
      },
    ],
    resolved: [
      '行，那我先配一个请款流程试试。',
    ],
  },

  cs_training_qa: {
    concerns: [
      {
        key: 'train_content',
        covered: [/培训|内容|课程|手册|题库|资料|现成|模板/],
        press: [
          '系统里有哪些培训内容？',
          '能自己上传课程吗？',
        ],
        ack: [
          '内容清楚了。考完怎么认证？',
        ],
      },
      {
        key: 'train_exam',
        covered: [/考试|认证|测验|成绩|通过|证书|评分/],
        press: [
          '培训完要考试吗？',
          '怎么算通过？',
        ],
        ack: [
          '考试认证明白了。和晋升挂钩吗？',
        ],
      },
      {
        key: 'train_link',
        covered: [/晋升|职级|挂钩|认证要求|岗位|标准/],
        press: [
          '认证和晋升挂钩吗？',
          '没认证能升职吗？',
        ],
        ack: [
          '挂钩规则清楚了。进度在哪看？',
        ],
      },
      {
        key: 'train_view',
        covered: [/进度|报表|查看|统计|完成率|导出|员工看/],
        press: [
          '培训进度在哪看？',
          '员工自己能看到吗？',
        ],
        ack: [
          '好，那我先安排员工培训。',
        ],
      },
    ],
    resolved: [
      '行，培训内容发我一份，我先看看再安排。',
    ],
  },

  cs_marketing_strategy: {
    concerns: [
      {
        key: 'layer_dim',
        covered: [/分层|维度|标签|活跃|沉睡|流失|复购|消费/],
        press: [
          '系统按什么分客户？',
          '能分出新客、老客、流失客吗？',
        ],
        ack: [
          '分层维度明白了。不同人群做什么活动？',
        ],
      },
      {
        key: 'layer_strategy',
        covered: [/策略|活动|方案|召回|唤醒|复购|优惠|券/],
        press: [
          '针对不同人群该做什么？',
          '沉睡老客怎么召回？',
        ],
        ack: [
          '策略方向清楚了。通过什么渠道触达？',
        ],
      },
      {
        key: 'layer_channel',
        covered: [/短信|企微|公众号|触达|渠道|发送/],
        press: [
          '活动通过什么渠道发？',
          '短信和企微都能用吗？',
        ],
        ack: [
          '渠道明确了。效果怎么衡量？',
        ],
      },
      {
        key: 'layer_roi',
        covered: [/归因|ROI|回店|转化|效果|报表|统计/],
        press: [
          '活动效果怎么看？',
          '能知道谁回店消费了吗？',
        ],
        ack: [
          '能看归因就好。',
        ],
      },
    ],
    resolved: [
      '行，那先按你们建议做一轮沉睡老客召回试试。',
    ],
  },

  cs_account_permission: {
    concerns: [
      {
        key: 'acc_confirm',
        covered: [/账号|登录|权限|角色|确认|核实|哪个|具体|店长|员工/],
        press: [
          '你们先确认到底哪个账号有问题？',
          '是登录不了还是权限不对？',
        ],
        ack: [
          '问题确认了就好。那怎么处理？',
        ],
      },
      {
        key: 'acc_fix',
        covered: [/重置|开通|调整|权限|恢复|处理|重新|配置/],
        press: [
          '账号怎么恢复？',
          '权限能马上调整吗？',
        ],
        ack: [
          '处理方案清楚了。多久能好？',
        ],
      },
      {
        key: 'acc_eta',
        covered: [/时间|分钟|小时|今天|尽快|马上|稍后/],
        press: [
          '多久能恢复登录？',
          '给个准确时间。',
        ],
        ack: [
          '时间知道了。',
        ],
      },
      {
        key: 'acc_loop',
        covered: [/告知|通知|回访|确认|说一声|答复|结果/],
        press: [
          '弄好了谁告诉我？',
          '处理完会通知我们吗？',
        ],
        ack: [
          '好，那我等你消息。',
        ],
      },
    ],
    resolved: [
      '行，处理完第一时间通知我，我们急着用。',
    ],
  },

  cs_sync_delay: {
    concerns: [
      {
        key: 'sync_confirm',
        covered: [/确认|核实|哪个|报表|数据|门店|时间|同步/],
        press: [
          '你们先确认是哪家店、哪个报表没更新？',
          '是全部数据都没有吗？',
        ],
        ack: [
          '现状确认了。是什么原因？',
        ],
      },
      {
        key: 'sync_cause',
        covered: [/原因|排查|故障|通道|接口|延迟|积压|任务/],
        press: [
          '为什么数据一直不更新？',
          '你们查到原因了吗？',
        ],
        ack: [
          '原因清楚了。那什么时候恢复？',
        ],
      },
      {
        key: 'sync_eta',
        covered: [/恢复|时间|分钟|小时|今天|尽快|补|回补/],
        press: [
          '多久能恢复更新？',
          '今天的数据会补回来吗？',
        ],
        ack: [
          '恢复时间清楚了。',
        ],
      },
      {
        key: 'sync_loop',
        covered: [/告知|通知|回访|确认|说一声|答复|结果/],
        press: [
          '恢复后谁告诉我？',
          '会主动通知我们吗？',
        ],
        ack: [
          '好，那我等你们确认。',
        ],
      },
    ],
    resolved: [
      '行，恢复后第一时间通知我，我们等着看数据。',
    ],
  },

};

/** 未单独编剧的 cs 人格：投诉/不满 → 方案 → 时限 → 闭环 */
const CS_DEFAULT_SCRIPT = {
  concerns: [
    {
      key: 'plan',
      covered: [/处理|解决|方案|安排|查|核实|排查|处理中|马上|帮您|恢复/],
      press: [
        '你们打算怎么处理？',
        '别跟我说再等等，我要具体方案。',
      ],
      ack: [
        '行，那你赶紧办，我等你消息。',
      ],
    },
    {
      key: 'eta',
      covered: [/时间|分钟|小时|今天|周|天|马上|尽快|稍后|答复/],
      press: [
        '什么时候能有结果？给个准话。',
        '多久能办好？我这边等着呢。',
      ],
      ack: [
        '好，那我就等你答复。',
      ],
    },
    {
      key: 'close',
      covered: [/回访|通知|确认|结果|说一声|汇报|跟您说/],
      press: [
        '处理好谁跟我确认？',
        '完事记得跟我说一声。',
      ],
      ack: [
        '行，那先这样，处理好了联系我。',
      ],
    },
  ],
  resolved: [
    '好，处理完务必通知我，谢谢。',
  ],
};

const CS_CONCERN_LABELS = {
  timeline: '解决时限',
  cause: '失败原因',
  verification: '验证与闭环',
  empathy: '情绪安抚',
  expectation: '期望的操作方式',
  fix: '修复时间',
  root_cause: '退款/不满的根因',
  remedy: '补救方案',
  commitment: '负责态度与承诺',
  plan: '处理方案',
  compensation: '补偿方案',
  triage: '问题梳理',
  repro: '具体复现信息',
  eta: '完成时限',
  close: '结果确认',
  legal_response: '对法务函的正式回应',
  entry: '活动创建入口',
  config: '活动配置项',
  send: '短信群发设置',
  verify: '预览与结果查看',
  data_source: '诊断数据来源',
  indicator: '诊断指标',
  diagnosis_action: '诊断后的闭环',
  confidence: '诊断边界',
  audience: '人群筛选',
  channel: '触达渠道',
  compliance: '合规防打扰',
  attribution: '效果归因',
  support: 'POS 兼容范围',
  sync: '数据同步时效',
  history: '历史数据导入',
  security: '数据安全',
  scope: '报表口径',
  refund: '退款口径',
  settle: '日结口径',
  reconcile: '核对流程',
  ai_scope: 'AI客服范围',
  ai_handoff: '人工接管',
  ai_train: '知识库配置',
  ai_measure: '效果衡量',
  perf_data: '考勤数据来源',
  perf_rule: '绩效规则',
  perf_visibility: '员工可见范围',
  perf_loop: '绩效闭环',
  flow_setup: '审批流程配置',
  flow_actor: '审批人',
  flow_record: '审批留痕',
  flow_eta: '审批时效',
  train_content: '培训内容',
  train_exam: '考试认证',
  train_link: '认证晋升',
  train_view: '培训进度',
  layer_dim: '分层维度',
  layer_strategy: '人群策略',
  layer_channel: '触达渠道',
  layer_roi: '归因衡量',
  acc_confirm: '问题确认',
  acc_fix: '处理方案',
  acc_eta: '恢复时限',
  acc_loop: '闭环告知',
  sync_confirm: '现状确认',
  sync_cause: '原因排查',
  sync_eta: '恢复时限',
  sync_loop: '闭环告知',
  seg_dim: '分层维度',
  seg_strategy: '人群策略',
  seg_exec: '落地执行',
  seg_measure: '衡量指标',
  ch_diag: '现状诊断',
  ch_strategy: '渠道策略',
  ch_exec: '执行节奏',
  ch_measure: '衡量指标',
  exec_diag: '问题诊断',
  exec_task: '任务闭环',
  exec_resp: '责任验收',
  exec_measure: '衡量指标',
  renew_value: '价值回顾',
  renew_need: '新增需求',
  renew_plan: '升级方案',
  renew_next: '下一步',
  roi_calc: '回本测算',
  assumption: '测算假设',
  boundary: '承诺边界',
  next_step: '下一步方案',
  diff: '差异点',
  evidence: '案例与数据',
  migration: '迁移与对接',
  fair_compare: '客观对比',
  week1: '第一周落地',
  month1: '第一个月节奏',
  who: '责任分工',
  measure: '衡量指标',
};

/**
 * sales 异议覆盖：covered 命中全部学员发言 → 该异议已回应；
 * press 用于未回应时换角度追问；ack 用于刚回应时承认并推进。
 */
const SALES_OBJECTIONS = {
  too_expensive: {
    covered: [/回本|价值|收益|投入|成本|效果|30天|三个月|一年|能带来|省下|赚|贵得值|看效果/],
    press: [
      '一年两万对我来说不便宜。你们能保证回本吗？',
      '竞品更便宜，凭什么你们贵？',
    ],
    ack: [
      '你这么一说，我倒是想听听具体怎么见效。',
    ],
  },
  has_system: {
    covered: [/数据|接|迁移|同步|用起来|利用|打通|导|旧系统|双系统|重复浪费/],
    press: [
      '我们已经有系统了，再买一套不是重复浪费吗？',
      '数据都在旧系统里，你们怎么接？',
    ],
    ack: [
      '能解决数据这块的话，倒是可以继续聊。',
    ],
  },
  think_again: {
    covered: [/顾虑|预算|效果|沟通|担心|哪里|方面|再了解|确认|疑问/],
    press: [
      '我再考虑考虑吧，你们先别天天催。',
      '以后再说，这阵子没空决策。',
    ],
    ack: [
      '你问得挺细。那我直说，我主要担心效果。',
    ],
  },
  no_time: {
    covered: [/减负|省时|时间|效率|自动|少花|不占|十分钟|一分钟|看资料/],
    press: [
      '真的没时间，你发资料我有空再看。',
      '（沉默了几秒）…你还有别的事吗？没有我先挂了。',
    ],
    ack: [
      '如果真能帮我省时间，那值得听你说说。',
    ],
  },
  ask_features: {
    covered: [/解决|结果|客流|复购|执行|痛点|最重要|先解决|帮您|目标|不卖功能/],
    press: [
      '那你们到底有什么功能？别绕。',
      '功能列表发我看看，我自己判断。',
    ],
    ack: [
      '别讲功能也行，那你告诉我具体能帮我解决什么？',
    ],
  },
  ai_useless: {
    covered: [/案例|效果|数据|证明|试|体验|踩坑|经历|没用|坑|落地|试用/],
    press: [
      'AI有什么用？我们店里又不缺聊天机器人。',
      '上次被AI方案坑过，别跟我画饼。',
    ],
    ack: [
      '有真实案例的话，我倒可以听听。',
    ],
  },
};

const SALES_OBJECTION_LABELS = {
  too_expensive: '价格',
  has_system: '已有系统',
  think_again: '再考虑',
  no_time: '没时间',
  ask_features: '功能',
  ai_useless: 'AI没用',
};

/**
 * sales 业务专业度剧本：客户提具体经营问题，学员要给准确测算/方案/边界。
 * covered 命中关键事实即算回应；查证承诺由 buildScriptedPlan 按一诺一问计数覆盖。
 */
const SALES_SCRIPTS = {
  sales_roi_question: {
    concerns: [
      {
        key: 'roi_calc',
        covered: [/回本|收益|投入|成本|算|账|毛利|营业额|万|元/],
        press: [
          '别讲概念，具体怎么算出回本？',
          '一年两万，我要看到账本。',
        ],
        ack: [
          '这个账我能看懂。那数据按什么假设算的？',
        ],
      },
      {
        key: 'assumption',
        covered: [/假设|预估|按.{0,4}(客流|复购|客单|营业额)|保守|预计|参考|同行/],
        press: [
          '你的假设依据是什么？',
          '保守还是乐观？',
        ],
        ack: [
          '假设能接受。那效果你们敢保证吗？',
        ],
      },
      {
        key: 'boundary',
        covered: [/(不|没)(做)?保证|不能承诺|不承诺|看执行|以实际|数据验证|试点|试用|先跑|效果取决于|取决于/],
        press: [
          '你敢保证30天见效吗？',
          '如果没效果怎么办？',
        ],
        ack: [
          '边界清楚了，这反而是实话。',
        ],
      },
      {
        key: 'next_step',
        covered: [/方案|先做|第一步|具体计划|合同|试用期|开始|出方案/],
        press: [
          '下一步具体做什么？',
          '给个能落地的计划。',
        ],
        ack: [
          '行，那出个方案我看看。',
        ],
      },
    ],
    resolved: [
      '方案出来发我，我算一下再定。',
      '行，那你先把方案和账本一起发我。',
    ],
  },

  sales_competitor_compare: {
    concerns: [
      {
        key: 'diff',
        covered: [/差异|区别|不同|优势|定位|针对|侧重|不一样/],
        press: [
          '你们和那家到底差在哪？',
          '功能看着都一样，区别是什么？',
        ],
        ack: [
          '差异我明白了。有什么实际案例或数据？',
        ],
      },
      {
        key: 'evidence',
        covered: [/案例|客户|店|数据|效果|验证|使用/],
        press: [
          '有真实案例吗？',
          '数据给我看看。',
        ],
        ack: [
          '案例可以。那我们从旧系统迁过来麻烦吗？',
        ],
      },
      {
        key: 'migration',
        covered: [/迁移|对接|切换|旧系统|数据导入|导出|上线|周期/],
        press: [
          '迁移要多久？会不会影响营业？',
          '旧数据能全部带过来吗？',
        ],
        ack: [
          '迁移周期知道了。',
        ],
      },
      {
        key: 'fair_compare',
        covered: [/不方便评价|不了解|不能评价|看您需求|适合|以您实际|不贬低/],
        press: [
          '那家到底行不行，你们给个评价？',
          '我该信谁的？',
        ],
        ack: [
          '行，那我自己对比。',
        ],
      },
    ],
    resolved: [
      '你把我关心的几个点整理一下发我，我对比完再说。',
      '行，方案和数据发我邮箱。',
    ],
  },

  sales_solution_demo: {
    concerns: [
      {
        key: 'week1',
        covered: [/第一周|第一天|第一步|先|盘点|导入|培训|初始化|建档/],
        press: [
          '第一周具体做什么？',
          '别讲流程，讲动作。',
        ],
        ack: [
          '第一周明白了。第一个月呢？',
        ],
      },
      {
        key: 'month1',
        covered: [/第一个月|月度|节奏|复盘|调整|优化|第二周|四周/],
        press: [
          '第一个月的节奏是什么？',
          '多久复盘一次？',
        ],
        ack: [
          '节奏清楚了。谁来做这些事？',
        ],
      },
      {
        key: 'who',
        covered: [/谁负责|分工|实施顾问|我们的人|你们的人|专人|配合|顾问|项目组/],
        press: [
          '具体谁来做？你们的人还是我们的人？',
          '要不要我们抽人配合？',
        ],
        ack: [
          '分工明确了。',
        ],
      },
      {
        key: 'measure',
        covered: [/指标|效果|衡量|营业额|复购|客流|月报|数据报表|怎么算|看什么/],
        press: [
          '怎么算落地成功？看什么指标？',
          '效果怎么衡量？',
        ],
        ack: [
          '衡量标准我认可。',
        ],
      },
    ],
    resolved: [
      '行，就按这个来，你们先出实施计划。',
      '计划出来我们内部过一下。',
    ],
  },

  sales_customer_segmentation: {
    concerns: [
      {
        key: 'seg_dim',
        covered: [/分层|维度|标签|活跃|沉睡|流失|复购|消费|价值/],
        press: [
          '你们按什么维度分层？',
          '分完能看到哪些人群？',
        ],
        ack: [
          '分层维度清楚了。分层后做什么策略？',
        ],
      },
      {
        key: 'seg_strategy',
        covered: [/策略|活动|召回|唤醒|复购|维护|方案|券/],
        press: [
          '不同人群分别做什么？',
          '沉睡老客怎么唤醒？',
        ],
        ack: [
          '策略清楚了。谁来执行？',
        ],
      },
      {
        key: 'seg_exec',
        covered: [/执行|任务|责任人|门店|店长|安排|跟进|节奏/],
        press: [
          '策略怎么落地？谁负责？',
          '会不会又变成一张纸？',
        ],
        ack: [
          '执行闭环有了。效果怎么衡量？',
        ],
      },
      {
        key: 'seg_measure',
        covered: [/指标|回店率|复购率|ROI|效果|报表|衡量|月报|评估/],
        press: [
          '怎么知道分层运营有没有用？',
          '看什么指标？',
        ],
        ack: [
          '衡量标准可以。',
        ],
      },
    ],
    resolved: [
      '行，先做一轮分层诊断，看看人群分布再说。',
    ],
  },

  sales_channel_growth: {
    concerns: [
      {
        key: 'ch_diag',
        covered: [/诊断|现状|堂食|外卖|数据|对比|问题|渠道/],
        press: [
          '你们先分析我店外卖为什么起不来？',
          '数据从哪看？',
        ],
        ack: [
          '现状诊断清楚了。增长策略是什么？',
        ],
      },
      {
        key: 'ch_strategy',
        covered: [/策略|方案|引流|复购|活动|平台|评分|菜单/],
        press: [
          '外卖具体怎么增长？',
          '堂食和外卖怎么配合？',
        ],
        ack: [
          '策略清楚了。执行节奏呢？',
        ],
      },
      {
        key: 'ch_exec',
        covered: [/节奏|周|月|步骤|先|执行|落地|复盘/],
        press: [
          '多久能看到动作？',
          '第一步做什么？',
        ],
        ack: [
          '节奏清楚了。怎么衡量增长？',
        ],
      },
      {
        key: 'ch_measure',
        covered: [/指标|营业额|单量|复购|转化|效果|月报|环比/],
        press: [
          '增长效果看什么数据？',
          '多久复盘一次？',
        ],
        ack: [
          '衡量方式认可。',
        ],
      },
    ],
    resolved: [
      '行，那先出一份我们店的外卖增长方案。',
    ],
  },

  sales_employee_exec: {
    concerns: [
      {
        key: 'exec_diag',
        covered: [/诊断|问题|执行|现状|数据|原因|哪里/],
        press: [
          '你们怎么知道我店执行有问题？',
          '具体卡在哪一步？',
        ],
        ack: [
          '问题定位清楚了。系统怎么保证执行？',
        ],
      },
      {
        key: 'exec_task',
        covered: [/任务|动作|步骤|清单|要求|证据|标准/],
        press: [
          '员工具体要做什么动作？',
          '怎么确认做没做？',
        ],
        ack: [
          '任务机制明白了。谁负责验收？',
        ],
      },
      {
        key: 'exec_resp',
        covered: [/责任人|店长|主管|验收|证据|确认|跟进|考核/],
        press: [
          '谁盯着执行？',
          '没做会怎样？',
        ],
        ack: [
          '责任闭环有了。效果怎么衡量？',
        ],
      },
      {
        key: 'exec_measure',
        covered: [/指标|执行率|营业额|复购|效果|报表|月度/],
        press: [
          '怎么证明执行力提升有用？',
          '看什么数据？',
        ],
        ack: [
          '衡量标准可以。',
        ],
      },
    ],
    resolved: [
      '行，先选一家店试点任务闭环，看执行率变化。',
    ],
  },

  sales_renew_upgrade: {
    concerns: [
      {
        key: 'renew_value',
        covered: [/价值|回顾|使用|数据|效果|诊断|报告|用了|提升/],
        press: [
          '你先说我这一年到底用出了什么？',
          '有什么数据证明有用？',
        ],
        ack: [
          '价值回顾能接受。那有什么新东西？',
        ],
      },
      {
        key: 'renew_need',
        covered: [/新功能|升级|模块|需求|问题|痛点|想要|增加/],
        press: [
          '升级后多出什么能力？',
          '针对我们现在的问题有什么新方案？',
        ],
        ack: [
          '新增点清楚了。费用怎么算？',
        ],
      },
      {
        key: 'renew_plan',
        covered: [/费用|价格|方案|合同|套餐|续费|升级费|分期/],
        press: [
          '续费和升级分别多少钱？',
          '能先试用新功能吗？',
        ],
        ack: [
          '方案清楚了。下一步怎么走？',
        ],
      },
      {
        key: 'renew_next',
        covered: [/合同|签约|试用|试点|安排|开始|对接|办理/],
        press: [
          '怎么开始升级？',
          '合同怎么签？',
        ],
        ack: [
          '好，那我按流程走。',
        ],
      },
    ],
    resolved: [
      '行，把升级方案和合同发我，我内部商量一下。',
    ],
  },
};

const SALES_DISCOVERY = [
  '你继续说。',
  '然后呢？跟我现在有什么关系？',
  '我听着呢，重点是什么？',
];

const SALES_OPENUP = [
  '这个问题问到点上了。我们现在最烦的是老客不回来。',
  '你既然问了…复购这块确实差，大概百分之十几。',
];

const SALES_SIGNAL = [
  '……行，那你先给我出一个具体方案，我看看。',
  '听起来有点道理。你们下一步准备怎么做？',
  '行，只要真能帮上忙，我可以考虑看看。',
];

function csScriptForPersona(personaKey, triggers) {
  if (CS_SCRIPTS[personaKey]) return CS_SCRIPTS[personaKey];
  if ((triggers || []).includes('refund')) return CS_SCRIPTS.cs_refund;
  if ((triggers || []).includes('ux_bad')) return CS_SCRIPTS.cs_ux_loop;
  return CS_DEFAULT_SCRIPT;
}

function concernLabel(key) {
  return CS_CONCERN_LABELS[key] || key;
}

function buildScriptedPlan({ script, track, traineeText, priorTraineeTexts, priorCustomerTexts, cumulativeStrengths }) {
  const allTrainee = [...priorTraineeTexts, traineeText].filter(Boolean);
  const priorTraineeOnly = priorTraineeTexts.filter(Boolean);
  const usedKeys = priorCustomerTexts.map(normKey);
  const concerns = script.concerns || [];
  // 查证承诺按「一诺一问」覆盖：累计承诺次数决定前 N 个未答问题被覆盖，防止一句「我查一下」跳过整场
  const verifyPromises = allTrainee.filter((t) => VERIFY_COMMIT_RE.test(t)).length;
  const verifyPromisesBefore = priorTraineeOnly.filter((t) => VERIFY_COMMIT_RE.test(t)).length;
  const coveredNow = (c, i) => isCovered(allTrainee, c.covered) || i < verifyPromises;
  const coveredBefore = (c, i) => isCovered(priorTraineeOnly, c.covered) || i < verifyPromisesBefore;

  const newlyCovered = concerns.filter(
    (c, i) => coveredNow(c, i) && !coveredBefore(c, i)
  );
  if (newlyCovered.length) {
    const c = newlyCovered[newlyCovered.length - 1];
    const reply = pickUnused(c.ack, usedKeys)
      || pickUnused(c.press, usedKeys)
      || pickUnused(script.resolved || [], usedKeys)
      || CLOSE_LINES[track][0];
    const next = concerns.find((x, j) => !coveredNow(x, j));
    const nextLabel = next ? `「${concernLabel(next.key)}」` : '收束';
    return {
      reply,
      intent: `ack_${c.key}`,
      guidance: `学员的回答覆盖了「${concernLabel(c.key)}」。你承认这一点（可顺着学员的话），然后把话题推进到${nextLabel}。`,
    };
  }

  const current = concerns.find((c, i) => !coveredNow(c, i));
  if (!current) {
    const reply = pickUnused(script.resolved || [], usedKeys)
      || pickUnused(script.concerns.flatMap((c) => c.ack), usedKeys)
      || CLOSE_LINES[track][0];
    return {
      reply,
      intent: 'resolve',
      guidance: '你关心的问题都已经得到回应。表达满意/收束，约好后续告知结果，语气符合当前状态。',
    };
  }

  // 学员整体表现稳定（累计 ≥2 个不同 L1 优点）→ 先软化承认，再追问
  if (cumulativeStrengths >= 2) {
    const ack = pickUnused(current.ack, usedKeys);
    if (ack) {
      return {
        reply: ack,
        intent: `soft_${current.key}`,
        guidance: `学员整体表现稳定（累计多个优点）。你先软化承认「${concernLabel(current.key)}」的进展，再继续推进。`,
      };
    }
  }
  const press = pickUnused(current.press, usedKeys);
  if (press) {
    const second = normKey(press) === normKey(current.press[1]);
    return {
      reply: press,
      intent: `press_${current.key}`,
      guidance: second
        ? `学员还没有说清「${concernLabel(current.key)}」，你已追问过一次，这次用更直接/更急的语气换角度追问。`
        : `学员还没有说清「${concernLabel(current.key)}」。换一个新角度追问，不要重复上一句的原话。`,
    };
  }
  const esc = pickUnused(ESCALATE_LINES[track] || [], usedKeys);
  if (esc) {
    return {
      reply: esc,
      intent: 'escalate',
      guidance: `你已经追问「${concernLabel(current.key)}」两次仍未得到实质回答。表达失望或升级（找负责人/给最后期限），语气符合当前情绪。`,
    };
  }
  if (track === 'cs') {
    const ack = pickUnused(current.ack, usedKeys);
    if (ack) {
      return {
        reply: ack,
        intent: `soft_${current.key}`,
        guidance: `追问无果后你给一次缓和机会，承认「${concernLabel(current.key)}」需要处理，请对方给出明确下一步。`,
      };
    }
  }
  return {
    reply: CLOSE_LINES[track][0],
    intent: 'close',
    guidance: '你决定先结束这次沟通，保持礼貌但明确。',
  };
}

export function buildCsDialogueTurn({
  personaKey = '', evalResult, traineeText = '',
  priorTraineeTexts = [], priorCustomerTexts = [], cumulativeStrengths = 0,
}) {
  const triggers = evalResult.triggers || [];
  const script = csScriptForPersona(personaKey, triggers);
  return buildScriptedPlan({
    script,
    track: 'cs',
    evalResult,
    traineeText,
    priorTraineeTexts,
    priorCustomerTexts,
    cumulativeStrengths,
  });
}

export function buildCsDialogueReply(...args) {
  return buildCsDialogueTurn(...args).reply;
}

export function buildSalesDialogueTurn({
  evalResult, personaKey = '', traineeText = '',
  priorTraineeTexts = [], priorCustomerTexts = [], cumulativeStrengths = 0,
}) {
  if (SALES_SCRIPTS[personaKey]) {
    return buildScriptedPlan({
      script: SALES_SCRIPTS[personaKey],
      track: 'sales',
      traineeText,
      priorTraineeTexts,
      priorCustomerTexts,
      cumulativeStrengths,
    });
  }
  const allTrainee = [...priorTraineeTexts, traineeText].filter(Boolean);
  const priorTraineeOnly = priorTraineeTexts.filter(Boolean);
  const usedKeys = priorCustomerTexts.map(normKey);

  // 全程已提出的异议（含开场句），按首次出现顺序跟踪
  const raised = [];
  const seen = new Set();
  for (const line of priorCustomerTexts) {
    for (const key of detectCustomerTriggers(line, 'sales')) {
      if (!seen.has(key) && SALES_OBJECTIONS[key]) {
        seen.add(key);
        raised.push(key);
      }
    }
  }
  for (const key of evalResult.triggers || []) {
    if (!seen.has(key) && SALES_OBJECTIONS[key]) {
      seen.add(key);
      raised.push(key);
    }
  }

  const newlyCovered = raised.filter(
    (k) => isCovered(allTrainee, SALES_OBJECTIONS[k].covered)
      && !isCovered(priorTraineeOnly, SALES_OBJECTIONS[k].covered)
  );
  if (newlyCovered.length) {
    const key = newlyCovered[newlyCovered.length - 1];
    const reply = pickUnused(SALES_OBJECTIONS[key].ack, usedKeys)
      || pickUnused(SALES_OBJECTIONS[key].press, usedKeys)
      || pickUnused(SALES_SIGNAL, usedKeys)
      || CLOSE_LINES.sales[0];
    return {
      reply,
      intent: `ack_${key}`,
      guidance: `学员回应了你的异议「${SALES_OBJECTION_LABELS[key]}」。承认他的回应，然后推进到下一步（追问案例/具体方案/下一步动作）。`,
    };
  }

  // 学员提出好问题 → 客户打开话题
  const hasOpenQuestion = (evalResult.strengths || []).some(
    (s) => s.principle_id === 'ask_first' || s.principle_id === 'no_argue'
  );
  if (hasOpenQuestion) {
    const open = pickUnused(SALES_OPENUP, usedKeys);
    if (open) {
      return {
        reply: open,
        intent: 'openup',
        guidance: '学员问到了点子上。你透露一个真实痛点（复购/客流/执行），说得具体一点。',
      };
    }
  }

  if (!raised.length) {
    const reply = pickUnused(SALES_DISCOVERY, usedKeys)
      || pickUnused(SALES_OPENUP, usedKeys)
      || CLOSE_LINES.sales[0];
    return {
      reply,
      intent: 'discovery',
      guidance: '你还没抛出明确异议，保持观望，要求对方讲重点或说明与你的关系。',
    };
  }

  const uncovered = raised.find((k) => !isCovered(allTrainee, SALES_OBJECTIONS[k].covered));
  if (uncovered) {
    const obj = SALES_OBJECTIONS[uncovered];
    const press = pickUnused(obj.press, usedKeys);
    if (press) {
      const second = normKey(press) === normKey(obj.press[1]);
      return {
        reply: press,
        intent: `press_${uncovered}`,
        guidance: second
          ? `学员还没有回应你的异议「${SALES_OBJECTION_LABELS[uncovered]}」，你已追问过一次，这次更直接地追问。`
          : `学员没有回应你的异议「${SALES_OBJECTION_LABELS[uncovered]}」。换一个新角度追问，不要重复上一句。`,
      };
    }
    const esc = pickUnused(ESCALATE_LINES.sales, usedKeys);
    if (esc) {
      return {
        reply: esc,
        intent: 'escalate',
        guidance: '学员始终说不清重点。你表达不耐烦，准备结束这次沟通。',
      };
    }
    return {
      reply: CLOSE_LINES.sales[0],
      intent: 'close',
      guidance: '你决定结束沟通，礼貌收尾。',
    };
  }

  const reply = pickUnused(SALES_SIGNAL, usedKeys) || CLOSE_LINES.sales[0];
  return {
    reply,
    intent: 'signal',
    guidance: '你的异议都已得到回应。给出购买信号：要求具体方案，或表达可以考虑。',
  };
}

export function buildSalesDialogueReply(...args) {
  return buildSalesDialogueTurn(...args).reply;
}
