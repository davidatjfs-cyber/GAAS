import { getBrandConfigSync } from '../../utils/brand-config-loader.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { buildOpsChecklistResponse } from './helpers.js';
import { tryHandleChiefEvaluatorScore, loadChiefEvaluatorEmployeeContext } from './evaluator-helpers.js';
import {
  buildOpsSupervisorLlmSystemPrompt,
  tryHandleOpsSupervisorImages,
} from './ops-supervisor-helpers.js';
import {
  buildAppealSystemPrompt,
  buildAppealUserMessage,
  buildGeneralAssistantSystemPrompt,
} from './prompt-helpers.js';
import { formatKnowledgeBaseContext, formatTrainingTasksContext } from './training-context.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-agent-message-routes' });

async function routeDataAuditor(ctx, deps) {
  const {
    text,
    route,
    routeRes,
    store,
    brand,
    brandId,
    brandConfig,
    senderRole,
    senderUsername,
    senderName,
    sessionState,
    activeTaskContext,
  } = ctx;
  const { handleDataAuditorCase, inferBrandFromStoreName, resolveDataAuditorStore } = deps;

  return handleDataAuditorCase({
    text,
    route,
    routeRes,
    store,
    brand,
    brandId,
    brandConfig,
    senderRole,
    senderUsername,
    senderName,
    sessionState,
    activeTaskContext,
    inferBrandFromStoreName,
    resolveDataAuditorStore,
  });
}

async function routeOpsSupervisor(ctx, deps) {
  const {
    text,
    route,
    hasImage,
    imageUrls,
    store,
    brand,
    senderUsername,
    senderRole,
    brandId,
    brandConfig,
    activeTaskContext,
  } = ctx;
  const { auditImage, getOpsKnowledgeSupport, callLLM, getOpsReasoningModel } = deps;

  if (hasImage) {
    const imgHit = await tryHandleOpsSupervisorImages(
      { imageUrls, store, brand, senderUsername, route, brandId, brandConfig },
      { auditImage }
    );
    if (imgHit.handled) {
      return { response: imgHit.response, agentData: imgHit.agentData };
    }
  }

  let knowledgeSupport = null;
  const dbChecklist =
    brand === '洪潮' || brand === '马己仙'
      ? getBrandConfigSync(brand, resolveTenantIdDefault())?.checklist
      : null;
  const checklistResponse = buildOpsChecklistResponse({
    text,
    brand,
    store,
    brandChecklist: dbChecklist,
  });

  let response;
  if (checklistResponse) {
    response = checklistResponse;
  } else {
    knowledgeSupport = await getOpsKnowledgeSupport(text, { store, brand });
    if (knowledgeSupport.type === 'standard' || knowledgeSupport.type === 'knowledge_base') {
      response = knowledgeSupport.response;
    } else {
      const llm = await callLLM(
        [
          {
            role: 'system',
            content: buildOpsSupervisorLlmSystemPrompt({ store, brand, activeTaskContext }),
          },
          { role: 'user', content: text },
        ],
        {
          model: getOpsReasoningModel(),
          role: senderRole,
          purpose: 'reasoning',
          temperature: 0.05,
          max_tokens: 360,
        }
      );
      response = llm.content || '收到，我会跟进处理。';
    }
  }

  return {
    response,
    agentData: { route, knowledgeSupport: knowledgeSupport?.type, brandId, brandConfig },
  };
}

