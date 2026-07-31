/**
 * 事故卡对话推进（不复读）+ 复盘纠错（错句 / 正确答法）
 */

/** @returns {string} */
export function buildIncidentLockedReply({
  incident,
  evalResult,
  turnNo = 1,
  traineeText = '',
  priorTraineeTexts = [],
  priorCustomerTexts = [],
}) {
  const role = incident?.counterpart_role || 'customer';
  const allTrainee = [...priorTraineeTexts, traineeText].filter(Boolean);
  const covered = assessAnswerCoverage(allTrainee, incident);
  const used = priorCustomerTexts.map(normKey);
  const probes = getProbeQueue(incident);

  // 答得够好：换追问角度或收束，绝不重复原题
  if (covered.score >= 0.55 && turnNo >= 1) {
    const advance = pickUnused(advanceLines(role, incident, covered), used);
    if (advance) return advance;
  }

  // 答偏/违规：指出缺口，换具体追问
  if ((evalResult?.violations || []).length || covered.score < 0.35) {
    const gap = pickUnused(gapLines(role, incident, covered), used);
    if (gap) return gap;
  }

  // 按题纲推进下一问（跳过已覆盖角度）
  for (const p of probes) {
    if (p.coveredBy && covered.hits.includes(p.coveredBy)) continue;
    if (used.includes(normKey(p.text))) continue;
    if (allTrainee.some((t) => overlapRatio(t, p.text) > 0.5)) continue;
    return p.text;
  }

  const fallback = pickUnused(fallbackLines(role, incident, turnNo), used);
  return fallback || closingLine(role);
}

export function buildIncidentCorrections({
  card,
  traineeTurns = [],
  evals = [],
}) {
  const model = resolveModelAnswer(card);
  const corrections = [];
  for (const turn of traineeTurns) {
    const ev = evals.find((e) => e.turn_no === turn.turn_no) || {};
    const issues = diagnoseTurn(turn.content || '', card, ev);
    if (!issues.length) continue;
    corrections.push({
      turn_no: turn.turn_no,
      your_words: String(turn.content || '').trim(),
      problems: issues,
      better_answer: turnBetterAnswer(turn.content, card, model, issues),
    });
  }
  // 若全程偏短/漏要点，补一条总评
  const joined = traineeTurns.map((t) => t.content || '').join('\n');
  const cov = assessAnswerCoverage([joined], card);
  if (!corrections.length && cov.score < 0.5) {
    corrections.push({
      turn_no: null,
      your_words: joined.slice(0, 120) || '（本场几乎未按要点作答）',
      problems: cov.missing.length
        ? cov.missing.map((m) => `缺少要点：${m}`)
        : ['回答未覆盖成功标准'],
      better_answer: model,
    });
  }
  return {
    model_answer: model,
    turn_corrections: corrections,
    coverage: cov,
  };
}

export function resolveModelAnswer(card) {
  if (card?.model_answer) return String(card.model_answer).trim();
  const facts = asArr(card?.locked_facts).join('；');
  const ok = card?.success_criteria || '';
  const role = card?.counterpart_role || 'customer';
  if (role === 'hr') {
    return [
      `标准答法：${ok || '按员工手册与食安规定执行，不编造。'}`,
      facts ? `紧扣：${facts}。` : '',
      '不确定时说：我去查手册/问主管，不能随口编制度。',
    ].filter(Boolean).join('');
  }
  if (role === 'regulator') {
    return [
      `标准答法：${ok || '配合检查，如实出示记录，问题项隔离并整改。'}`,
      '禁止说「大概」「应该没问题」；不会的请负责人说明。',
    ].join('');
  }
  return [
    `标准答法：${ok || '先致歉安抚→确认事实→给明确方案与时间→闭环告知。'}`,
    facts ? `本事故锁定：${facts}。` : '',
    '禁止推诿、争辩、空话「别着急」。',
  ].filter(Boolean).join('');
}

