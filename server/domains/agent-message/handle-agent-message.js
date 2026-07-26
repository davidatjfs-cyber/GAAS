/**
 * handleAgentMessage orchestration shell (Wave A2a).
 * data_auditor case body stays in agents.js and is injected as handleDataAuditorCase.
 */
import { randomUUID } from 'crypto';
import { AGENT_FEATURE_FLAGS } from '../../agent-config-manager.js';
import { getSessionState, setSessionState, logExecutorEvent } from '../../data-executor.js';
import { handleHqBrainMessage } from '../../hq-planner-agent.js';
import { handleMarginMessage } from '../../margin-message-handler.js';
import { getBrandConfigSync } from '../../utils/brand-config-loader.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import {
  buildOpsChecklistResponse,
  formatActiveTaskContext,
  isShortOptionReply,
} from './helpers.js';
import { tryHandleTrainingFlows } from './training-flow.js';
import { tryHandleChiefEvaluatorScore, loadChiefEvaluatorEmployeeContext } from './evaluator-helpers.js';
import { applyPostRouteQualityGates } from './post-route-quality.js';
import { buildEvidencePackage, needsAutonomousDataTask } from './quality-helpers.js';
import {
  maybeInheritRecentRoute,
  resolveDataAuditorStore,
  resolveHqStoreFromText,
} from './store-resolve.js';
import { formatKnowledgeBaseContext, formatTrainingTasksContext } from './training-context.js';
import {
  buildOpsSupervisorLlmSystemPrompt,
  tryHandleOpsSupervisorImages,
} from './ops-supervisor-helpers.js';
import {
  buildAppealSystemPrompt,
  buildAppealUserMessage,
  buildGeneralAssistantSystemPrompt,
} from './prompt-helpers.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-agent-message' });

/**
 * @param {object} deps
 * @returns {(senderUsername: string, senderName: string, senderStore: string, senderRole: string, senderBrandContext: any, text: string, imageUrls: any) => Promise<any>}
 */
