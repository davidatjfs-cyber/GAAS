/**
 * 客户 AI 的系统功能知识。
 *
 * 这里是外部客户可见的唯一产品事实源：回答、检索评测和 Markdown 手册都由它生成。
 * 不写服务器、密钥、内部评分、客户数据或尚未上线的承诺。
 */

import { createHash } from 'node:crypto';
import { PRODUCT_KNOWLEDGE_DETAIL_DEFINITIONS } from './sales-product-knowledge-details.js';

const MODULE_SOURCE_REFS = {
  account: ['working-fixed.html#main-app', 'working-fixed.html#canAccessModulePage'],
  profile: ['working-fixed.html#profile-page'], employee: ['working-fixed.html#employees-page'],
  attendance: ['working-fixed.html#attendance-page'], daily: ['working-fixed.html#daily-report-page'],
  approval: ['working-fixed.html#approvals-page', 'working-fixed.html#payment-page'],
  knowledge: ['working-fixed.html#knowledge-page', 'server/knowledge-routes.js'],
  training: ['working-fixed.html#training-page', 'working-fixed.html#exam-page', 'server/training.js'],
  agent: ['working-fixed.html#agents-page', 'working-fixed.html#agent-tasks-page', 'server/agents.js'],
  growth: ['working-fixed.html#growth-page', 'server/customer-ops.js'],
  diagnosis: ['working-fixed.html#diagnosis-page', 'server/ontology/routes.js'],
  strategy: ['working-fixed.html#strategy-page'], points: ['working-fixed.html#points-page', 'working-fixed.html#rewards-page'],
  kitchen: ['working-fixed.html#kitchen-page'], report: ['working-fixed.html#reports-page'],
  forecast: ['forecast.html', 'working-fixed.html#nav-forecast'], task: ['working-fixed.html#task-performance-page'],
  settings: ['working-fixed.html#settings-page'],
};

const card = (module, key, title, keywords, answer, steps = [], roles = '以账号实际可见权限为准', limits = '') => ({
  id: `${module}.${key}`,
  module,
  title,
  keywords,
  answer,
  steps,
  roles,
  limits,
  sources: MODULE_SOURCE_REFS[module] || [],
});

export const PRODUCT_MODULES = {
  account: '账号、权限与门店', profile: '我的档案', employee: '员工管理', attendance: '考勤与休假',
  daily: '营业日报', approval: '审批与请款', knowledge: '知识库', training: '培训、考试与晋升',
  agent: '数据中心与Agent', growth: '增长看板与客户运营', diagnosis: '经营诊断', strategy: '门店营销策略',
  points: '积分与奖惩', kitchen: '厨房执行', report: '分析报表', forecast: '智能预测',
  task: '任务和绩效', settings: '系统设置',
};

