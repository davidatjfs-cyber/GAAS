/**
 * Master Agent message router (Wave A6 peel from agents.js routeMessage).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-message', handler: 'route-message' });

const FOLLOWUP_HINT_PATTERNS = /(继续|还有|上面|那个|再说|再查|补充|详细|展开)/i;

/** @internal exported for unit tests */
export function inferRouteByRules(text, hasImage = false) {
  if (hasImage) return { route: 'ops_supervisor', confidence: 1, reason: 'image_input' };
  const t = String(text || '').trim();
  if (!t) return null;

  const keywordMap = [
    { route: 'appeal', score: 2, rx: /(申诉|投诉|不公平|误判|恢复扣分|举报)/i },
    {
      route: 'data_auditor',
      score: 3,
      rx: /(收档.*(得分|平均|合格|多少|几次|报告|数据|情况)|开档.*(得分|平均|合格|多少|几次|报告|数据|情况))/i,
    },
    { route: 'ops_supervisor', score: 2, rx: /(开市|开档|收档|闭市|巡检|卫生|拍照|上传照片|检查表)/i },
    {
      route: 'data_auditor',
      score: 2,
      rx: /(营业额|营收|毛利|差评|桌访|达成率|排名|趋势|预测|分析|人效|报损|原料)/i,
    },
    {
      route: 'chief_evaluator',
      score: 2,
      rx: /(绩效|评分|考核|奖金|离职|入职|转正|调岗|请假|社保|档案|薪资|工资)/i,
    },
    { route: 'train_advisor', score: 2, rx: /(sop|标准|流程|培训|课件|带教|退款|赔付)/i },
  ];

  let best = { route: 'general', score: 0, reason: '' };
  for (const item of keywordMap) {
    if (item.rx.test(t)) {
      best = { route: item.route, score: item.score, reason: item.rx.source };
      break;
    }
  }
  if (best.score > 0) return { route: best.route, confidence: 0.92, reason: `rule:${best.reason}` };
  return null;
}

function safeJsonParse(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* ignore */
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    return JSON.parse(m[0]);
  } catch {
    return fallback;
  }
}

/**
 * @param {object} deps
 * @returns {(text: string, hasImage: boolean, senderUsername: string) => Promise<object>}
 */
