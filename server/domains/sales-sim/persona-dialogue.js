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
        covered: [/理解|抱歉|对不起|不好意思|换我|也会|着急|一起|马上帮|先安抚|重视/],
        press: [
          '你们就知道让我重启，我真的很生气，你懂不懂？',
          '这不是折腾我吗？你倒是说说到底怎么回事。',
        ],
        ack: [
          '谢谢理解。反正我是真的受够了，你们打算怎么处理？',
        ],
      },
      {
        key: 'expectation',
        covered: [/希望.{0,6}怎么|期望|方便告诉|想怎么|当时想|怎么操作|您觉得|建议|按您/],
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
        covered: [/希望.{0,6}怎么|期望|想怎么|简单|直接|一键|更好用|建议/],
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

function buildScriptedReply({ script, track, traineeText, priorTraineeTexts, priorCustomerTexts, cumulativeStrengths }) {
  const allTrainee = [...priorTraineeTexts, traineeText].filter(Boolean);
  const priorTraineeOnly = priorTraineeTexts.filter(Boolean);
  const usedKeys = priorCustomerTexts.map(normKey);
  const concerns = script.concerns || [];

  const newlyCovered = concerns.filter(
    (c) => isCovered(allTrainee, c.covered) && !isCovered(priorTraineeOnly, c.covered)
  );
  if (newlyCovered.length) {
    const c = newlyCovered[newlyCovered.length - 1];
    return pickUnused(c.ack, usedKeys)
      || pickUnused(c.press, usedKeys)
      || pickUnused(script.resolved || [], usedKeys)
      || CLOSE_LINES[track][0];
  }

  const current = concerns.find((c) => !isCovered(allTrainee, c.covered));
  if (!current) {
    return pickUnused(script.resolved || [], usedKeys)
      || pickUnused(script.concerns.flatMap((c) => c.ack), usedKeys)
      || CLOSE_LINES[track][0];
  }

  // 学员整体表现稳定（累计 ≥2 个不同 L1 优点）→ 先软化承认，再追问
  if (cumulativeStrengths >= 2) {
    const ack = pickUnused(current.ack, usedKeys);
    if (ack) return ack;
  }
  const press = pickUnused(current.press, usedKeys);
  if (press) return press;
  const esc = pickUnused(ESCALATE_LINES[track] || [], usedKeys);
  if (esc) return esc;
  if (track === 'cs') {
    const ack = pickUnused(current.ack, usedKeys);
    if (ack) return ack;
  }
  return CLOSE_LINES[track][0];
}

export function buildCsDialogueReply({
  personaKey = '', evalResult, traineeText = '',
  priorTraineeTexts = [], priorCustomerTexts = [], cumulativeStrengths = 0,
}) {
  const triggers = evalResult.triggers || [];
  const script = csScriptForPersona(personaKey, triggers);
  return buildScriptedReply({
    script,
    track: 'cs',
    evalResult,
    traineeText,
    priorTraineeTexts,
    priorCustomerTexts,
    cumulativeStrengths,
  });
}

export function buildSalesDialogueReply({
  evalResult, traineeText = '', priorTraineeTexts = [], priorCustomerTexts = [],
}) {
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
    return pickUnused(SALES_OBJECTIONS[key].ack, usedKeys)
      || pickUnused(SALES_OBJECTIONS[key].press, usedKeys)
      || pickUnused(SALES_SIGNAL, usedKeys)
      || CLOSE_LINES.sales[0];
  }

  // 学员提出好问题 → 客户打开话题
  const hasOpenQuestion = (evalResult.strengths || []).some(
    (s) => s.principle_id === 'ask_first' || s.principle_id === 'no_argue'
  );
  if (hasOpenQuestion) {
    const open = pickUnused(SALES_OPENUP, usedKeys);
    if (open) return open;
  }

  if (!raised.length) {
    return pickUnused(SALES_DISCOVERY, usedKeys)
      || pickUnused(SALES_OPENUP, usedKeys)
      || CLOSE_LINES.sales[0];
  }

  const uncovered = raised.find((k) => !isCovered(allTrainee, SALES_OBJECTIONS[k].covered));
  if (uncovered) {
    const obj = SALES_OBJECTIONS[uncovered];
    const press = pickUnused(obj.press, usedKeys);
    if (press) return press;
    const esc = pickUnused(ESCALATE_LINES.sales, usedKeys);
    if (esc) return esc;
    return CLOSE_LINES.sales[0];
  }

  return pickUnused(SALES_SIGNAL, usedKeys) || CLOSE_LINES.sales[0];
}