async function routeChiefEvaluator(ctx, deps) {
  const {
    text,
    route,
    senderUsername,
    senderName,
    senderRole,
    store,
    brand,
    brandId,
    brandConfig,
    activeTaskContext,
  } = ctx;
  const { pool, getSharedState, runWithCheckAgent, callLLM, getContext, updateContext } = deps;

  const scoreHit = await tryHandleChiefEvaluatorScore(pool(), {
    text,
    senderUsername,
    senderName,
  });
  if (scoreHit.handled) {
    return {
      response: scoreHit.response,
      agentData: { route, brandId, brandConfig, dataBacked: true },
    };
  }

  const employeeContext = await loadChiefEvaluatorEmployeeContext(getSharedState, {
    senderRole,
    store,
  });
  const hrSystemPrompt = `你是"小年"，年年有喜餐饮集团AI助理，当前协助人事管理。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。门店：${store}（${brand}）。用户：${senderName}（${senderRole === 'store_manager' ? '店长' : senderRole === 'store_production_manager' ? '出品经理' : '员工'}）。\n\n职责：离职/入职/转正/晋升/调岗流程、薪资咨询、请假/休假/考勤、社保/档案、绩效规则、员工信息查询。\n\n严格约束：\n- 只能基于下方员工资料回答员工相关问题，禁止编造不在列表中的员工信息。\n- 禁止编造日期，当前真实日期以上方为准。\n- 可以说明一般流程和政策框架，但涉及具体数字必须基于数据。\n回复不超过300字。${employeeContext}${activeTaskContext}`;
  const hrContext = getContext(senderUsername).slice(-4);
  const response = await runWithCheckAgent(text, 'chief_evaluator', async (checkFeedback) => {
    const extraNote = checkFeedback
      ? `\n\n【质检反馈，请修正后重新回答】${checkFeedback}`
      : '';
    const hrLlm = await callLLM(
      [
        { role: 'system', content: hrSystemPrompt + extraNote },
        ...hrContext,
        { role: 'user', content: text },
      ],
      { role: senderRole, purpose: 'reasoning', temperature: 0.05, max_tokens: 420 }
    );
    return hrLlm.content || '收到，我会为您查询相关信息并尽快回复。';
  });
  updateContext(senderUsername, 'user', text);
  updateContext(senderUsername, 'assistant', response);
  return { response, agentData: { route, brandId, brandConfig, dataBacked: false } };
}

async function routeAppeal(ctx, deps) {
  const { text, route, senderUsername, senderName, store, senderRole, activeTaskContext } = ctx;
  const { pool, runWithCheckAgent, callLLM, getContext } = deps;

  const appealSystemPrompt = buildAppealSystemPrompt({ activeTaskContext });
  const appealContext = getContext(senderUsername);
  const appealUserMsg = buildAppealUserMessage({ senderName, store, senderRole, text });
  const response = await runWithCheckAgent(text, 'appeal', async (checkFeedback) => {
    const extraNote = checkFeedback
      ? `\n\n【质检反馈，请修正后重新回答】${checkFeedback}`
      : '';
    const llm = await callLLM(
      [
        { role: 'system', content: appealSystemPrompt + extraNote },
        ...appealContext,
        { role: 'user', content: appealUserMsg },
      ],
      { role: senderRole, purpose: 'reasoning', temperature: 0.05, max_tokens: 360 }
    );
    return llm.content || '已记录，我们将在24小时内核实并回复。';
  });
  try {
    await pool().query(
      `INSERT INTO agent_appeals (username, reason, status) VALUES ($1, $2, 'pending')`,
      [senderUsername, text]
    );
  } catch {
    /* ignore */
  }
  return { response, agentData: { route, appealRecorded: true } };
}