export function createRouteMessage(deps) {
  const {
    pool,
    callLLM,
    matchAnalysisRule,
    logExecutorEvent,
    getFeatureFlags,
    getAgentLongMemory,
  } = deps;

  return async function routeMessage(text, hasImage, senderUsername) {
    const t = String(text || '').trim();

    // ── P0: 规划类请求最高优先——直接路由到 data_auditor（BI），跳过规则引擎走方案生成路径
    if (
      /(营销方案|推广方案|新品方案|活动策划|行动方案|具体方案|提升.*方案|方案.*提升|如何提升|怎么提升|怎样提升|提升.*营收|提升.*营业额|增加.*营收|增加.*营业额)/.test(
        t
      )
    ) {
      return { route: 'data_auditor', confidence: 1.0, reason: 'plan_request_p0' };
    }

    // ── P1: 规则引擎（最高优先级，确定性路由）——Feature Flag 保护
    const flags =
      typeof getFeatureFlags === 'function' ? getFeatureFlags() || {} : {};
    if (flags.enable_rule_engine && flags.enable_metric_dictionary) {
      try {
        const analysisRule = await matchAnalysisRule(t);
        if (analysisRule) {
          logExecutorEvent('route_rule_engine_hit', {
            intent: analysisRule.intent,
            required_metrics: analysisRule.required_metrics,
            username: senderUsername || null,
          });
          return {
            route: analysisRule.route || 'data_auditor',
            intent: analysisRule.intent,
            intent_label: analysisRule.intent_label,
            required_metrics: analysisRule.required_metrics || [],
            confidence: 1.0,
            reason: `rule_engine:${analysisRule.intent}`,
          };
        }
      } catch (e) {
        log.error({ msg: 'rule_engine_error', err: String(e?.message || e) });
      }
    }

    // ── P2: 原有规则路由 ──
    const ruleRoute = inferRouteByRules(t, hasImage);
    if (ruleRoute?.route && ruleRoute.route !== 'general') {
      return {
        route: ruleRoute.route,
        confidence: ruleRoute.confidence || 0.9,
        reason: ruleRoute.reason || 'rule_match',
      };
    }

    // ── P2.5: 规划类请求优先路由到 data_auditor（BI Agent 有方案生成能力）──
    const explicitPlanKeywords =
      /(营销方案|推广方案|新品方案|活动策划|行动方案|具体方案|提升.*方案|方案.*提升|如何提升|怎么提升|怎样提升|提升.*营收|提升.*营业额|增加.*营收|增加.*营业额)/;
    if (explicitPlanKeywords.test(t)) {
      return { route: 'data_auditor', confidence: 1.0, reason: 'plan_request_to_bi' };
    }

    const explicitOpsKeywords =
      /(拍照|上传照片|巡检|检查表|开市检查|收档检查|开档检查|闭市检查)/;
    const explicitDataKeywords =
      /(桌访|差评|点评|大众点评|评价.*(怎么样|结果|情况|差|多少)|营业额|营收|生意|经营情况|经营|毛利|日报|业绩|达成率|目标.*营|客诉|kpi|人效|收档.*(得分|平均|合格|多少|几次|报告|数据)|开档.*(得分|平均|合格|多少|几次|报告|数据)|原料.*(异常|收货|多少|几次|报告|日报)|食材|进货|例会|早会|班会|报损|订单.*数|客单价|会员.*数|充值)/i;
    if (explicitDataKeywords.test(t) && !explicitOpsKeywords.test(t)) {
      return { route: 'data_auditor' };
    }

    // 快速通行：如果是单数字选项回复，直接返回general供后续继承历史路由
    if (/^\d+$/.test(t) || /^[一二三四五六七八九十]$/.test(t) || FOLLOWUP_HINT_PATTERNS.test(t)) {
      if (senderUsername) {
        const memory = await getAgentLongMemory(senderUsername, 'last_route');
        const memoryRoute = String(memory?.route || '').trim();
        if (memoryRoute && memoryRoute !== 'general') {
          return { route: memoryRoute, confidence: 0.86, reason: 'memory_followup' };
        }
      }
      return { route: 'general' };
    }

    // 获取最近的对话历史作为上下文（近30分钟内的最后3条非系统消息）
    let contextStr = '';
    if (senderUsername) {
      try {
        const historyRes = await pool().query(
          `SELECT content, direction FROM agent_messages WHERE sender_username = $1 AND content_type IN ('text', 'image') AND created_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 3`,
          [senderUsername]
        );
        if (historyRes.rows && historyRes.rows.length > 0) {
          const msgs = historyRes.rows
            .reverse()
            .map((r) => `${r.direction === 'in' ? '用户' : 'Agent'}: ${r.content}`);
          contextStr = `\n【最近对话上下文】\n${msgs.join('\n')}\n`;
        }
      } catch (e) {
        log.error({ msg: 'history_fetch_error', err: String(e?.message || e) });
      }
    }

    const systemPrompt = `你是HRMS系统的主控路由Agent (Master Agent)。
你的唯一任务是根据用户的输入和对话上下文，决定将其路由给哪个专业的子Agent处理。
请严格输出JSON格式，必须包含以下三个字段，不要输出任何其他Markdown或散文：
{
  "route": "目标Agent标识符",
  "confidence": 0到1之间的置信度分数,
  "reason": "路由的简短理由，如果confidence低于0.7，请在这里填入反问用户的澄清话术（例如：您是想咨询财务问题还是技术问题？）"
}

可用Agent标识符及职责：
- data_auditor : 负责【数据审计与营收规划】，如查询门店营收、毛利率、损耗、差评数据，以及制定营销方案、营收提升方案、新品推广方案、活动策划等。
- ops_supervisor : 负责【营运督导】，如开市收市检查、卫生巡检、图片审核、日常巡店检查表。
- chief_evaluator : 负责【HR与绩效】，如查询个人绩效分数、考核扣分、门店评级，以及离职、入职、请假、加薪等HR人事流程与制度咨询。
- train_advisor : 负责【培训与SOP】，如查阅SOP规范、操作指导、退款赔付流程，以及发起培训、查询课件、员工带教。
- appeal : 负责【申诉与投诉】，如员工对处罚扣分不服的申诉、对店长或同事的投诉举报。
- general : 如果无法明确归类到以上5个专业领域，或者只是简单的闲聊打招呼。

【Few-Shot 示例】
示例1:
用户输入: "我登不上系统了"
输出: {"route": "general", "confidence": 0.9, "reason": "系统登录问题不属于当前5个专业Agent，交由general处理"}
示例2:
用户输入: "我要投诉"
输出: {"route": "appeal", "confidence": 0.95, "reason": "明确包含投诉意图"}
示例3:
用户输入: "给我做一个黄油蟹新品的营销方案，适用门店洪潮久光店"
输出: {"route": "data_auditor", "confidence": 1.0, "reason": "营销方案/新品推广属于data_auditor职责，会调取真实销售数据生成方案"}
示例4:
用户输入: "给我做一个提升洪潮久光店营收的具体方案"
输出: {"route": "data_auditor", "confidence": 1.0, "reason": "营收提升方案属于data_auditor职责"}
示例5:
用户输入: "帮我查一下那个单子"
输出: {"route": "general", "confidence": 0.4, "reason": "请问您是要查营收数据单、培训单，还是考勤异常单？"}
${contextStr}
当前用户输入: "${t}"
请严格返回JSON：`;

    try {
      const llm = await callLLM([{ role: 'system', content: systemPrompt }], {
        temperature: 0.1,
        max_tokens: 150,
        purpose: 'analysis',
      });

      let resultText = String(llm.content || '').trim();
      resultText = resultText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

      const result = safeJsonParse(resultText, null);
      if (!result || typeof result !== 'object') {
        log.error({ msg: 'json_parse_failed', text: resultText });
        return { route: 'general' };
      }

      const validRoutes = [
        'data_auditor',
        'ops_supervisor',
        'chief_evaluator',
        'train_advisor',
        'appeal',
        'general',
      ];

      if (result.confidence < 0.7 && result.reason) {
        if (ruleRoute?.route && ruleRoute.route !== 'general') {
          return {
            route: ruleRoute.route,
            confidence: ruleRoute.confidence || 0.9,
            reason: 'rule_override_low_confidence',
          };
        }
        return { route: 'clarify', message: result.reason };
      }

      if (validRoutes.includes(result.route)) {
        return { route: result.route };
      }
      return { route: 'general' };
    } catch (e) {
      log.error({ msg: 'llm_routing_failed', err: String(e?.message || e) });
      return { route: 'general' };
    }
  };
}