export const PRODUCT_KNOWLEDGE = [
  card('account','overview','系统整体功能',['系统是做什么','系统功能','平台功能','产品功能','有哪些模块','系统的功能','介绍整个系统'],
    '这套系统面向餐饮门店经营管理，把员工与权限、考勤、日报、审批请款、知识培训、厨房执行、经营报表、客户增长、诊断策略和Agent任务连接在一起。不同岗位看到的模块会按权限和门店范围裁剪。'),
  card('account','selling-points','系统核心卖点',['系统最大卖点','核心卖点','产品优势','为什么选择你们','和普通管理软件有什么区别','系统价值'],
    '系统的核心卖点不是多一个报表，而是把“发现问题、安排执行、提交证据、验收结果、复盘改善”连成闭环。经营数据、客户复购、门店任务和员工培训不再各自分散，老板可以直接看到哪里有问题、谁在处理、最后有没有改善。'),
  card('account','competitive-positioning','与微盟、有赞等平台的差别',['微盟有什么区别','威盟有什么区别','有赞有什么区别','友赞有什么区别','美团客户云有什么区别','竞品对比','和别的餐饮系统区别'],
    '微盟、有赞等平台公开的餐饮方案已经覆盖会员、储值和营销触达等能力，我们不会简单说它们做不到。我们的侧重点是把经营异常继续变成门店任务，明确责任人、执行证据和验收结果，再跟踪营业额、复购或执行是否真正改善。已经在用现有平台的客户不一定要替换，可先评估数据能否接入，再选代表门店做30天验证，结果合适再扩大。'),
  card('account','packages','基础、连锁与集团方案的差别',['基础版','连锁版','集团版','企业版','公司方案有什么差别','不同方案区别','门店多有什么差别'],
    '方案差别主要来自管理范围和协作复杂度，不是简单多几个页面。门店数量增加后，会涉及跨店汇总、区域与总部的分级权限、跨店任务和统一经营标准；最终启用范围仍要结合门店数、模块、数据接入和试跑范围确认，不在客户AI里承诺具体价格。'),
  card('account','cooperation-process','演示、试跑与正式合作流程',['合作流程','签约流程','怎么合作','系统演示','预约Demo','申请试跑','30天试跑'],
    '通常先确认门店情况和核心需求，再做数据接入评估与针对性演示；适合试跑的客户可选代表门店约定30天验证指标，复盘真实结果后再确认正式范围、商务方案和合同。报价、折扣与合同条款由获授权顾问审批确认。'),
  card('account','case-policy','客户案例与结果数据的公开规则',['服务过哪些餐厅','真实客户案例','成功案例','同类案例','案例数据'],
    '客户案例只有在获得对外使用授权并完成匿名处理后，才可以由客户AI或销售对外展示。没有授权时，系统不会编造客户名称、经营结果或提升比例；可先通过针对性演示和试跑指标验证产品是否适合。'),
  card('account','login','登录与修改密码',['登录','账号','密码','忘记密码','修改密码'],
    '员工使用分配的账号登录系统。登录后可在“我的档案”中修改自己的密码；无法登录或忘记原密码时，需要联系本企业系统管理员重置。',
    ['打开系统登录页并输入账号、密码','登录后进入“我的档案”','点击“修改密码”，填写原密码和新密码后保存']),
  card('account','store-switch','多门店切换',['切换门店','多门店','当前门店','看另一家店','allowed stores','跨店经理怎么切到另一家门店'],
    '拥有多门店范围的账号可以切换当前门店。切换后系统会重新加载该门店的员工、日报、审批和报表数据，不能切换到授权范围外的门店。',
    ['点击页面顶部或个人区域的当前门店','选择被授权的目标门店','等待页面重新加载后再查看业务数据']),
  card('account','permissions','看不到菜单或按钮',['看不到','没有菜单','权限','角色','岗位','模块不可见','按钮不见了','同事有菜单我没有'],
    '菜单和操作按钮由系统角色、岗位权限组、门店范围共同决定。若同事能看到而当前账号看不到，通常是岗位未勾选该模块、账号门店范围不同，或该功能仅管理员开放。',
    ['先确认当前切换的门店是否正确','让管理员在“系统设置－岗位（权限组）”核对模块权限','仍无权限时核对账号角色和门店范围']),

  card('profile','overview','个人档案内容',['我的档案','个人资料','发展地图','档案里有什么'],
    '“我的档案”集中展示个人基础信息、岗位与职级、所属门店、考勤概览、培训认证、积分表现和发展信息。普通员工主要在这里查看自己的数据。'),
  card('profile','leave','发起休假申请',['请假','休假申请','年假','调休','假期'],
    '员工可从“我的档案”发起休假申请，选择假期类型和起止时间并说明原因。提交后进入审批流程，审批结果可在个人档案或审批记录中查看。',
    ['进入“我的档案”','点击“休假申请”','选择类型和日期，填写原因','提交并等待审批']),
  card('profile','mailbox','总经理信箱',['总经理信箱','意见反馈','匿名建议','投诉'],
    '“总经理信箱”用于向管理层提交意见或问题。填写主题和内容后发送，具体处理范围和是否匿名以企业配置及页面提示为准。',
    ['进入“我的档案”','打开“总经理信箱”','填写主题和内容后提交']),

  card('employee','records','员工档案管理',['员工管理','新增员工','编辑员工','入职','员工档案'],
    '员工管理用于维护人员基础资料、门店、部门、岗位、职级和直属上级等信息。新增员工通常会进入入职审批，审批通过后才形成正式人员记录。',
    ['进入“员工管理”','点击新增或选择现有员工编辑','补齐门店、岗位、上级等必填项','保存或提交入职审批'], '管理员、HR及获授权管理者'),
  card('employee','offboarding','离职申请与交接',['离职','离职申请','员工离职','交接','员工要离职应该直接删掉吗'],
    '离职通过申请和审批处理，不建议直接删除员工。审批流程用于保留离职原因、日期和交接记录；完成后账号与在职状态按企业流程更新。',
    ['打开员工档案或离职入口','填写离职日期、原因及交接信息','提交审批','审批完成后核对人员和账号状态'], '管理员、HR及相关管理者'),
  card('employee','scope','员工跨店管理范围',['跨店员工','门店范围','允许门店','跨店职责'],
    '跨店人员可配置主门店、允许访问的门店，以及特定门店的职责绑定。主门店决定默认上下文，允许门店决定可切换范围，职责绑定用于跨店审批或业务负责关系。', [], '管理员'),

  card('attendance','checkin','上下班打卡',['打卡','上班打卡','下班打卡','定位','考勤'],
    '员工在“考勤打卡”中完成上班或下班打卡。系统会记录时间，并可按企业设置校验门店定位；定位不在允许范围或浏览器未授权定位时可能无法正常打卡。',
    ['打开“考勤打卡”并允许定位','确认当前门店和打卡类型','点击打卡并等待成功提示']),
  card('attendance','records','查看考勤记录与异常',['考勤记录','迟到','早退','缺卡','异常考勤'],
    '“考勤打卡”可查看个人打卡记录；管理报表可按门店、日期和员工查看迟到、早退、缺卡等异常。异常是否影响薪资由企业设置的考勤薪资规则决定。'),
  card('attendance','confirm','月度考勤确认',['考勤确认','月度确认','确认考勤','工资考勤'],
    '月度考勤确认用于让员工或管理者核对某月考勤结果。确认前应检查异常和补充说明；确认后的修改能力取决于管理员设置及工资结算状态。'),

  card('daily','submit','填写并提交营业日报',['营业日报','日报','提交日报','保存草稿'],
    '营业日报按门店和营业日期记录经营数据、客流、营业情况及现场信息。可以先保存草稿，核对后再正式提交；同一门店同一天通常维护一份日报。',
    ['进入“营业日报”','选择门店和营业日期','填写各项数据并上传需要的照片','先保存草稿或直接提交']),
  card('daily','edit','修改或删除日报',['修改日报','删除日报','日报填错','重新提交','日报填错了还能改吗'],
    '有权限的人员可以打开对应门店和日期的日报进行修改；删除属于高影响操作，是否可用取决于账号权限。已进入后续统计或审核的数据应先确认影响再修改。'),
  card('daily','private-room','包房月度统计',['包房','包间','包房营业额','包房月统计'],
    '营业日报支持按门店和月份汇总包房相关数据，便于查看当月累计表现。具体指标取决于日报实际填写字段。'),

  card('approval','inbox','待审批与审批操作',['待审批','审批','同意','驳回','审批意见'],
    '“待审批”汇总当前账号需要处理的单据，可按状态和类型筛选。审批人打开详情后可同意、驳回或填写意见；能看到哪些单据由流程、角色和门店职责共同决定。',
    ['进入“待审批”','筛选并打开目标单据','核对申请内容与附件','选择同意或驳回并填写必要意见']),
  card('approval','return','退回与重新提交',['退回申请','重新提交','驳回后修改','退回重提','审批被退回来以后怎么重新交'],
    '支持退回的单据可由审批人退回申请人补充或修改。申请人完成修改后重新提交，单据会按流程再次进入审批，历史处理记录会保留。'),
  card('approval','flow','审批流程如何决定',['审批流程','谁审批','审批人','流程设置','为什么给他审批'],
    '审批人由单据类型对应的审批流程、申请人门店、直属关系和跨店职责等共同解析。管理员可在系统设置中维护流程；普通用户不能自行指定不在流程中的审批人。'),
  card('approval','payment','发起请款',['请款','付款申请','报销','费用申请'],
    '“请款”用于提交费用或付款申请。申请人选择门店、月份和费用类别，填写金额、用途及附件后提交；系统可结合预算进行校验，审批通过后再由有权限人员登记付款。',
    ['进入“请款”并点击新建','选择门店、月份和费用类别','填写金额、说明并上传凭证','提交审批','审批通过后由财务登记付款']),
  card('approval','budget','请款预算与超预算',['请款预算','预算','超预算','费用类别','请款超过预算还能提交吗'],
    '管理员可按门店、月份和费用类别维护请款预算。提交请款时系统会展示或校验预算占用；超预算能否继续提交取决于企业流程配置，不代表系统自动批准。', [], '管理员、财务及获授权人员'),

  card('knowledge','upload','上传知识资料',['知识库','上传文件','批量上传','培训资料','文档'],
    '知识库用于集中上传和维护制度、SOP、产品及培训资料。支持单个或批量上传，资料可设置品牌、范围和适用对象；解析完成后可供检索和培训引用。',
    ['进入“知识库”','点击上传或批量上传','选择文件并设置品牌、范围和适用对象','等待解析完成后检查标题与内容'], '管理员或获授权人员'),
  card('knowledge','organize','知识库分组和整理',['知识分组','整理台','移动文档','重命名分组'],
    '“知识库整理台”可创建分组、查看组内文件、移动资料和重命名分组，帮助按业务主题整理内容。删除分组前应确认组内资料的处理方式。', [], '管理员或获授权人员'),
  card('knowledge','edit','编辑知识内容与重新解释',['编辑知识','修改文档内容','重新生成解释','知识解析错误'],
    '资料解析后可查看并编辑文本内容；解释不准确时可以重新生成。修改会影响后续检索和培训引用，因此应以企业正式制度或SOP为准。', [], '管理员或获授权人员'),

  card('training','topics','培训知识点与任务',['培训认证','培训知识点','培训任务','指派培训','员工学习SOP怎么指派'],
    '培训模块把知识点、学习任务、测验、实操和认证串联起来。管理者可创建知识点并关联知识库资料，再按员工、岗位或门店指派培训任务。',
    ['创建或选择培训知识点','关联适用岗位及知识库资料','指派员工并设置要求','员工学习、测验或提交实操','管理者查看结果']),
  card('training','materials','培训资料整理',['培训资料怎么整理','整理培训资料','培训文件怎么归类','培训内容如何组织','SOP资料整理'],
    '培训资料整理的关键不是把文件堆在一起，而是让员工找得到、学得完、还能验证。可以先按品牌、岗位和主题在知识库中分组，上传SOP、图片或视频并设置适用对象；再把资料关联到培训知识点，配置学习、测验、实操和认证要求。',
    ['在知识库按品牌、岗位或主题建立分组','上传资料并设置品牌、范围和适用对象','在培训认证中创建知识点并关联资料','配置测验、实操或认证要求','按员工、岗位或门店指派任务']),
  card('training','learn','员工完成培训',['我的培训','开始学习','培训测验','实操上传'],
    '员工在培训认证页查看分配给自己的知识点，进入学习会话后阅读资料、完成测验，并按要求上传实操证据。完成条件以该知识点配置为准。'),
  card('training','certification','认证审核与评分',['认证','认证审核','培训评分','待审核认证'],
    '员工完成规定内容后形成认证申请或记录。审核人可查看测验、实操证据和评分明细，决定通过、退回或调整评分；通过后显示在个人认证记录中。', [], '审核人及获授权管理者'),
  card('training','exam','考试测评',['考试','题库','安排考试','参加考试','考试记录'],
    '考试测评支持出题设置、题库、考试安排、员工在线作答和结果记录。管理者可安排考试，员工在“我被安排的考试”中作答，提交后查看允许公开的结果。'),
  card('training','promotion','晋升申请',['升职','晋升','我要升职','晋升培训','晋升考核'],
    '“我要升职”根据晋升通道展示目标岗位、必修培训和考核要求。员工提交晋升申请后，需要完成规定培训与审批；系统保留申请、培训和考核记录。'),

  card('agent','center','数据中心能看什么',['数据中心','Agent中心','智能助手','Agent监控'],
    '数据中心汇总系统健康、Agent运行、问题记录、消息活动和员工相关分析，帮助管理者判断自动任务是否正常以及哪些问题需要人工处理。具体卡片随账号权限和企业配置显示。', [], '管理员及获授权管理者'),
  card('agent','tasks','发布和跟踪Agent任务',['Agent任务','发布任务','任务中枢','任务验收','执行证据'],
    'Agent任务看板用于把门店问题转成可跟踪任务，覆盖发布、解析、认领、分配、执行、证据提交、验收、打回和结案。管理者可查看状态、超时和证据覆盖。',
    ['在Agent任务页描述问题并发布','确认系统解析和任务分配','跟踪执行与证据','在待验收阶段通过或打回','确认问题结案'], '管理员、总部营运、HR及获授权人员'),
  card('agent','feishu','飞书连接与同步',['飞书','飞书连接','同步飞书','飞书消息'],
    '系统可配置飞书连接，用于消息通知、任务协作或数据同步。管理员可测试连接和手动同步；是否能发送给某人还取决于企业飞书应用权限、人员映射及接收配置。', [], '管理员'),

  card('growth','dashboard','增长看板',['增长看板','增长数据','经营增长','增长动作'],
    '增长看板把经营指标、客户运营、增长问题和执行动作放在同一视图，帮助管理者从发现问题到执行、复盘形成闭环。可见门店和数据范围受账号权限限制。', [], '管理员或获授权人员'),
  card('growth','customer','客户分层与客户运营',['客户运营','客户分层','新客','老客','流失客户','会员'],
    '客户运营基于已接入的POS或会员数据，按消费次数、时间、金额等条件形成客户分层，并支持针对不同人群制定维护动作。实际可用字段取决于数据源和接入评估。'),
  card('growth','pos','POS数据接入',['POS','POS接入','销售数据','订单同步','能对接什么POS','POS是不是所有品牌都可以直接接'],
    'POS接入不是口头承诺的通用开关，需要先评估接口、订单明细、菜品、会员标识和历史数据质量。接入后系统才能进行经营分析、客户分层和效果归因；具体品牌是否可接需由技术评估确认。'),
  card('growth','campaign','营销触达与效果归因',['营销活动','触达','短信','企微','回店','ROI','营销归因'],
    '营销动作可面向选定客户人群进行触达，并跟踪后续回店和营业贡献。只有客户标识、订单数据和触达记录能够可靠关联时，系统才能做较可信的效果归因。'),

  card('diagnosis','overview','门店经营诊断',['经营诊断','门店诊断','经营问题','异常诊断'],
    '经营诊断按门店和经营指标识别异常，展示问题、证据和建议方向，并可进入对应增长方案。它用于辅助定位和推动整改，不等同于在缺少数据时保证找出唯一原因。', [], '管理员或获授权管理者'),
  card('diagnosis','solutions','六大增长方案',['六大增长方案','增长方案','解决方案','诊断方案'],
    '诊断页将常见经营问题组织为六类增长方案，用户选择当前问题后查看适用方案、任务和进展。方案最终效果仍取决于数据条件、门店执行和复盘。'),
  card('diagnosis','tasks','诊断整改任务',['整改任务','诊断任务','完成任务','团队任务'],
    '增长方案可以生成个人或团队整改任务。执行人提交完成情况和必要证据，管理者查看团队任务与进展，形成“发现问题－执行－验证”的闭环。'),

  card('strategy','experiment','创建营销策略实验',['门店营销策略','策略实验','A/B测试','营销实验'],
    '门店营销策略用于把营销想法做成可追踪实验。可创建单方案或A/B方案，设置目标与执行内容，记录结果后比较不同方案表现。',
    ['进入“门店营销策略”','新建实验并填写目标','配置方案A及可选方案B','执行后提交结果','比较指标并形成结论'], '管理员、总部营运、店长、出品经理及获授权人员'),

  card('points','points','员工积分',['员工积分','积分规则','积分排名','积分记录'],
    '员工积分记录可配置事项、分值和证据要求。员工或管理者按规则提交积分事项，经需要的审批后计入记录；积分页可查看个人积分、排行榜和明细。'),
  card('points','reward','奖惩单',['奖惩管理','奖励','处罚','奖惩单'],
    '奖惩管理用于创建奖励或处罚单，记录对象、原因、金额或影响、证据和审批过程。生效前应按企业流程审批，历史记录可在详情和报表中追溯。'),

  card('kitchen','prep','今日备料',['厨房执行','今日备料','备料任务','菜品负责'],
    '厨房执行页用于查看和维护今日备料任务，并按岗位或人员配置负责菜品。实际数量可结合经营计划或预测生成，执行人员按页面要求更新完成情况。'),
  card('kitchen','recipe','配方库',['配方库','菜品配方','原料配比','工艺步骤','后厨菜品的原料配比在哪看'],
    '配方库记录菜品的原料配比、工艺步骤和注意事项，供后厨按统一标准执行。有编辑权限的人员可新建或维护配方，普通员工以查看和执行为主。', [], '出品管理者及获授权人员'),

  card('report','business','经营分析报表',['分析报表','经营报表','营业额','销量','菜品分析'],
    '分析报表可按门店和日期查看经营汇总、营业额、销量及相关趋势。报表口径取决于接入的正式数据源和企业指标定义，查看前应确认门店与时间范围。'),
  card('report','hr','人事考勤薪资报表',['人事报表','考勤报表','工资报表','离职率','薪资'],
    '获授权管理者可查看考勤、工资、人员流动、晋升和薪资变更等报表。此类数据属于敏感信息，系统会按角色、权限和门店范围限制访问。', [], '管理员、HR、财务或获授权管理者'),
  card('report','export','报表筛选和导出',['导出报表','下载报表','筛选门店','筛选日期'],
    '使用报表时先选择门店、日期或月份，再执行查询；有导出按钮的报表可下载当前筛选结果。导出内容仍受账号数据范围限制。'),

  card('forecast','inventory','智能库存预测',['库存预测','备货预测','预测销量','采购预测','预测出来的备货量一定准吗'],
    '智能预测根据历史销售、产品映射和可用经营数据估算未来需求，提供备货参考并记录预测历史与准确率。预测是辅助决策，节假日、天气和临时活动等变化仍需人工校正。'),
  card('forecast','margin','毛利估算',['毛利预测','毛利估算','产品别名','毛利配置'],
    '管理员可维护产品别名和毛利相关配置，使不同数据名称映射到统一产品后进行收入或毛利估算。配置不完整时，估算结果可能缺项，应先完善映射。'),

  card('task','performance','任务和绩效',['任务和绩效','绩效记录','任务完成率','员工绩效'],
    '任务和绩效页将任务执行、完成证据和绩效结果汇总，供管理者查看员工或团队表现。评分应以已配置规则和有效记录为依据，不应仅凭AI文字判断。', [], '管理员、总部营运、HR及获授权人员'),

  card('settings','stores','门店与品牌设置',['系统设置','门店设置','新增门店','品牌设置','经营画像'],
    '管理员可在系统设置维护门店和品牌，包括名称、归属、状态及门店经营画像等。修改会影响筛选、权限和报表归属，应避免随意改名或重复建店。', [], '管理员'),
  card('settings','roles','岗位权限组',['岗位权限组','角色权限','模块权限','底部导航','权限配置'],
    '岗位（权限组）可配置员工可见模块、底部导航和门店范围。系统管理类页面仍有管理员硬边界，不能仅通过自定义岗位绕过。权限修改后相关账号重新加载或登录即可按新配置生效。', [], '管理员'),
  card('settings','flows','审批与业务规则设置',['审批流程设置','积分事项设置','考勤薪资规则','目标管理'],
    '系统设置集中维护审批流程、积分事项、考勤薪资规则和经营目标等基础规则。规则变更会影响后续单据或计算，是否追溯历史数据取决于具体模块。', [], '管理员'),
  card('settings','ai','AI模型配置',['AI配置','AI模型','模型设置','智能助手配置'],
    '管理员可配置系统允许使用的AI模型与相关参数，供智能助手等功能调用。模型配置只决定调用能力，回答质量还依赖知识内容、权限范围和业务数据。敏感凭据不应在普通页面或对话中公开。', [], '管理员'),
  ...PRODUCT_KNOWLEDGE_DETAIL_DEFINITIONS.map((definition) => card(...definition)),
];

