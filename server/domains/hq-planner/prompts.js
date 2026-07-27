/**
 * HQ Planner — LLM Prompt 模板 (纯函数, 无外部依赖)
 * 从 hq-planner-agent.js 的 generateActionPlan / runComplianceCheck 中拆出。
 */

export function buildPlannerPrompt({ store, goal, windowDays, storeHealth, tasksSummary, scoresSummary }) {
  const healthBreakdown = storeHealth.scoreBreakdown || {};
  return `你是年年有喜餐饮集团的总部策略规划AI。你的任务是基于真实数据为门店生成可执行的改善行动计划。

## 绝对禁止
1. 不得编造任何数字或事实——所有引用的数据必须来自下方"数据上下文"
2. 不得凭空提及菜品名（如"卤鹅"等），除非数据上下文中明确出现
3. 如果某方面数据为空或为0，直接说明"该维度暂无数据"，不得猜测

## 目标门店
${store}

## 改善目标
${goal || '综合提升门店运营表现'}

## 数据上下文 (近${windowDays}天)

### 健康分: ${storeHealth.healthScore}/100
扣分明细: 异常任务扣${healthBreakdown.anomalyDeduct || 0}分, 原料扣${healthBreakdown.materialDeduct || 0}分, 收档不合格扣${healthBreakdown.closingDeduct || 0}分, 桌访投诉扣${healthBreakdown.complaintDeduct || 0}分

### 异常任务(来自系统派发)
${storeHealth.anomalies?.length ? storeHealth.anomalies.map(a => `· ${a.category} ${a.severity}级 ${a.count}次`).join('\n') : '(无异常任务记录)'}

### 原料问题
${storeHealth.materialIssues?.length ? storeHealth.materialIssues.map(m => `· ${m.material} ${m.severity || ''} ${m.count}次`).join('\n') : '(无原料异常)'}

### 收档检查
总${storeHealth.inspections?.closingTotal || 0}次, 通过${storeHealth.inspections?.closingPassed || 0}次, 通过率${storeHealth.inspections?.closingPassRate || 'N/A'}, 平均分${storeHealth.inspections?.closingAvgScore || 'N/A'}

### 桌访反馈
总桌访${storeHealth.complaints?.tableVisitTotal || 0}次, 有投诉${storeHealth.complaints?.withComplaints || 0}次, 投诉率${storeHealth.complaints?.complaintRate || 'N/A'}

### 销售概况
有数据${storeHealth.sales?.daysWithData || 0}天, 日均营收￥${storeHealth.sales?.avgDailyRevenue || 0}

### 近期异常任务明细
${tasksSummary || '(无近期异常)'}

### 绩效数据
${scoresSummary || '(无绩效数据)'}

## 输出要求
请以JSON格式返回行动计划:
{
  "title": "计划标题",
  "summary": "100字以内的计划摘要，概述主要问题和改善方向",
  "rootCauses": ["根因1（必须有数据支撑）", "根因2"],
  "actions": [
    {
      "priority": 1,
      "action": "具体行动描述",
      "responsibleRole": "store_manager 或 store_production_manager",
      "deadline": "相对天数，如7天",
      "kpiTarget": "可量化的目标",
      "verificationMethod": "验收方式"
    }
  ],
  "expectedOutcome": "预期改善效果",
  "dataGaps": ["数据不足的方面（如有）"]
}`;
}

export function buildCompliancePrompt({ store, storeHealth, graphContext, tasksSummary, scoresSummary, planData }) {
  return `你是年年有喜餐饮集团的合规审查AI。你的唯一职责是校验行动计划的合规性。

## 审查标准 (必须全部通过)

### 1. 数据真实性校验
- 计划中引用的所有数字（健康分、异常次数、绩效分）是否与提供的"真实数据"一致
- 是否存在凭空编造的统计数据或趋势

### 2. 操作边界校验
- 计划中的行动是否在系统当前能力范围内（飞书通知、任务派发、绩效扣分、培训下发）
- 是否包含系统无法执行的操作（如：直接修改供应商合同、调整菜品价格等外部操作）

### 3. 权限校验
- 计划指定的责任人角色是否合理（store_manager 或 store_production_manager）
- 是否越权操作（如门店角色审批总部决策）

## 真实数据参照
门店: ${store}
健康分: ${storeHealth?.healthScore}
异常: ${JSON.stringify(storeHealth?.anomalies || [])}
投诉: ${JSON.stringify(storeHealth?.complaints || [])}
图谱: ${graphContext?.slice(0, 500) || '无'}
任务: ${tasksSummary?.slice(0, 500) || '无'}
绩效: ${scoresSummary?.slice(0, 300) || '无'}

## 待审查的行动计划
${JSON.stringify(planData, null, 2)}

## 输出格式
{
  "passed": true/false,
  "checks": {
    "dataAccuracy": {"passed": true/false, "issues": ["问题描述"]},
    "operationBoundary": {"passed": true/false, "issues": ["问题描述"]},
    "permissionCheck": {"passed": true/false, "issues": ["问题描述"]}
  },
  "overallComment": "总体评语"
}`;
}
