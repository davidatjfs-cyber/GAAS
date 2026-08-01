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
 * 2026-07-29 第十七次上调（70490→70518）：① 所有角色工作台底部加"快捷操作"折叠区块
 * (休假申请/升职申请/总经理信箱/修改密码/离职申请)，直接复用"我的档案"页已有的
 * pf2-fold/pf2-qk 样式和全局 data-click 处理函数，没有新写弹窗逻辑；② 用户反馈
 * .ws-section__title 跟正文(.ws-card__desc 13px)几乎一样大、层级不清，改成17px/700。
 * 2026-07-29 第十八次上调（70518→70661）：合并 feature/workspace-shell-p1（登录页品牌
 * logo/slogan、5页黑缎玫瑰配色、GET /api/state 性能优化、打卡超时修复等真实工作）到
 * main——该分支也有一版更早、不完整的 15-workspace.js（365行，Phase 1 壳，且后来自己
 * 加了 wsRemoveNavItem 把侧栏入口摘掉了，因为当时页面加载会黑屏），跟本分支完整的10项
 * 工作台实现（1300+行）合并时冲突，取的是本分支这份完整实现，丢弃了对方那份未完成的
 * 壳和"移除入口"的临时规避（问题本身已经在本分支修好了，不需要再规避）。working-fixed.html
 * 冲突不手工合并生成文件，直接用合并后的 frontend/src/pages/*.js 重新跑 bundle-frontend
 * 生成。
 * 2026-07-29 第十九次上调（70661→70663）：修复合并遗留——01-boot.js 里"01-boot.js" 有个
 * hunk 跟本分支没有文本冲突所以git静默按对方那边合并，保留了 c6e2716 那次"移除侧栏工作台
 * 入口"的临时改动（调用 wsRemoveNavItem + 从 hrmsIsAlwaysAllowedPage 白名单删掉
 * 'workspace'）——但 wsRemoveNavItem 这个函数在合并 15-workspace.js 时已经被删掉了（连着
 * 那份未完成的壳一起丢弃），导致调用点在调用一个不存在的函数、什么都不做，侧栏"工作台"
 * 入口消失。改回调用 wsInjectNavItem()，'workspace' 加回白名单。
 * 2026-07-29 第二十次上调（70663→70687）：生产实测发现的多处真实bug修复——任务栏加
 * source/category白名单过滤（去掉growth_monitor营销/data_auditor审计等噪音）、
 * 本周本月环比改成跟上周上月"同样长度区间"对齐（之前拿本月未过完天数比上月整月）、
 * 实收目标改成往前找最近已配置period(不再要求当月精确匹配)、人效排名取整数、门店下拉框
 * 改用真实门店台账而不是master_tasks里的脏文本、新增GET /api/notifications真实列表接口
 * 接入"通知"tab（之前只有未读数没有列表）。
 * 2026-07-30 第二十一次上调（70687→70718）：① 任务详情(task.detail)之前原样dump成一个
 * <div>，食品安全类任务detail能有几百字，字面**加粗**标记不生效只显示星号，卡片被撑得
 * 很长、操作按钮被挤到很下面——新增 wsFormatTaskDetail()：**text**转真正<strong>，超过
 * 120字用原生<details>/<summary>折叠（同一套模式09-resignation.js的ack-details已在用）；
 * ② "待确认的任务反馈"里之前直接显示assignee_username(如nnyxyf26)，改成JOIN employees
 * 显示真实姓名(assignee_name)；③ .ws-card__desc补overflow-wrap:anywhere，避免飞书记录号
 * 这类长十六进制串撑出横向溢出。
 * 2026-07-30 第二十二次上调（70718→70723）：业务方确认"本周/本月运营周报"保留，且需要
 * 抄送总部经理/管理员——周报汇总的每项异常(营收达成/人效/桌访系列/差评系列等)触发时
 * 已经由agents-service-v2的anomaly-notify-pipeline.js各自建了带真实责任人的任务，周报
 * 本身没有单独责任人，cc视图收窄查询里加上category IN (weekly_report,
 * monthly_evaluation)；前端_ccOnly文案按类目区分：食安显示"仅同步知悉，由责任人处理"，
 * 周报/月评显示"运营汇总，仅供查阅"（不能说"由责任人处理"，周报本来就没有单独责任人）。
 * 2026-07-30 第二十三次上调（70723→70868）：一批用户实测反馈的修复——① 门店红绿灯
 * "无评级"：恢复被2026-04误停的月度门店评级计算调度（详见performance-jobs.js）；
 * ② 8大AI督导指挥中心的记录加点击展开详情（状态流转+证据+审核记录），之前closed等
 * 状态点了没反应；③ 门店营销活动建议加长文本折叠 + 执行/忽略操作（复用增长看板同一套
 * /api/growth/actions/:key/execute与/ignore接口）；④ "今日营收"改成"昨日营收"（当天
 * 日报几乎总是还没出，显示今日会永远是¥0且环比永远-100%）；本周/本月"至今"的统计口径
 * 也从锚定today改成锚定yesterday，避免用still-zero的"今天"把当周/当月拉低、制造假环比；
 * ⑤ 客流量/客单价/桌均/堂食外卖占比/就餐人数分布从全范围聚合成一个数字改成按单店返回
 * 数组分别展示；堂食/外卖占比的数据源从pos_orders现数订单条数改成daily_reports本来就有
 * 的dine_orders/delivery_orders权威字段（业务方指出"数据都在营业日报里"）。
 * 2026-07-30 第二十四次上调（70868→70946）：业务方看到效果后撤回上一轮"运营周报保留并
 * 抄送"的决定，改为整个从任务栏拿掉（agents-service-v2的rhythm-engine-ops-reports.js
 * 同步移除对应createUnifiedTask调用）；另修复一批实测反馈——① 8大AI督导指挥中心状态
 * 显示中文（board_status映射，含详情时间线）；② 出品经理任务栏出现的陈年"试味"任务
 * 根因是hr_filed（催办无响应后已备案）终态漏在几处开放任务过滤条件之外，统一补上；
 * ③ 培训看板/厨房打点看板展示到员工姓名+状态明细（原数据已有，前端未展示）；④ 差评
 * 展示补上服务端强制的门店权限范围（之前任何角色不传store参数即可看到全部门店）；
 * ⑤ 智能备货iframe空白问题的best-effort修复：token通过URL query传递给forecast.html，
 * 缓解部分容器环境iframe localStorage隔离导致取不到token的情况；⑥ 门店营销活动建议、
 * 任务栏卡片统一改成details/summary折叠样式，与8大AI督导指挥中心一致。
 * 2026-07-30 第二十五次上调（70946→71018）：上一轮部分修复实测仍不生效，深挖到根因后
 * 的真正修复——① 通知栏/任务栏一直是0：生产库target_username/assignee_username大小写
 * 不统一(如NNYXWSB39 vs登录名nnyxwsb39)，之前是大小写敏感精确匹配，改成lower()两边比较；
 * ② 差评展示单店范围内仍是空：agent_messages里飞书门店名是缩写("洪潮久光店")跟员工表
 * 官方全称("洪潮大宁久光店")不是同一字符串，改用expandAgentStoreLabels()展开别名后ANY匹配；
 * ③ 就餐人数分布一直是0（不分角色，admin也一样）：pos_orders.store_name是POS原始长名
 * ("洪潮传统潮汕菜【大宁久光中心店】")，用resolveAgentCanonicalStore()在JS里归一化后再
 * 分组/过滤；④ 本月离职率一直是0：employment_records表从未被写入过(生产库0行，跟之前
 * bad_reviews同类"设计后没接上"的遗留表)，users表压根没有store列(SQL直接报错被吞掉)，
 * 改成从employees表(status='离职'+extra_json.offboardingDate)真实计算；⑤ 当月目标追踪
 * 只有营业额：用户在"目标管理"页面(08-materials-tasks.js)录入的毛利率/充值/点评星级/
 * 企微新增等目标存在HRMS_STORE.settings.monthlyTargets里，跟这里原先查询的kpi_targets表
 * 完全是两套独立机制，之前从未读取前者，现在两边都读并合并展示；⑥ 培训看板按培训主题
 * 分组导致同一人记录分散、看不出"这人到底完成几项"，改成反向按员工分组(姓名+岗位)，
 * 主题作为该员工下的明细；⑦ 厨房打点看板补上日期标题；⑧ 智能备货iframe空白的真正根因
 * 定位——不是localStorage分区(上一轮的猜测)，是nginx对所有.html文件统一加了
 * X-Frame-Options: DENY，浏览器据此拒绝任何iframe渲染，跟同源与否无关；已给
 * /forecast.html单独加精确匹配location改成SAMEORIGIN(nginx配置改动，不在本仓库版本
 * 控制范围内，另行记录于部署记录)；⑨ 各区块(差评展示/当月目标追踪/员工绩效/培训看板/
 * 厨房打点看板等)统一包成details/summary可折叠，默认展开。
 * 2026-07-30 第二十六次上调（71018→71138）：用户实测反馈"任务栏是要清空的队列，不是
 * 展示区"及一批数据/UI问题——① 任务栏各类完成动作(提交证据/批准/确认收到/判罚)成功后
 * 直接从DOM移除卡片而不是留一行"已完成"文案；食品安全cc任务新增per-user"确认收到"
 * (master_task_acks表)与hq_manager专属"提交判罚结果"(真正status=resolved，对所有cc
 * 收件人都消失)两条路径；② 8大AI督导时间线里"未知"改成"任务创建前"(status_before是
 * task_created事件的空字符串，不是异常)；③ 智能备货放弃iframe内嵌改成新标签页直接打开
 * (nginx X-Frame-Options修复后安卓WebView仍反馈空白，二级嵌套iframe在部分容器下本身不
 * 可靠，改成普通同源跳转彻底绕开这整类问题)；④ 差评展示门店筛选框单店角色不再显示
 * "全部门店"，直接显示自己门店名(disabled select)；⑤ 实收目标只算出马己仙——生产库洪潮
 * revenue_targets最新period停在2026-03、马己仙在2026-04，之前取"全租户唯一最近period"
 * 只命中马己仙那行，改成按门店各自MAX(period)分别取值求和；⑥ 当月目标追踪"系统暂未接入
 * 该指标的自动核算"改成真实从daily_reports聚合(充值/堂食营收/点评星级/企微新增等)+
 * monthly_margins(毛利)，新增GET /api/workspace/monthly-target-actuals；⑦ 客流量/客单价/
 * 桌均等门店经营明细改成门店选择下拉框驱动，不再是逐店平铺卡片；⑧ 门店营销活动建议
 * 区块本身也包一层details可整体折叠。
 * 2026-07-30 第二十七次上调（71138→71163）：管理员反馈工作台通知角标一直是0，跟"我的
 * 档案"看到的数字对不上——大小写问题修过一轮后角标还是0，再查证发现是两边"未读数"的
 * 定义根本不一样："我的档案"显示的是"今天创建了几条"(todayCount，不看read_at)，工作台
 * 这边之前是"read_at IS NULL的真未读数"——很多通知几分钟内就被自动ack过，这个口径几乎
 * 总是0。改成跟"我的档案"完全一致的口径(当天创建数量，Asia/Shanghai时区)；"通知"tab的
 * 内容也补上/api/announcements(公司公告)的merge，之前只有hrms_user_notifications、
 * 也没排除*_request类型，跟"我的档案"的内容对不齐。
 * 2026-07-30 第二十八次上调（71163→71215）：用户要求工作台最下方新增"我的绩效"模块
 * （综合得分+执行力/工作态度/工作能力三项进度条+等级徽章）——复用现成的
 * GET /api/agent-scores/me（"我的档案"个人绩效页已经在用同一接口），不新建接口。
 * 2026-07-30 第二十九次上调（71215→71245）：① admin/hq视角的工作台(wsRenderBossOrHq)
 * 之前没有"我的绩效"模块——上一轮只加到了店长/出品经理的wsRenderStore()，两条渲染路径
 * 各自独立维护区块列表，这里补齐；② "餐饮总监"最近查询记录/8大AI督导指挥中心的记录
 * 补上任务日期(之前只有标题，条数多了根本认不出哪天的)，8大AI督导补状态筛选下拉框
 * (默认只显示"进行中"，隐藏已结案系列状态，避免历史记录淹没正在处理的任务)。
 * 2026-07-30 第三十次上调（71245→71251）：① 门店经营明细加"门店人效值"（跟人效排名
 * 同一份daily_reports.efficiency数据源）；② "本月离职率"从工作台顶层挪进门店经营明细，
 * 按店各自展示（不再是跨全部门店的一个聚合数字，turnoverSummary()改成接受具体门店名单
 * 逐店查询）；③ 店长/出品经理视角取消营业额/客流量/人效排名，管理员/总部经理视角保留
 * （wsRenderOverview新增showRankings参数，由调用方按角色传入）。
 * 2026-07-30 第三十一次上调（71251→71288）：用户反馈"门店营销活动建议"点"执行"等于什么
 * 都没发生——promo_task类内容创作建议之前只是往growth_content_calendar插一行'planned'，
 * 没有责任人、没人知道要做、没有追踪。业务方明确要求所有类型营销建议"执行"都必须先选
 * 责任人(该门店店长/前厅主管)，生成master_tasks任务(source='growth_marketing_action'，
 * 已加入WS_ALLOWED_TASK_SOURCES白名单)，责任人任务栏能看到、需要提交完成证据、发起人
 * 确认后才算真正执行完成——复用现成的respondToTask/confirmTaskResponse流程；系统侧真实
 * 自动化动作(发券/发短信)仍照常立即执行，只是新增责任人确认这层追溯闭环。新增
 * POST /api/growth/actions/:actionKey/assign-and-execute。
 * 2026-07-30 第三十二次上调（71288→71296）：责任人分配上线后实测"本店未配置店长/前厅
 * 主管"几乎每次触发——两处真实bug：① growth_actions.store_id没有统一格式(POS原始长名/
 * 增长侧数字ID/员工表官方简称混杂)，跟employees.store对不上；② 前端HRMS_STORE本地员工
 * 数据的role字段有历史遗留中文标签("店长"等)，直接===比较'store_manager'必然漏掉。
 * 改成：marketing-suggestions.js返回前用resolveAgentCanonicalStore()归一化store字段，
 * assignMarketingActionTask写master_tasks.store前同样归一化；前端改用现成的
 * hrmsNormalizeRoleCode()比较角色，不再用原始role字面量。
 * 2026-07-30 第三十三次上调（71296→71323）：用户反馈"马己仙出品经理16:30收到试味定时
 * 任务，但工作台任务栏里根本没有"——查证生产库真实事件日志发现这条任务确实真实创建、
 * 通过飞书卡片送达，责任人在飞书里17秒内就回复提交了证据，系统自动审核通过秒级
 * resolved——不是没打通，是resolved的任务立刻从"任务"tab消失，责任人自己都没法回头
 * 确认"这件事到底有没有真的处理过"。新增"已完成"tab + GET
 * /api/workspace/tasks/recently-resolved（默认最近24小时），展示最近解决的任务
 * （不管是通过工作台还是飞书完成的），弥补这个可见性缺口。
 * 2026-07-30 第三十四次上调（71323→71329）：用户反馈营销活动责任人下拉框里出现了离职
 * 员工（武静静/徐曼金）——之前的过滤只看role+store，完全没排除离职/停用员工。前端补上
 * status='离职'/'inactive'排除（对齐09-resignation.js既有的同款判断）；后端
 * assignMarketingActionTask查询员工时也补上status='active'过滤，不能只靠前端过滤，
 * 离职员工哪怕绕过前端直接调接口也要被拒绝。
 * 2026-07-30 第三十五次上调（71329→71347）：一批实测反馈修复——① 餐饮总监"点击查看
 * 标准方案"按钮实际有效，只是结果写进了页面下方"六大管理神器"区块自己的容器，用户看不到
 * 变化以为按钮坏了，补scrollIntoView；② "最近查询记录"提交新查询后从未重新拉取过(后端
 * 其实一直在正确写入)，补上查询成功后刷新；③ "发布任务"到agents-service-v2自动分派
 * 完成有异步耗时，之前只在发布成功那一刻刷新一次列表，容易拿到过渡态快照，补一次2.5秒
 * 延迟刷新；④ revenue_targets.store存的是"洪潮久光店"缩写，跟storeFilter/员工表官方
 * 全称不是同一字符串，导致scoped角色(店长/出品经理)看到的实收目标一直是0——改用
 * expandAgentStoreLabels()展开别名后ANY匹配；⑤ 强化custom/analyze的AI prompt，禁止
 * 在已经注入真实数据(差评/离职快照)的情况下仍然输出"当前无本店真实数据"这类说法。
 * 2026-07-30 第三十六次上调（71347→71351）：用户反馈同一条"任务已提交完成反馈"通知
 * 堆积了2000+条——respondToTask的UPDATE漏排除pending_review状态导致重复提交能反复
 * 命中生成通知，且提交按钮未disable导致一次点击能连续触发大量重复请求。补上按钮
 * disabled防抖 + respondToTask同任务已有未读通知时跳过插入。
 * 2026-07-30 第三十七次上调（71351→71356）：上次给"点击查看标准方案"补的scrollIntoView
 * 修复本身有bug——六大管理神器面板默认display:none，只滚动没显示，用户反馈"点了还是
 * 没反应"依然成立。补上跳转前先把面板display设为可见（跟顶部按钮点击逻辑一致）。
 * 2026-07-30 第三十八次上调（71356→71367）：①营销建议补上真实发布渠道展示
 * (企业微信/短信/大众点评等)+是否系统自动执行的说明文案。
 * 2026-07-30 第三十九次上调（71367→71397）：用户明确要求"营销全部手动触发"，去掉自动
 * 执行相关文案；"忽略"改成实时刷新替换新建议（原来只是隐藏按钮，不会补新的）；补上
 * 未读"新"标签区分滚动更新后的新旧建议(localStorage记录已见过的actionKey)。
 * 2026-07-31 第四十次上调（71397→71401）：合并 origin/main 到 feature/workspace-shell-p1；
 * 正式晋升申请资格判断补上 trainingProgress.passed 这条兜底（此前只认
 * assessmentStatus === 'passed'，考核通过但该字段没同步的场景会显示"暂无可申请记录"）。
 * 2026-07-31 第四十一次上调（71401→71422）：① 修复店长/出品经理工作台"待批"硬编码成空
 * 数组、从未真正查询审批数据的bug，改成跟老板/总部视图一样查/api/approvals；
 * ② 管理员/总部营运经理/店长/出品经理这4个角色"我的档案"入口换成"工作台"（原档案页
 * 隐藏），其它角色保持不变。
 * 2026-07-31 第四十二次上调（71422→71432）：上一轮只改了桌面侧栏和"更多"弹出菜单，
 * 用户反馈手机端底部固定导航栏(mobile-nav)和登录后默认落地页(getHomePageName)这两个
 * 更核心的入口还是硬编码'profile'，没生效——补上getRoleBottomNavPages()把这4个角色的
 * 底部导航第一格从profile换成workspace、getHomePageName()按角色返回workspace、
 * pageMeta补workspace图标/标签映射。
 * 2026-07-31 第四十三次上调（71432→71446）：用户追问"工作台的通知是否100%代替了档案的
 * 通知功能"——查证发现强制通知弹窗轮询(startProfileNotificationAutoRefresh)之前只在
 * currentPage==='profile'时才触发，这4个角色几乎不再进档案页，会导致他们彻底收不到
 * 强制通知弹窗，是真实的功能缺口。补上workspace页面也触发同一套轮询（modal本身是全局
 * 元素，profile-notifications容器只是被隐藏不是移除，函数在workspace页调用一样生效）。
 * 2026-07-31 第四十四次上调（71446→71457）：用户反馈"工作台每次打开都是空白，必须再点
 * 一下才会加载"——根因是#workspace-page容器由wsEnsurePageContainer()懒创建，而showPage()
 * 里"隐藏所有页面/显示目标页面"这段逻辑靠getElementById(pageName+'-page')查找容器，首次
 * 进入时容器还不存在，这段逻辑找不到元素直接跳过，容器要等随后loadPageData才被创建出来，
 * 已经错过了"显示"这一步，第二次点击时容器已存在才正常显示。改成在显示逻辑执行前就
 * 提前创建好容器。
 * 2026-07-31 第四十五次上调（71457→71459）：用户要求"通知使用频率最高"——待办组件tab
 * 顺序从"任务/待批/通知"改成"通知/待批/任务"，默认展开的tab也从任务改成通知。
 * 2026-07-31 第四十六次上调（71459→71467）：用户反馈通知放最前+默认展开导致整页打开就是
 * 通知列表、看不到经营驾驶舱——改回"任务/待批/通知"原顺序+默认展开任务tab，改成通知有
 * 未读时用醒目红色边框+右上角脉冲红点吸引注意，不再用霸占整页的方式。
 * 2026-07-31 第四十七次上调（71467→71481）：用户反馈飞书秒回resolved的定时巡检任务
 * "工作台完全看不到"——查证生产库确认任务真实存在、责任人也分配对了，只是几十秒内被
 * resolved从"任务"tab消失，只在"已完成"tab才有。但"已完成"tab之前没有数字角标，是个
 * 空白按钮，用户不会点进去找。补上角标（并发预取recently-resolved接口），跟其它tab一致。
 * 2026-07-31 第四十八次上调（71481→71559）：用户反馈营销建议内容质量不行、对比增长看板
 * 的"PLLM策略实验"(结合门店真实差评/流失等异常信号生成的A/B方案+逐日执行步骤)质量高得多。
 * 查证发现这批高质量内容存在于完全独立的strategy_experiments/strategy_variants表，工作台
 * 从未查询过。接入这个数据源，专门渲染A/B双方案卡片，采纳/不适合复用增长看板同一套
 * /api/strategy-experiments/:code/approve|reject接口(权限跟接口一致仅admin/hq_manager
 * 可操作，其它角色只读展示)。
 * 2026-07-31 第四十九次上调（71559→71592）：①PLLM实验卡片补上每个variant的责任人下拉框
 * （approve接口早就支持storeAssignments却从没有调用方真正收集过），采纳时一起提交；
 * ②去掉之前假设action/executionGuide之外还有独立channel/readyCopy等字段的展示逻辑——
 * strategy_variants表实际只有两个文本列，这些新增信息已在agents-service-v2那边折叠进
 * action文本，改用wsFormatTaskDetail完整展示。
 * 2026-07-31 第五十次上调（合并两条独立分支改动）：①Talent Engine 门店 AI 岗位教练入口卡
 * 注入培训页（ensureJobCoachEntryCard），对练 UI 在独立 job-coach.html，不堆培训 HTML；
 * ②与上条PLLM责任人下拉框改动合并自两个各自基于71481的独立分支，实际行数以重新构建
 * working-fixed.html后的真实行数为准。
 * 2026-08-01 第五十一次上调（71630→71649）：差评展示补上来源筛选chip（桌访/大众点评/
 * 外卖/全部），跟日期chip同款交互，独立的单选组不互相清除active状态。
 * 2026-08-01 第五十二次上调（71649→71673）：8大AI督导指挥中心状态流转翻译agent key为
 * 中文岗位名、催办事件单独渲染成"催办中（第N次）"而不是含糊的"已分配→已分配"、去掉
 * 详情永久缓存改成每次打开都拉取最新数据。
 * 2026-08-01 第五十三次上调（71673→71684）：任务卡片补上发起人/开始时间/完成期限三行
 * （agents-service-v2的createBoardTask默认给2天期限，写入master_tasks.timeout_at/
 * created_by结构化列）。
 * 2026-08-01 第五十四次上调（71684→71689）：抄送(_ccOnly)任务标签之前复用severity算出
 * 的"待处理"/"需拍板"，跟真正指派给自己的任务视觉上分不清，改成中性的"仅抄送知悉"。
 * 2026-08-01 第五十五次上调（71689→71699）：出品经理待审批模块权限缺口修复（两处角色
 * 白名单遗漏 store_production_manager）。
 * 2026-08-01 第五十六次上调（71699→71711）：工作台待批可直接操作（店长/出品经理视图接入
 * pending-confirmations + 审批链列表接入 openApprovalDetailModal）。
 */
const MAX_LINES = 71711;

test('working-fixed.html line count must not grow', () => {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const lineCount = (content.match(/\n/g) || []).length;
  assert.ok(
    lineCount <= MAX_LINES,
    `working-fixed.html has ${lineCount} lines (max ${MAX_LINES}). ` +
      'Do not add inline script/HTML here — put new UI in frontend/src/pages/*.js and bundle.',
  );
});