export function createHandleAgentMessage(deps) {
  const {
    pool,
    routeMessage,
    prefixWithAgentName,
    callLLM,
    getContext,
    updateContext,
    getBrandRuntimeConfig,
    getSharedState,
    inferBrandFromStoreName,
    runWithCheckAgent,
    enforceUnifiedQualityGate,
    markQualityMetric,
    setAgentLongMemory,
    getEmployeePositionForKb,
    queryKnowledgeBase,
    getOpsKnowledgeSupport,
    getOpsReasoningModel,
    auditImage,
    findStoreManager,
    createOrUpdateAutonomousDataTask,
    notifyAutonomousDataTaskOwner,
    handleDataAuditorCase,
  } = deps;

  return async function handleAgentMessage(
    senderUsername,
    senderName,
    senderStore,
    senderRole,
    senderBrandContext,
    text,
    imageUrls
  ) {
    const hasImage = Array.isArray(imageUrls) && imageUrls.length > 0;
    let routeRes = await routeMessage(text, hasImage, senderUsername);
    let route = routeRes.route;

    if (route === 'clarify') {
      return prefixWithAgentName('master', routeRes.message || '请问您具体想咨询哪个方面的问题？');
    }

    let sessionState = null;
    if (AGENT_FEATURE_FLAGS.enable_session_state) {
      try {
        sessionState = await getSessionState(senderUsername);
        if (sessionState && sessionState.created_at) {
          const ageMs = Date.now() - new Date(sessionState.created_at).getTime();
          if (ageMs > 2 * 60 * 60 * 1000 || sessionState.status === 'closed') {
            sessionState = null;
          }
        }
      } catch (e) {
        logExecutorEvent('session_state_load_error', {
          username: senderUsername,
          error: e?.message,
        });
      }
    }

    if (!sessionState) {
      sessionState = {
        task_id: randomUUID(),
        route: null,
        intent: null,
        metrics_requested: [],
        metrics_returned: [],
        metric_versions: {},
        time_range: null,
        store: null,
        status: 'active',
        created_at: new Date().toISOString(),
      };
    }

    let store = senderStore;

    if (!store || store === '总部') {
      store = await resolveHqStoreFromText(pool(), text, store);
    }

    let activeTaskContext = '';
    try {
      const taskR = await pool().query(
        `SELECT task_id, category, severity, title, detail, status, created_at FROM master_tasks WHERE assignee_username=$1 AND status IN ('pending','pending_response','in_progress') ORDER BY created_at DESC LIMIT 3`,
        [senderUsername]
      );
      activeTaskContext = formatActiveTaskContext(taskR.rows);
    } catch {
      /* ignore */
    }

    if (route === 'general' && isShortOptionReply(text)) {
      route = await maybeInheritRecentRoute(pool(), senderUsername, route);
    }

    try {
      log.info({
        msg: 'hq_brain_check',
        role: senderRole,
        text: String(text || '').slice(0, 40),
      });
      const hqResult = await handleHqBrainMessage({
        text,
        role: senderRole,
        username: senderUsername,
        store,
      });
      if (hqResult?.handled) {
        log.info({ msg: 'hq_brain_handled', preview: String(hqResult.response || '').slice(0, 60) });
        return prefixWithAgentName('master', hqResult.response || '');
      }
    } catch (e) {
      log.error({ msg: 'hq_brain_routing_error', err: String(e?.message || e) });
    }

    {
      const training = await tryHandleTrainingFlows(pool(), {
        text,
        senderRole,
        senderUsername,
        route,
      });
      if (training.handled) return training.response;
    }

    if (text.includes('毛利率') && text.includes('%')) {
      try {
        const result = await handleMarginMessage(text);
        if (result.success) {
          return `毛利率数据已收到并保存：${JSON.stringify(result)}`;
        }
      } catch (e) {
        log.error({ msg: 'margin_message_error', err: String(e?.message || e) });
      }
    }

    const brand = String(senderBrandContext?.brandName || '').trim();
    const brandId = String(senderBrandContext?.brandId || '').trim();
    const brandTag = brandId ? `brand:${brandId}` : '';
    const brandConfig = getBrandRuntimeConfig(await getSharedState(), senderBrandContext);

    let response = '';
    let agentData = { route, brandId, brandConfig };

    sessionState.route = route;
    sessionState.intent = routeRes.intent || sessionState.intent;
    sessionState.store = store || sessionState.store;
    if (routeRes.time_range) sessionState.time_range = routeRes.time_range;
    setSessionState(senderUsername, sessionState).catch(() => {});

    try {
      switch (route) {
        case 'data_auditor': {
          const da = await handleDataAuditorCase({
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
          response = da.response;
          agentData = da.agentData;
          break;
        }

        case 'ops_supervisor': {
          if (hasImage) {
            const imgHit = await tryHandleOpsSupervisorImages(
              { imageUrls, store, brand, senderUsername, route, brandId, brandConfig },
              { auditImage }
            );
            if (imgHit.handled) {
              response = imgHit.response;
              agentData = imgHit.agentData;
              break;
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

          agentData = { route, knowledgeSupport: knowledgeSupport?.type, brandId, brandConfig };
          break;
        }

        case 'chief_evaluator': {
          const scoreHit = await tryHandleChiefEvaluatorScore(pool(), {
            text,
            senderUsername,
            senderName,
          });
          if (scoreHit.handled) {
            response = scoreHit.response;
            agentData = { route, brandId, brandConfig, dataBacked: true };
            break;
          }

          const employeeContext = await loadChiefEvaluatorEmployeeContext(getSharedState, {
            senderRole,
            store,
          });
          const hrSystemPrompt = `你是"小年"，年年有喜餐饮集团AI助理，当前协助人事管理。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。门店：${store}（${brand}）。用户：${senderName}（${senderRole === 'store_manager' ? '店长' : senderRole === 'store_production_manager' ? '出品经理' : '员工'}）。\n\n职责：离职/入职/转正/晋升/调岗流程、薪资咨询、请假/休假/考勤、社保/档案、绩效规则、员工信息查询。\n\n严格约束：\n- 只能基于下方员工资料回答员工相关问题，禁止编造不在列表中的员工信息。\n- 禁止编造日期，当前真实日期以上方为准。\n- 可以说明一般流程和政策框架，但涉及具体数字必须基于数据。\n回复不超过300字。${employeeContext}${activeTaskContext}`;
          const hrContext = getContext(senderUsername).slice(-4);
          response = await runWithCheckAgent(text, 'chief_evaluator', async (checkFeedback) => {
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
          agentData = { route, brandId, brandConfig, dataBacked: false };
          break;
        }

        case 'appeal': {
          const appealSystemPrompt = buildAppealSystemPrompt({ activeTaskContext });
          const appealContext = getContext(senderUsername);
          const appealUserMsg = buildAppealUserMessage({ senderName, store, senderRole, text });
          response = await runWithCheckAgent(text, 'appeal', async (checkFeedback) => {
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
          agentData = { route, appealRecorded: true };
          break;
        }

        case 'train_advisor':
        case 'sop_advisor': {
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
          response = llm.content || '这个问题我需要查阅最新的SOP手册或培训资料，稍后回复你。';

          updateContext(senderUsername, 'user', text);
          updateContext(senderUsername, 'assistant', response);

          agentData = {
            route: 'train_advisor',
            kbResults: kbResults.length,
            contextUsed: contextHistory.length,
            brandId,
            brandConfig,
          };
          break;
        }

        default: {
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
          response =
            llm.content ||
            '收到你的消息。你可以问我数据审计、营运检查、绩效考核等问题，也可以直接发照片给我审核。';
          agentData = { route: 'general', contextUsed: getContext(senderUsername).length, brandId };
          break;
        }
      }
    } catch (e) {
      log.error({ msg: 'handle_agent_message_error', err: String(e?.message || e) });
      response = '抱歉，处理消息时出现错误，请稍后重试。';
      agentData = { route, error: String(e?.message || e) };
    }

    {
      const postQ = await applyPostRouteQualityGates(
        { text, route, response, agentData, senderUsername, senderRole, store, brand },
        { markQualityMetric, enforceUnifiedQualityGate }
      );
      response = postQ.response;
      agentData = postQ.agentData;
    }
    const evidence = agentData?.evidence || buildEvidencePackage(agentData, { route, store, brand });

    try {
      await setAgentLongMemory(senderUsername, 'last_route', {
        route,
        store,
        brand,
        confidence: agentData.confidence,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }

    try {
      if (agentData.metrics_returned?.length) {
        sessionState.metrics_returned = [
          ...new Set([...(sessionState.metrics_returned || []), ...agentData.metrics_returned]),
        ];
      }
      if (agentData.metric_versions) {
        sessionState.metric_versions = {
          ...(sessionState.metric_versions || {}),
          ...agentData.metric_versions,
        };
      }
      sessionState.route = route;
      sessionState.store = store || sessionState.store;
      await setSessionState(senderUsername, sessionState);
    } catch {
      /* ignore */
    }

    if (needsAutonomousDataTask(agentData) && store && store !== '总部') {
      try {
        const state = await getSharedState();
        const owner = await findStoreManager(state, store);
        const task = await createOrUpdateAutonomousDataTask({
          taskType: 'data_gap',
          store,
          brand,
          requesterUsername: senderUsername,
          route,
          queryText: text,
          reason: String(
            agentData?.reason ||
              (agentData?.factualGuardrailBlocked ? 'factual_guardrail_blocked' : 'insufficient_evidence')
          ).slice(0, 120),
          evidence,
          ownerUsername: owner || '',
          dueHours: 8,
        });
        if (task) {
          agentData.autonomousTaskId = task.id;
          notifyAutonomousDataTaskOwner(task).catch(() => {});
        }
      } catch (e) {
        log.error({ msg: 'autonomous_data_gap_task_failed', err: String(e?.message || e) });
      }
    }

    return { route, response, agentData };
  };
}