async function routeTrainAdvisor(ctx, deps) {
  const {
    text,
    route: _route,
    senderUsername,
    senderName,
    senderRole,
    store,
    brand,
    brandId,
    brandConfig,
    brandTag,
    activeTaskContext,
  } = ctx;
  const {
    pool,
    getEmployeePositionForKb,
    queryKnowledgeBase,
    callLLM,
    getContext,
    updateContext,
  } = deps;

  let kbContext = '';
  let kbResults = [];
  try {
    let kbPos = '';
    try {
      kbPos = await getEmployeePositionForKb(senderUsername);
    } catch {
      kbPos = '';
    }
    kbResults = await queryKnowledgeBase(
      ['sop', '流程', '标准', '规范', '培训', '课件', '带教'],
      text,
      3,
      {
        brandTag,
        skipKnowledgeAudienceFilter: false,
        userRole: senderRole,
        userStore: store,
        userPosition: kbPos,
      }
    );
    kbContext = formatKnowledgeBaseContext(kbResults);
  } catch {
    /* ignore */
  }

  let trainingTasksContext = '';
  try {
    const tasks = await pool().query(
      `SELECT task_id, type, title, status, due_date, progress_data FROM training_tasks 
             WHERE assignee_username = $1 ORDER BY created_at DESC LIMIT 5`,
      [senderUsername]
    );
    trainingTasksContext = formatTrainingTasksContext(tasks.rows);
  } catch (e) {
    log.error({ msg: 'fetch_training_tasks_error', err: String(e?.message || e) });
  }

  const trainingFocusText = brandConfig?.trainingFocus?.length
    ? `\n品牌培训重点：${brandConfig.trainingFocus.join('；')}`
    : '';
  const systemPrompt = `你是"小年"，年年有喜餐饮集团AI助理，当前协助培训与标准化咨询。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。严格约束：禁止编造任何数据（员工人数、薪资日期等），无数据时说明"暂无此信息"。严格执行品牌隔离。${brandConfig?.sopKeypoints?.length ? `\n品牌SOP关键点：${brandConfig.sopKeypoints.join('；')}` : ''}${trainingFocusText}

你的核心能力：
【SOP标准咨询】流程规范查询、操作指导、赔付退款处理、品牌差异化SOP
【培训战略体系】制定培训战略、搭建人才发展与梯队培养框架、领导力发展、管培生/内训师体系设计、年度培训预算与计划、对接业务部门做培训需求分析、主导管理层培训与关键岗位赋能、企业文化落地、管理培训团队与讲师资源、评估培训效果与ROI
【基础培训执行】组织新员工入职培训与岗位技能培训、制作整理更新培训课件资料、安排培训场地设备签到与现场支持、收集培训反馈记录培训数据归档、协助完成培训计划与通知下发、对接讲师学员保障培训正常开展
【培训跟踪评估】跟进员工的培训任务进度，解答培训过程中的疑惑，进行线上知识考核与效果评估

当前信息：
- 门店：${store}（${brand}，brand_id=${brandId || 'n/a'}）
- 用户：${senderName}（${senderUsername}，角色：${senderRole}）
- 查询：${text}

${kbContext}${trainingTasksContext}${activeTaskContext}

请根据问题类型选择合适的回复结构：
如果是SOP/流程问题：
1. **问题判断**：简要确认理解的问题
2. **标准流程**：分步骤说明具体操作（1-2-3格式）
3. **注意事项**：关键提醒和常见错误
4. **参考依据**：相关SOP条款或标准

如果是培训咨询/任务问题：
1. **进度跟进**：结合用户的培训任务，指出当前进度或待办
2. **专业解答**：解答用户关于课件或技能的疑惑
3. **下一步建议**：给出接下来的学习或实操建议
4. **效果评估**：如果是完成阶段，可以向用户提问1-2个关键知识点进行检验

要求：简洁实用，总回复不超过400字。`;

  const contextHistory = getContext(senderUsername);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...contextHistory.slice(-4),
    { role: 'user', content: text },
  ];

  const llm = await callLLM(messages, {
    role: senderRole,
    purpose: 'reasoning',
    temperature: 0.05,
    max_tokens: 800,
  });
  const response =
    llm.content || '这个问题我需要查阅最新的SOP手册或培训资料，稍后回复你。';

  updateContext(senderUsername, 'user', text);
  updateContext(senderUsername, 'assistant', response);

  return {
    response,
    agentData: {
      route: 'train_advisor',
      kbResults: kbResults.length,
      contextUsed: contextHistory.length,
      brandId,
      brandConfig,
    },
  };
}

async function routeGeneral(ctx, deps) {
  const { text, senderUsername, senderRole, store, brand, senderName, activeTaskContext, brandId } =
    ctx;
  const { callLLM, getContext } = deps;

  const llm = await callLLM(
    [
      {
        role: 'system',
        content: buildGeneralAssistantSystemPrompt({
          store,
          brand,
          senderName,
          senderRole,
          activeTaskContext,
        }),
      },
      ...getContext(senderUsername),
      { role: 'user', content: text },
    ],
    { role: senderRole, purpose: 'reasoning', temperature: 0.05, max_tokens: 260 }
  );
  const response =
    llm.content ||
    '收到你的消息。你可以问我数据审计、营运检查、绩效考核等问题，也可以直接发照片给我审核。';
  return {
    response,
    agentData: { route: 'general', contextUsed: getContext(senderUsername).length, brandId },
  };
}

/**
 * @returns {{ response: string, agentData: object }}
 */
export async function dispatchAgentMessageRoute(ctx, deps) {
  const { route } = ctx;

  switch (route) {
    case 'data_auditor':
      return routeDataAuditor(ctx, deps);
    case 'ops_supervisor':
      return routeOpsSupervisor(ctx, deps);
    case 'chief_evaluator':
      return routeChiefEvaluator(ctx, deps);
    case 'appeal':
      return routeAppeal(ctx, deps);
    case 'train_advisor':
    case 'sop_advisor':
      return routeTrainAdvisor(ctx, deps);
    default:
      return routeGeneral(ctx, deps);
  }
}
