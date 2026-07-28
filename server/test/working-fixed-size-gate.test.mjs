/**
 * B2 棘轮：working-fixed.html 总行数只减不增。
 * 新 UI 逻辑应写入 frontend/src/pages/*.js，经 bundle-frontend 拼回，勿直接堆 inline script。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../working-fixed.html');

/**
 * 冻结基线（2026-07-23 P3 build:shell 后 wc -l working-fixed.html）。
 * 2026-07-28 第一次上调（69156→69481）：新增 frontend/src/pages/15-workspace.js（角色工作台
 * Phase 1，含 boss/hq/store/employee/hq_hr 五个 persona 视图 + 一键执行封装 + JS 注入的容器/
 * 样式/导航入口）。
 * 2026-07-28 第二次上调（69481→69563）：15-workspace.js 按 role-workspaces-mockup.html 的
 * 「黑缎玫瑰」配色/字体重写注入样式（原先 fallback 到未定义的 --card 变量导致卡片在深色
 * 背景上显示成白色）、任务卡「查看进展」按 category 是否命中六大增长方案问题分类分流到
 * 经营诊断页/Agent任务板、SELECT 增加 category/source 字段。
 * 2026-07-28 第三次上调（69563→69618）：老板驾驶舱 AI 洞察卡改接真实
 * /api/ontology/closed-loop-report，取代写死文字（Phase 2 #2）。
 * 2026-07-28 第四次上调（69618→69622）：修复任务卡门店名重复显示的 bug
 * （master_tasks.title 本身可能已含门店名，之前又拼了一次）。
 * 2026-07-28 第五次上调（69622→69710）：新增「今日经营总览」（营收今日/本周/本月+同比环比+
 * 目标达成率、客流/客单/桌均/堂食外卖占比/就餐人数分布、营业额/客流/人效门店排名），
 * 老板=admin 不过滤门店，hq_manager 按 allowed_stores 过滤（这次用户澄清：老板/总经理/
 * 总部营运经理共用同一套首页布局，区别只是门店范围）。
 * 2026-07-28 第六次上调（69710→69917）：按用户要求一次性做完首页剩余7项：
 * 门店营销活动建议（growth_actions）、离职率（复用 getTurnoverRate）、下属绩效评级总览
 * （employee_scores）、六大管理神器（内嵌 diagnosis/solutions/:key 方案+下发按钮）、
 * 门店红绿灯改严格锁定上月、8大AI督导指挥中心（内嵌发布框，不跳转，接 agent-task-board）、
 * 差评展示（合并 bad_reviews + table_visit_records，可滚动+按门店/日期检索）。
 * 2026-07-28 第七次上调（69917→69962）：UI 反馈修正——门店红绿灯从"方块+门店名首字"改成
 * 整行列表（完整门店名+颜色点+达成率，按红→黄→绿排序，原来同品牌门店首字撞车根本认不出
 * 是哪家店）；差评展示去掉表单式检索改成 chip 快捷筛选+纯滚动 feed；经营总览里客流/客单/
 * 桌均/堂食外卖占比/人数分布/离职率从多个方块 grid 改成紧凑的 label-value 单行列表；
 * 按用户要求从页面上移除 AI洞察卡+批量推广（不在9项计划内，容易混淆——代码保留未删，
 * 用户要研究这两个功能再决定要不要留）。
 * 2026-07-28 第八次上调（69962→70097）：六大神器加第7项"餐饮总监"（接现有
 * /api/diagnosis/solutions/custom/analyze 自由提问接口）+ AI洞察嵌入六大神器选店后展示 +
 * 新增"待办"三分区组件（任务/待批/通知，待批接现有 /api/approvals）+ 批量推广修复
 * assignee_username 缺失（用 pickAssigneeForCategory 自动解析出品经理）。
 * 2026-07-28 第九次上调（70097→70213）：修正三处真实bug——① 待办组件"任务"tab之前
 * 复用了带"查看进展"跳转Agent任务板按钮的卡片组件，用户明确要求这里只留完成按钮，
 * 加了 hideProgressLink 参数专门处理这个场景；② 六大神器之前直接调用 agent-task-board
 * 创建通用任务，完全绕开了经营诊断真正的阶梯目标+轮次机制，导致"点击没反应"（没有开放
 * 轮次时 plan 为空但没做responsive判断）——改成对齐经营诊断页 gsRenderPlan/gsRenderRound
 * 同一套真实逻辑，一键下发真正调用 POST /api/diagnosis/solutions/:key/rounds 创建轮次；
 * ③ 餐饮总监改成完全对齐经营诊断页原有布局（标题+说明+输入框+按钮+进行中的自定义任务+
 * 最近查询记录），接的都是现成接口（custom/analyze、custom/active-rounds、custom/history）。
 * 2026-07-28 第十次上调（70213→70215）：营收KPI卡"环比"改成具体对比对象（昨天/上周/
 * 上月），"同比"统一改成"去年"，不再用财务术语。
 * 同样通过正规 frontend/src/pages 结构新增，不是绕过棘轮的偷懒堆砌——按棘轮精神仍然
 * 「只减不增」：此后任何改动都不得让总行数超过这个新基线，除非同样是一次经过说明的、
 * 刻意的上调。
 * 2026-07-28 第十一次上调（70215→70218）：AI洞察空数据状态补上"AI 洞察"标签（之前只有一行
 * 无标签文字，用户反馈六大神器里"没发现"AI洞察功能）；老板/总部/门店工作台头部补充登录人
 * 姓名+角色/职位显示；差评展示区块顺序移到今日经营总览后面（原来在六大神器/AI督导中心后）。
 * 2026-07-28 第十二次上调（70218→70263）：① 餐饮总监从六大神器按钮网格里拆出来做成独立板块
 * （用户反馈混在一起容易认错），有自己的门店选择器+容器，不再共用 #ws-six-tool-body；
 * ② 核查发现经营诊断六大神器/餐饮总监下发的任务落在独立的 growth_solution_tasks 表，
 * 从未被工作台"任务"列表（只查 master_tasks）读到——用现成的
 * GET /api/diagnosis/solutions/my-tasks 补上这个真实缺口，归一化合并进同一个任务列表，
 * 完成按钮按 source 区分调用 growth_solution_tasks 专用的 complete 接口。
 * 2026-07-28 第十三次上调（70263→70264）：修复手机端登录看不到"工作台"入口——手机底部
 * 固定5格导航栏(mobile-nav)只有首页/知识库/考试/更多，没有工作台这一项，桌面端的
 * wsInjectNavItem 只找 .sidebar nav，手机端压根没有这个选择器命中的元素。在"更多"弹出菜单
 * (openMobileMoreMenu 的 allItems 列表)第一项加了工作台入口，复用已有的 showPage('workspace')
 * 分发和已经在白名单里的页面权限判断，不用改动固定导航栏结构。
 * 2026-07-28 第十四次上调（70264→70338）：店长/厨师长工作台按用户完整10项spec重做——
 * 待办组件(任务/待批/通知)+今日经营总览(改成可传单店门店范围复用老板同一套逻辑)+差评展示+
 * 当月目标追踪(营业日目标已有数据复用，新增毛利目标读daily_reports月均actual_margin/
 * target_margin；大众点评/企微目标库里确认没有对应数据源，如实展示"暂无"不编数字)+
 * 智能备货(直接iframe内嵌现有/forecast.html，不重新实现预测接口)+员工绩效列表(复用
 * teamPerformanceSummary，新增LEFT JOIN employees取岗位)+员工培训看板(现有
 * /api/training/dashboard新增?store=可选门店过滤，店长看本店全员而不是只看自己派发的)+
 * 厨房打点看板(复用现有/api/kitchen/dashboard真实打点数据)+员工级别/门店级别(级别已在
 * header，门店级别从storeLights里找自己门店的rating一起显示)。
 * 2026-07-28 第十五次上调（70338→70355）：三处真实修复——① 头部级别/门店级别之前数据为空时
 * 直接不显示，看着像没做，改成始终显示"级别暂无"/"门店级别暂无"占位；② 当月目标追踪的
 * "其他目标"之前写死"没有数据源"，核实后发现系统确实有通用KPI目标机制(kpi_targets表，
 * 任意metric_key)只是之前没查到，改成动态读该店真实配置的目标列表，如实说明只有目标值、
 * 暂无自动核算实际值的机制；③ GET /api/tenant-settings/kpi-targets 之前只有
 * admin/hq_manager/hr_manager 能读，店长查自己门店会403，加了门店角色查自己门店的只读放行。
 * 2026-07-29 第十六次上调（70355→70490）：修复任务完成闭环——① "确认完成/批准"按钮之前
 * 统一调 /api/agent-task-board/tasks/:id/review，那个接口 GAAS 代理层和 agents-service-v2
 * 两边都限定 admin/hq_manager/hr_manager 才能调，真正的责任人（出品经理/店长等）点击必定403；
 * ② 用户明确指出"点一下就算完成"不构成闭环，责任人必须提交实际证据（文字说明/图片如培训
 * 签字文件），完成动作要能回传给发起人确认。现在 master_tasks 来源的任务改成走
 * /api/workspace/tasks/:id/respond(责任人提交证据，状态进 pending_review) →
 * /api/workspace/tasks/:id/confirm-response(发起人/admin/hq_manager 确认通过或打回，打回会
 * 通知责任人重新提交)，新增"待确认的任务反馈"板块给发起人用；growth_solution 来源任务不受
 * 影响，继续用它自己的 /complete 接口。证据文件上传复用现成的 /api/uploads/ops-task-evidence，
 * 没有新建上传接口。
 */
const MAX_LINES = 70490;

test('working-fixed.html line count must not grow', () => {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const lineCount = (content.match(/\n/g) || []).length;
  assert.ok(
    lineCount <= MAX_LINES,
    `working-fixed.html has ${lineCount} lines (max ${MAX_LINES}). ` +
      'Do not add inline script/HTML here — put new UI in frontend/src/pages/*.js and bundle.',
  );
});