export const PRODUCT_KNOWLEDGE_VERSION = createHash('sha256')
  .update(JSON.stringify(PRODUCT_KNOWLEDGE))
  .digest('hex')
  .slice(0, 16);

const STOP_WORDS = new Set(['怎么','如何','什么','是否','可以','能不能','为什么','请问','一下','系统','功能','里面','这个','那个','使用']);

function normalize(text = '') {
  return String(text).toLowerCase().replace(/[\s，。！？、；：,.!?;:()（）【】\[\]"'“”‘’_-]/g, '');
}

function terms(text = '') {
  const raw = String(text).toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || [];
  const result = new Set();
  for (const token of raw) {
    if (!STOP_WORDS.has(token)) result.add(token);
    if (/^[\u4e00-\u9fff]+$/.test(token)) {
      for (let n = 2; n <= Math.min(4, token.length); n += 1) {
        for (let i = 0; i <= token.length - n; i += 1) result.add(token.slice(i, i + n));
      }
    }
  }
  return result;
}

export function scoreProductCard(query, item) {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(item.title);
  const aliases = item.keywords.map(normalize).filter(Boolean);
  let score = 0;
  if (q === title || aliases.includes(q)) score += 100;
  if (q.includes(title) || title.includes(q)) score += 28;
  for (const alias of aliases) {
    if (q.includes(alias)) score += Math.min(24, 8 + alias.length * 2);
    else if (alias.includes(q) && q.length >= 2) score += 8;
  }
  const qTerms = terms(query);
  const haystack = terms([item.title, ...item.keywords, item.answer].join(' '));
  for (const term of qTerms) if (haystack.has(term)) score += term.length >= 4 ? 3 : 1;
  return score;
}

export function searchProductKnowledge(query, { limit = 3, minScore = 10 } = {}) {
  return PRODUCT_KNOWLEDGE
    .map((item) => ({ ...item, score: scoreProductCard(query, item) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

const PRODUCT_SIGNAL_RE = /系统|平台|功能|模块|页面|菜单|后台|权限|账号|登录|档案|员工|考勤|打卡|日报|审批|请款|知识库|培训|考试|晋升|数据中心|agent|增长看板|客户分层|经营诊断|营销策略|积分|奖惩|厨房|备料|配方|报表|预测|绩效|设置|飞书|pos/i;

const PRODUCT_INTENT_RULES = [
  { test: /(?:系统|产品|平台)?.{0,6}(?:最大|核心|主要).{0,4}卖点|为什么.{0,6}(?:选择|买|用).{0,4}(?:你们|这个系统)|(?:产品|系统).{0,4}(?:优势|价值)|和普通.{0,8}(?:软件|系统).{0,4}(?:区别|不同)/i, id: 'account.selling-points' },
  { test: /培训.{0,8}(?:资料|文件|内容|SOP).{0,8}(?:整理|归类|组织|维护)|(?:资料|文件|SOP).{0,8}(?:整理|归类|组织).{0,8}培训/i, id: 'training.materials' },
  { test: /(?:微盟|威盟|有赞|友赞|美团客户云).{0,20}(?:区别|差别|不同|对比|比较)|(?:跟|和).{0,28}(?:微盟|威盟|有赞|友赞|美团客户云)/i, id: 'account.competitive-positioning' },
  { test: /(?:基础|连锁|集团|企业|公司|门店多).{0,8}(?:方案|版本)?.{0,6}(?:区别|差别|不同)|(?:方案|版本).{0,8}(?:怎么选|区别|差别)/i, id: 'account.packages' },
  { test: /(?:合作|签约|演示|demo|试跑).{0,8}(?:流程|怎么安排|怎么申请|怎么合作)/i, id: 'account.cooperation-process' },
];

function matchProductIntent(text = '') {
  const rule = PRODUCT_INTENT_RULES.find((item) => item.test.test(String(text)));
  if (!rule) return null;
  const item = PRODUCT_KNOWLEDGE.find((candidate) => candidate.id === rule.id);
  return item ? { ...item, score: 120 } : null;
}

export function classifyProductQuery(text = '') {
  const intentMatch = matchProductIntent(text);
  const lexicalMatches = searchProductKnowledge(text, { limit: 3, minScore: 10 });
  const matches = intentMatch
    ? [intentMatch, ...lexicalMatches.filter((item) => item.id !== intentMatch.id)].slice(0, 3)
    : lexicalMatches;
  const best = matches[0];
  const explicit = PRODUCT_SIGNAL_RE.test(String(text));
  // `explicit` 只说明这句话里出现了"系统/平台/功能/员工"这类词，说明话题可能跟产品有关，
  // 不代表我们真的有对应的知识卡。以前它单独就能把本轮判成产品问答，于是任何含这些词、
  // 又没命中知识卡的话都会被回一句"没找到系统说明"把对话堵死——"我对你们系统蛮感兴趣的"
  // (购买意向)、"外卖平台抽成太高怎么办"(经营诊断)都是这么被堵死的。
  // 现在 explicit 只负责放宽命中门槛，不能单独成立：没有任何知识卡命中时一律交回正常
  // 销售/诊断流程，由 LLM 带着公开知识和既有质量校验去回应。
  const hasKnowledge = Boolean(intentMatch || (best && (explicit || best.score >= 32)));
  return {
    isProductQuery: hasKnowledge,
    productTopic: explicit,
    confidence: best ? Math.min(1, best.score / 50) : 0,
    matches,
  };
}

const QUESTION_SHAPE_RE = /[？?]|吗|呢|怎么|咋|如何|能不能|可不可以|有没有|是否|哪里|在哪|什么|哪些|多少/;
// 必须明确指向"我们这套系统"才算产品功能提问。"外卖平台抽成太高"里的"平台"是第三方，
// "我对你们系统蛮感兴趣"没有提问结构，两者都不该走"查不到就不回答"那条路。
const OUR_SYSTEM_RE = /(?:你们|贵司|这个|该|咱们)[^。，,！!？?]{0,4}(?:系统|平台|产品|软件)|系统里|系统中|系统内|后台|页面|按钮|菜单|模块/;

/**
 * 客户是不是在问"你们系统的某个具体功能怎么用/有没有"。
 * 只有这种情况，在没有任何知识卡命中时才允许如实说"查不到"——这是防编造的底线；
 * 其余情况(购买意向、经营痛点、闲聊)一律交回正常销售流程，不能用一句"没找到说明"堵死。
 */
export function isOurSystemFeatureQuestion(text = '') {
  const value = String(text || '');
  return QUESTION_SHAPE_RE.test(value) && OUR_SYSTEM_RE.test(value);
}

export function formatProductAnswer(matches = [], userText = '') {
  if (!matches.length) return '';
  const primary = matches[0];
  if (/卖点|优势|价值|为什么选择/.test(String(userText)) || primary.id === 'account.selling-points') {
    return '如果只讲一个最大的卖点，就是这套系统不只告诉您“哪里有问题”，还会继续追到“谁去处理、有没有证据、结果是否改善”。比如营业额或复购出现异常后，可以继续形成门店任务、跟踪执行并复盘结果；客户运营、门店执行和员工培养也在同一套流程里。老板不用每天逐店追问，而是直接看问题有没有真正闭环。';
  }
  if (primary.id === 'account.competitive-positioning') return primary.answer;
  if (primary.id === 'training.materials') {
    return '培训资料整理，关键不是把文件全堆进去，而是让员工找得到、学得完、还能验证。可以先按品牌、岗位和主题建立资料分组，上传SOP、图片或视频并设置适用对象；再把资料关联到培训知识点，配置测验、实操和认证，最后按员工、岗位或门店安排学习。这样资料来源、培训进度和认证结果都能继续追踪。';
  }
  if (/介绍|讲讲|了解|好处|能解决什么/.test(String(userText))) {
    return formatProductSpeechAnswer(matches, userText);
  }
  const lines = [primary.answer];
  if (primary.steps?.length) lines.push(`操作路径：${primary.steps.map((step, i) => `${i + 1}.${step}`).join('；')}`);
  if (primary.roles) lines.push(`权限说明：${primary.roles}。`);
  if (primary.limits) lines.push(`注意：${primary.limits}`);
  return lines.join('\n');
}

const PRODUCT_SPEECH_OVERRIDES = {
  'account.overview': '可以。简单说，这套系统是把门店里原来分散的事情串起来：员工和考勤、营业日报、审批请款、培训认证、厨房执行、经营报表，再到客户增长和经营诊断。不同岗位登录后，只会看到自己有权限的部分，所以员工、店长和老板看到的页面会不一样。您想深入了解哪一块，我可以接着给您讲具体怎么用。',
  'attendance.checkin': '可以。考勤打卡这块，员工到店后用手机完成上下班打卡，系统会把时间和门店位置一起记下来。如果手机没开定位，或者人不在门店设置的范围里，系统会提醒无法打卡。实际使用时，先允许手机定位，确认当前门店，再点上班或下班打卡就可以了。',
  'training.topics': '可以。培训认证这块，不是简单放几份资料给员工看，而是把学习、测验、实操和最后的认证串在一起。管理者可以按岗位或门店安排培训，员工学完以后做题、提交实操，审核通过后会形成认证记录。这样培训有没有完成、实际掌握得怎么样，都能继续跟踪。',
  'account.selling-points': '如果只讲一个最大的卖点，就是我们不只告诉您哪里有问题，还会继续追到谁去处理、有没有证据、最后有没有改善。比如营业额或者复购出现异常以后，系统可以继续形成门店任务、跟踪执行，再回头看结果。老板不用每天逐店追问，打开系统就能看到问题到底有没有闭环。',
  'account.competitive-positioning': '有区别，但我不想简单说谁好谁坏。微盟、有赞这些平台在会员、储值和营销触达上已经有成熟能力。我们的重点，是把经营里发现的问题继续变成任务，追到谁处理、证据有没有交、最后有没有改善。如果您已经在用现有平台，不一定要替换，先看数据能不能接，再选一家店跑30天，结果合适再扩大。',
  'training.materials': '培训资料整理，关键不是把文件全堆进去，而是让员工找得到、学得完、还能验证。可以先按品牌、岗位和主题把SOP、图片或视频分好组，再设置哪些门店、哪些岗位能看。接着把资料关联到培训知识点，配上测验、实操或者认证，最后再安排给员工学习。这样资料和培训结果就不会散掉。',
};

function naturalizeProductSentence(text = '') {
  return String(text)
    .replace(/“|”/g, '')
    .replace(/；/g, '，')
    .replace(/。\s*/g, '。')
    .trim();
}

/**
 * 语音专用讲解稿：事实与文字答案一致，但不朗读“操作路径/权限说明/编号”等页面文案。
 */
export function formatProductSpeechAnswer(matches = [], userText = '') {
  if (!matches.length) return '这个功能我还没有核对到准确说明，所以先不凭印象讲。您把页面名称或者按钮发给我，我核实清楚后再给您说明。';
  const primary = matches[0];
  if (PRODUCT_SPEECH_OVERRIDES[primary.id]) return PRODUCT_SPEECH_OVERRIDES[primary.id];

  const wantsHow = /怎么|如何|操作|步骤|流程|在哪里|在哪儿/.test(String(userText));
  const intro = /介绍|讲讲|了解|仔细|具体/.test(String(userText))
    ? `可以。${primary.title}这块，简单说，`
    : `可以。关于${primary.title}，`;
  const parts = [`${intro}${naturalizeProductSentence(primary.answer)}`];
  if (wantsHow && primary.steps?.length) {
    const steps = primary.steps.map((step) => naturalizeProductSentence(step).replace(/[。]$/, ''));
    if (steps.length === 1) parts.push(`实际操作时，${steps[0]}就可以了。`);
    else if (steps.length === 2) parts.push(`实际操作时，先${steps[0]}，然后${steps[1]}。`);
    else parts.push(`实际操作时，先${steps[0]}，${steps.slice(1, -1).map((step) => `然后${step}`).join('，')}，最后${steps.at(-1)}。`);
  }
  if (primary.roles && primary.roles !== '以账号实际可见权限为准') {
    parts.push(`不过这部分一般需要${primary.roles}的权限。`);
  }
  return parts.join('');
}

export async function logProductQuestion(pool, { query, match = null, source = 'customer_ai' } = {}) {
  if (!pool?.query || !String(query || '').trim()) return;
  await pool.query(
    `INSERT INTO sales_product_question_logs
       (question, matched_card_id, match_score, answered, source)
     VALUES ($1,$2,$3,$4,$5)`,
    [String(query).slice(0, 1000), match?.id || null, Number(match?.score || 0), Boolean(match), source]
  ).catch((error) => console.warn('[sales-product-knowledge] question log failed:', error?.message || error));
}

export function buildProductBenchmark() {
  const templates = [
    (k) => `${k}怎么用？`, (k) => `系统里的${k}在哪里？`, (k) => `${k}具体是什么功能？`,
    (k) => `能介绍一下${k}吗？`, (k) => `我想操作${k}应该怎么办？`, (k) => `${k}有什么权限要求？`,
    (k) => `客户问${k}，应该怎么回答？`,
  ];
  return PRODUCT_KNOWLEDGE.flatMap((item) => item.keywords.slice(0, 3).flatMap((keyword, index) =>
    templates.slice(index, index + 3).map((make) => ({ question: make(keyword), expected: item.id }))
  ));
}

export function buildCustomerLanguageBenchmark() {
  const patterns = [
    (keyword) => `我对${keyword}不太懂，你用简单的话给我讲讲`,
    (keyword) => `我们门店正卡在${keyword}这块，系统具体能怎么帮？`,
    (keyword) => `如果真正在店里用${keyword}，一般要怎么操作？`,
    (keyword) => `${keyword}对老板和店长到底有什么用？`,
  ];
  const generated = PRODUCT_KNOWLEDGE.flatMap((item) => patterns.map((make) => ({
    question: make(item.keywords[0] || item.title),
    expected: item.id,
  })));
  const hardCases = [
    ['那你给我介绍一下你们系统最大的卖点是什么？', 'account.selling-points'],
    ['你们这套东西和普通门店管理软件最大的区别在哪里？', 'account.selling-points'],
    ['老板为什么要用你们这个系统？', 'account.selling-points'],
    ['我的问题是培训的资料怎么整理？', 'training.materials'],
    ['一堆SOP、图片和视频，怎么整理成培训内容？', 'training.materials'],
    ['不同岗位的培训文件怎么分开给员工看？', 'training.materials'],
    ['你能给我介绍一下你的这个系统的功能？', 'account.overview'],
    ['日报填错以后还能不能重新改？', 'daily.edit'],
    ['同事有这个菜单，为什么我的账号没有？', 'account.permissions'],
    ['员工培训完成以后怎么证明他真的会了？', 'training.practice'],
    ['活动发出去以后怎么看有没有客户回来？', 'growth.attribution'],
    ['系统说经营异常，我去哪里看判断依据？', 'diagnosis.anomaly'],
  ].map(([question, expected]) => ({ question, expected }));
  return [...generated, ...hardCases];
}