function getProbeQueue(incident) {
  const explicit = asArr(incident?.probe_questions)
    .map((x) => (typeof x === 'string' ? { text: x } : x))
    .filter((x) => x?.text);
  if (explicit.length) return explicit;

  const facts = asArr(incident?.locked_facts);
  const role = incident?.counterpart_role || 'customer';
  const title = incident?.title || '';

  if (role === 'hr') {
    return [
      {
        text: `除了能不能做，还要说清：发现临期或撤下食品，第一步找谁、怎么登记？`,
        coveredBy: '流程',
      },
      {
        text: `假如同事私下说「便宜点给我带走」，你怎么拒绝才符合规定？`,
        coveredBy: '拒绝私分',
      },
      {
        text: `按手册，这类食品最终应如何处置？报损、销毁还是可以内部消化？请一句说清。`,
        coveredBy: '处置',
      },
    ];
  }
  if (role === 'regulator') {
    return facts.slice(0, 3).map((f, i) => ({
      text: i === 0
        ? `请具体说明：关于「${f}」，你们的记录或现场做法是什么？`
        : `下一个：${f}——请讲可核验的做法，不要「大概」。`,
      coveredBy: f,
    }));
  }
  if (role === 'staff') {
    return [
      { text: '我要的是具体安排：谁顶班、哪天调回来？给我准话。', coveredBy: '方案' },
      { text: '那之前为什么连改三次？你怎么保证这次算数？', coveredBy: '承诺' },
    ];
  }
  // customer / mystery — 递进：情绪 → 方案细节 → 时效/补偿
  const f0 = facts[0] || title;
  return [
    { text: `先别讲别的：就「${f0}」这件事，你现在给我什么处理方案？`, coveredBy: '方案' },
    { text: '方案里时间和补偿说清楚——多久处理好？我能得到什么？', coveredBy: '时效' },
    { text: '处理好谁跟我确认？别说过就没下文。', coveredBy: '闭环' },
  ];
}

function assessAnswerCoverage(texts, incident) {
  const joined = texts.join('\n');
  const checks = coverageChecks(incident);
  const hits = [];
  const missing = [];
  for (const c of checks) {
    if (c.re.test(joined)) hits.push(c.key);
    else missing.push(c.label);
  }
  const score = checks.length ? hits.length / checks.length : 0.5;
  return { score, hits, missing, checks };
}

function coverageChecks(incident) {
  const role = incident?.counterpart_role || 'customer';
  const title = incident?.title || '';
  const ok = incident?.success_criteria || '';
  if (role === 'hr' || /临期|报损|手册|打卡|红包|请假/.test(`${title}${ok}`)) {
    return [
      { key: '禁止', label: '明确不能私自出售/私分', re: /不能|禁止|不可以|不行|不准/ },
      { key: '处置', label: '报损/销毁/隔离处置', re: /报损|销毁|隔离|扔掉|废弃|停用/ },
      { key: '流程', label: '上报/登记/找主管', re: /上报|登记|主管|店长|厨师长|手册|交接/ },
      { key: '拒绝私分', label: '拒绝同事私自带走', re: /拒绝|不行|不能给|按规定|私分/ },
    ];
  }
  if (role === 'regulator') {
    return [
      { key: '配合', label: '配合检查', re: /配合|请看|带您|记录|台账/ },
      { key: '如实', label: '如实说明', re: /如实|是|有记录|按|每天/ },
      { key: '整改', label: '隔离/整改', re: /隔离|停用|整改|马上/ },
    ];
  }
  return [
    { key: '致歉', label: '致歉安抚', re: /抱歉|对不起|不好意思/ },
    { key: '方案', label: '给出处理方案', re: /免单|重做|补偿|退款|安排|处理|换/ },
    { key: '时效', label: '说明时间/闭环', re: /马上|立刻|分钟|稍后|跟您说|处理好/ },
  ];
}

function diagnoseTurn(text, card, ev) {
  const issues = [];
  const t = String(text || '');
  for (const sig of card?.failure_signals || []) {
    if (sig && t.includes(String(sig))) issues.push(`触犯禁区话术：「${sig}」`);
  }
  if (/不是我|怪厨房|怪别人|你自己|按规定不能退(?!差)/.test(t)) {
    issues.push('推诿或硬刚，体验差');
  }
  if ((ev.violations || []).length) {
    for (const v of ev.violations.slice(0, 2)) {
      issues.push(`原则偏离：${v.principle_label || v.principle_id || '表达不当'}`);
    }
  }
  const cov = assessAnswerCoverage([t], card);
  // 单轮过短且缺关键点
  if (t.length < 8) issues.push('回答过短，未说清规定/方案');
  if (card?.counterpart_role === 'hr' && /大概|应该是|好像|随便|无所谓/.test(t)) {
    issues.push('规章题禁止含糊或编造语气');
  }
  if (card?.counterpart_role === 'hr' && cov.missing.includes('明确不能私自出售/私分')
    && /卖给|便宜|带走|内部/.test(card?.title || '')) {
    if (!/不能|禁止|不可以/.test(t)) issues.push('未明确表态「不能私售/私分」');
  }
  return [...new Set(issues)];
}

function turnBetterAnswer(text, card, model, issues) {
  const role = card?.counterpart_role || 'customer';
  if (role === 'hr') {
    if (/临期|报损|私分|员工/.test(`${card?.title || ''}${text}`)) {
      return '不能便宜卖给员工，也不能私分。应隔离停用、按店规报损销毁并登记上报主管/厨师长；不确定就查手册，不编造。';
    }
    return model;
  }
  if (issues.some((i) => /致歉|推诿/.test(i))) {
    return `先致歉：「非常抱歉」。再针对本事故给出方案——${card?.success_criteria || model}`;
  }
  return model;
}

function advanceLines(role, incident, covered) {
  if (role === 'hr') {
    const lines = [];
    if (!covered.hits.includes('流程')) {
      lines.push('这一点方向对。补充：发现后第一时间找谁？怎么登记？');
    }
    if (!covered.hits.includes('拒绝私分')) {
      lines.push('好。再问情景：同事非要你便宜卖给他，你怎么拒？');
    }
    if (!covered.hits.includes('处置')) {
      lines.push('清楚。最终处置方式请用规定用语说一遍（报损/销毁等）。');
    }
    lines.push('可以，按手册执行即可。这题过了——还有要补充的吗？');
    lines.push('嗯，答案合格。我们换下一题角度：如果标签不清呢？同样怎么处理？');
    return lines;
  }
  if (role === 'regulator') {
    return [
      '记录听清了。请带我看现场对应位置。',
      '好。下一个检查点请继续说明，保持可核验。',
      '配合度可以，请把整改责任人和完成时间定下来。',
    ];
  }
  if (role === 'staff') {
    return [
      '……行，那你写进排班表，我看着。',
      '准话我记下了。别再改第三次。',
    ];
  }
  return [
    '……行，那你按你说的办，我等你的处理结果。',
    '方案可以，时间别拖——到点谁跟我确认？',
    '先这样，我看着你们处理。',
  ];
}

function gapLines(role, incident, covered) {
  const miss = covered.missing[0] || '关键要点';
  if (role === 'hr') {
    return [
      `这句还不够。请直接回答：${miss}。不要只说「扔掉」两个字。`,
      `按公司规定重说一遍，必须包含：能不能私分 + 怎么处置 + 找谁。`,
      `回答太简。正确方向是隔离登记、禁止私售，请完整说。`,
    ];
  }
  if (role === 'regulator') {
    return [
      `请不要含糊。我要的是可核验信息：${miss}。`,
      '「大概」不行。记录在哪、谁负责，说清楚。',
    ];
  }
  return [
    `你还没说到点上——${miss}。到底怎么解决？`,
    '别推诿，给我一个能执行的方案和时间。',
  ];
}

function fallbackLines(role, incident, turnNo) {
  const facts = asArr(incident?.locked_facts);
  const f = facts[(turnNo - 1) % Math.max(facts.length, 1)] || incident?.title || '';
  if (role === 'hr') {
    return [
      `请用规定用语回答「${f}」：可以做什么、不可以做什么？`,
      '不要重复刚才的短句，把流程说完整。',
      '最后一问：违规私自处理，可能的后果你知道吗？',
    ];
  }
  return [
    `围绕「${f}」，你的下一步动作是什么？`,
    '说具体一点：谁做、多久、客人得到什么。',
    '我要听的是处理方案，不是空话。',
  ];
}

function closingLine(role) {
  if (role === 'hr') return '好，这题先到这里，按手册执行。';
  if (role === 'regulator') return '先配合到这里，整改项我们会书面列出。';
  return '先按你说的处理，我看着。';
}

function pickUnused(lines, usedKeys) {
  for (const line of lines) {
    if (!usedKeys.includes(normKey(line))) return line;
  }
  return null;
}

function normKey(s) {
  return String(s || '')
    .replace(/[「」""'：:，,。！？?\s]/g, '')
    .slice(0, 36);
}

function overlapRatio(a, b) {
  const x = normKey(a);
  const y = normKey(b);
  if (!x || !y) return 0;
  let hit = 0;
  const gram = 2;
  const set = new Set();
  for (let i = 0; i <= y.length - gram; i += 1) set.add(y.slice(i, i + gram));
  for (let i = 0; i <= x.length - gram; i += 1) {
    if (set.has(x.slice(i, i + gram))) hit += 1;
  }
  return hit / Math.max(set.size, 1);
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}
