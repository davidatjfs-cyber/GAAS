# 餐饮客户数字孪生（Customer Digital Twin）落地方案

> 版本：v3（2026-08-02）｜状态：待评估
> v3 变更：
> 1. 核实并接入：培训场景生成器并入现有「AI岗位教练」（job-coach.html）模块，不单独建前端；
> 2. 核实并确认：差评/桌访/菜品库完整数据均在 DB（含 468 行菜品库、43,493 笔 POS 订单、314,216 行点单明细）；
> 3. 新增 POS 订单/明细数据层（每桌人数、用餐时长、真实点单、真实支付价）；
> 4. 心智 Schema v1 升级为决策引擎（16 层 + 决策权重 + 组合约束 + 隐性心理 v2）；
> 5. 黄金基准集升级为四层 Ground Truth（L1 行为 / L2 心理 / L3 语言 / L4 判卷）；
> 6. 吐槽语料升级为「餐饮顾客真实负反馈知识库」四层体系；
> 7. 惊喜/扣分/恢复升级为「动作有效性矩阵」核心知识表。

---

## 一、定位与结论

**不是"通用餐饮客户模拟器"，而是"你门店真实客群的数字孪生"**：人格分布来自真实食客画像，反馈语料来自真实桌访/差评，菜单推理基于真实菜品库与销量，行为校准基于真实 POS 点单。

结论：

1. **值得做**，但前提是作为 GAAS 核心产品能力投资（菜单设计、营销预演、服务培训、门店诊断的公共底座）。
2. **可达到"行业第一梯队可用"质量**，达不到"通用模拟器"——模拟擅长排序、找风险、规模化预演、培训，不替代真实市场测试做高风险决策。
3. **真正的瓶颈不是 LLM，而是数据校准与验证闭环**：动机与犹豫层的标注规模、黄金基准集、真实结果回流。

## 二、可行性评估与质量分级

| 档位 | 做法 | 质量 | 用途 |
|---|---|---|---|
| L1 Demo 级 | 维度组合 + LLM 提示词生成 | 60-70 分 | 演示、概念验证 |
| L2 可用级 | L1 + 真实数据校准 + 决策引擎 + 知识/菜单/POS 接入 | 75-85 分 | 菜品调研、服务流程测试辅助 |
| L3 行业高质量 | L2 + 四层黄金基准集 + 盲测 + 真实反馈回流校准 | 85-95 分 | 菜单设计、营销测试、销售培训的决策依据 |

**"几百万种客户"是营销话术不是工程目标**：先让 50 种可信，再谈几百万种。

## 三、数据底座盘点（已核实 v2）

> 核实方法：飞书 API 直查 + 生产 Postgres 比对（2026-08-02）。差评/桌访/菜品库完整数据均在 DB；POS 订单与明细齐全。

| 数据 | 落点（Postgres） | 规模 | 关键字段 |
|---|---|---|---|
| 差评报告 | `feishu_generic_records`（原始）+ `agent_messages`(negative_review) | 124 / 115 条 | 差评原因、差评产品、差评关键词、差评平台、差评门店、星级、附件 |
| 桌访表 | `table_visit_records` | 10,016 条 | 用餐是否满意、吃饭的原因、满意/不满意的菜、什么情况下您愿意再来、投诉/处理、复购、人数、金额 |
| 菜品库 | `dish_library_costs`（周度同步自飞书菜品库） | **468 行** | 店、菜名、价格、成本、渠道；`recipes` 为 0 行（非数据源），`ingredient_library` 18 行 |
| 食客画像 | `growth_customers` / `growth_customer_profiles` | 17,673 条 | 价格敏感度、尝鲜意愿、健康意识、辣度、场景倾向、客均人数、生命周期 |
| POS 订单 | `pos_orders` | **43,493 笔**（41,193 有 diners、40,912 有 duration） | order_no、order_time/checkout_time、桌号、**人数**、**用餐时长**、堂食/外卖、金额/折扣、会员/手机、customer_id |
| POS 明细 | `pos_order_items` | **314,216 行** | dish_name、sku、unit_price、qty、折扣、category、桌号、sale_type、order_time/checkout_time |
| 门店日报 | `daily_reports` | 307 条 | 营业额、毛利、时段 |

> 桌访同步数量差异（10,016 vs 飞书 11,862）经业务确认无需处理，不列为工作项。

## 四、调研四层结构 → 数据映射

参考《AI 市场调研的边界与数字人应用》（2026-08-02 语音笔记）：

| 调研要求的层 | GAAS 数据源 | 状态 |
|---|---|---|
| ① 消费与渠道数据 | `growth_customer_profiles` + `growth_customers` + `pos_orders`（渠道/堂食外卖/客单） | ✅ |
| ② 行为记录 | `pos_orders` + `pos_order_items`（真实点单）+ `table_visit_records`（真实反馈） | ✅ 最强 |
| ③ 动机与犹豫 | 桌访"满意/不满意原因、愿意再来条件" + 差评"差评原因/关键词" | ✅ 已有，标注规模需靠黄金基准集扩充 |
| ④ 具体情境 | `dish_library_costs`（菜单/价格/成本）+ `daily_reports`（门店/时段） | ✅ |

## 五、心智 Schema v1：决策引擎（不是画像）

评审原则：Schema 必须能解释 95% 真实餐厅客人的行为，因此按"决策引擎"设计——**身份只做背景约束，不做刻板推断**（不能因为 60 岁就"一定不会扫码"），行为由「意图 × 目标 × 权重 × 约束 × 隐性心理」驱动。

### 5.1 十六层结构

| 层 | 内容 | 数据源 | 来源类型 |
|---|---|---|---|
| L1 身份 Identity | 年龄/性别/城市等级/收入 | 现有数据无人口属性 → 专家先验 + 未来数据 | E |
| L2 消费目的 Visit Intent | 家庭/情侣/商务/朋友/生日/纪念日/工作餐/旅游/首访/复访/推荐/点评/网红/会员活动 | 桌访"今天吃饭的原因" + profiles 场景分 + order_type | D |
| L3 消费目标 Dining Goal | 味道/聊天/庆祝/面子/拍照/体验/便宜/健康/快捷/安静 | 桌访原因近义映射 + 专家 | D+E |
| L4 价格心理 Price Mind | budget_limit/value_expectation/promotion_attention/upsell_acceptance/coupon_dependence | price_sensitivity、response_to_discount、POS 折扣行为；upsell/coupon 无直接数据 → E | D+E |
| L5 服务期待 Service Expectation | speed/enthusiasm/professional/initiative/privacy/accuracy/problem_solving | 桌访 service_rating + 差评服务类关键词 | D+E |
| L6 菜品要求 Food | taste/freshness/temperature/presentation/portion/stability/health | 桌访 food_rating + 差评菜品问题；潮汕鲜度/烧鹅脆皮等权重 → 专家 | D+E |
| L7 环境要求 Environment | noise/clean/lighting/air/temperature/decoration/table_space | 桌访 environment_rating + 差评环境类 | D+E |
| L8 等待容忍 Tolerance | wait_order/wait_food/queue/mistake/noise（量化：5/10/15/20/30 分钟） | POS duration + 桌访等待吐槽 | D+E |
| L9 错误容忍 Mistake Tolerance | wrong_dish/missing/late/cold/attitude/bill_error | 差评 + 桌访投诉类型 | D+E |
| L10 恢复接受度 Recovery | apology/discount/free_dessert/manager/rework/coupon | 桌访 complaint_resolution + 差评处理描述 | D+E |
| L11 表达方式 Expression | direct/polite/silent/sarcastic/emotional/rational | 桌访/差评文本风格 | D+E |
| L12 投诉倾向 Complaint | face_to_face/online/private/never/manager_only | 差评平台（大众点评）+ 现场桌访 vs 线上 | D |
| L13 情绪恢复 Emotion | anger_threshold/recovery_speed/memory_length | 无直接数据 → 黄金基准集校准 | E |
| L14 忠诚度 Loyalty | brand/dish/staff/location/price | 复购次数、会员、POS 历史 | D |
| L15 社交影响 Social | share/review/recommend/influence_level | 无直接数据 → 黄金基准集校准 | E |
| L16 决策方式 Decision Style | logic/emotion/recommendation/habit/social_proof | 差评提及点评/朋友推荐等信号 | D+E |

> D = 可数据校准；E = 专家先验（先用假设值，进黄金基准集与回流校准）；D+E = 混合。

### 5.2 决策权重（Decision Weight）

不是"价格敏感：高/低"，而是数值权重：

```
decision_weight:
  price: 0.35  taste: 0.30  service: 0.15
  environment: 0.10  efficiency: 0.05  emotion: 0.05
```

权重是**参数**：v1 取专家值，Phase 4 用真实数据（桌访满意度 × 真实点单 × 差评归因）拟合更新。

### 5.3 组合约束（Constraint，规则修正器）

约束决定"同样一个动作对不同客群的效果差异"，作为确定性规则写入引擎：

```
constraints:
- 商务宴请:  price_weight -= 0.2  service_weight += 0.2  face_sensitivity += 0.5
- 情侣约会:  environment_weight += 0.3  noise_tolerance -= 0.3
- 家庭聚餐:  waiting_tolerance -= 0.2  child_service += 0.4
- 老顾客:    mistake_tolerance += 0.1  expectation += 0.2
- 首次到店:  surprise_weight += 0.3  comparison_with_reviews += 0.4
```

### 5.4 隐性心理（Hidden Psychology，Schema v2 潜变量）

隐性变量比年龄/收入更能预测真实行为，是引擎与普通画像的最大区别：

| 隐性变量 | 说明 | 初值来源 |
|---|---|---|
| 面子需求 Face Sensitivity | 在意同伴评价与场合形象 | E（商务/请客极高） |
| 公平感 Fairness Sensitivity | "别人有我没有"易不满（隔壁桌先上菜/别人有赠品） | E |
| 被重视感 Recognition Need | 希望被记住、被称呼 | E（老会员/常客高） |
| 控制感 Control Need | 希望掌控点菜节奏，讨厌强推销 | E |
| 信任建立速度 Trust Building | 多快接受服务员推荐 | E（配合 L16） |
| 新鲜感需求 Novelty Seeking | 是否愿意尝新（新品推荐成功率） | D（adventurous_score）+E |
| 风险规避 Risk Aversion | 倾向点熟悉菜品 | D（价格敏感/尝鲜分）+E |
| 情绪传染 Emotional Contagion | 受同行者情绪影响，一人不满全桌降分 | E（按同行结构修正） |

隐性心理不可直接观测 → v1 用专家先验 + 行为代理（会员、复购、点单规律），黄金基准集与真实反馈持续校准。

## 六、黄金基准集：四层 Ground Truth（判卷标准）

黄金基准集不是"50 个对话案例"，而是**AI 判卷标准**：换 Claude/GPT/Qwen/Gemini 任何模型，只要孪生回答偏离基准即可判定质量下降——模型无关的回归测试。

### 6.1 四层标注结构（50 组起步，每组 4 层）

| 层级 | 内容 | 用途 |
|---|---|---|
| L1 行为层 Behavior | 点菜、等待、催菜、结账、评价等客观行为 | 训练行为一致性 |
| L2 心理层 Psychology | 每一步情绪、满意度、信任、期待值变化（连续，禁止跳变） | 训练内部状态 |
| L3 语言层 Language | 每个阶段最符合真人的表达和措辞 | 训练说人话 |
| L4 判卷层 Evaluation | 为什么合理、哪些回答算合格/失真 | 自动评估质量 |

### 6.2 每组 Case 的固定结构

```
case_id / title / difficulty / purpose
├─ 客户人格：visit/intent/price/service/environment/food/expression/complaint/recovery
├─ 消费背景：时间、人数、首访/复访、种草渠道、预算、目的
├─ 消费目标：聊天/拍照/体验/安静等
├─ 事件时间轴 Timeline：进店→落座→点菜→上菜→催菜→处理→买单
├─ 每一步心理变化：情绪连续曲线（85→74→61…，不允许跳变）
├─ 标准反馈：分阶段话术（第一次委婉 → 第二次质疑 → 第三次取消 → 沉默）
├─ 标准吐槽：真实表达（"隔壁桌比我们晚来都上齐了"），不是"菜慢"
├─ 不能说的话 negative：禁止戏剧化（报警/曝光/辱骂/突然离店）
├─ 点菜行为：浏览→问招牌→问分量→犹豫→接受/拒绝推荐（含推荐接受率）
├─ 补偿恢复：每次动作的恢复值（解释+5 / 经理+12 / 甜品+8），最终不回到 100
├─ 最终满意：拆分明细（菜/服务/环境/等待/补偿 → 总分）
├─ 最终行为：是否投诉/点评/星级/复购/推荐
└─ 专家解释：为什么是这个结果
```

### 6.3 使用方式

- 训练回归：每次引擎版本更新、每次换模型，全量跑基准集，偏离即拦截；
- 盲测：专家无法区分孪生反馈与真实桌访/差评（L2 门槛）；
- 扩展：50 → 100 → 200 组，按门店/品牌/时段/客群覆盖；
- 落表：`customer_twin_golden_cases`（jsonb 存四层结构，含版本）。

## 七、餐饮顾客真实负反馈知识库（Restaurant Negative Feedback Corpus）

不是"吐槽语料库"，而是**每条语料绑定触发条件 + 客户人格 + 当前情绪 + 后续行为**的标注知识库——AI 按状态自然生成反馈，而不是随机抽一句吐槽。

### 7.1 语料条目结构

```
id / category / sub_category / scene / customer_type
emotion（当前情绪值）/ stage（催菜/点菜/结账…）/ severity
trigger（客观触发条件，如等待 25 分钟）
expression_style（礼貌/直接/沉默/讽刺）
content（真实说法）
expected_action（期望动作：解释/查询/告知时间）
avoid_action（禁止动作：敷衍/不知道/再等等）
```

### 7.2 四层语料体系

| 层级 | 内容 | 示例 |
|---|---|---|
| L1 事件 Event | 客观发生了什么 | 上菜 25 分钟、上错菜、餐具不干净 |
| L2 心理 Mind | 顾客此时在想什么 | "是不是忘记我们了？""这家店管理有问题？" |
| L3 语言 Utterance | 不同表达风格 | 礼貌："不好意思，我们那个菜还没好吗？"；直接："是不是漏单了？"；沉默：买单走人 |
| L4 后续行为 Outcome | 最终会做什么 | 催菜、取消、找经理、发点评、不再来 |

### 7.3 分类体系（12 类，首批语料已由业务专家提供）

等位 / 没人接待 / 点菜体验 / 上菜慢（最高频）/ 上错菜 / 漏菜 / 菜品问题 / 分量 / 服务态度 / 环境 / 结账 / 离店后反馈。首批 60+ 条专家语料入库，持续从真实桌访/差评扩充。

## 八、动作有效性矩阵（惊喜/扣分/恢复——核心知识表）

数字孪生最终要验证"门店一个动作让顾客加分还是扣分"，因此不能写"送甜品 +10"，而必须写：**什么顾客 + 什么场景 + 什么动作 → 满意度变化 + 复购/点评变化**。

### 8.1 三类知识表

```
customer_twin_surprises（惊喜项）
  id/type/category/action/scene/customer/satisfaction/repurchase/review/cost/difficulty/reason
customer_twin_deductions（扣分项，随时间/次数递增）
  等位 1分钟-5 / 3分钟-12 / 5分钟-20；上菜慢 15分钟-5 / 25分钟-12 / 35分钟-25 …
customer_twin_recoveries（恢复动作）
  问题/恢复动作/满意度恢复/是否恢复复购（恢复分不得超过原始损失）
```

### 8.2 动作有效性矩阵（核心知识表）

| 顾客类型 | 主动推荐 | 送甜品 | 店长致歉 | 记住姓名 | 主动帮分菜 |
|---|---|---|---|---|---|
| 首次到店 | 高 | 中 | 高 | 中 | 中 |
| 老会员 | 低 | 中 | 高 | 极高 | 中 |
| 商务宴请 | 低 | 低 | 极高 | 高 | 极高 |
| 情侣约会 | 中 | 高 | 中 | 中 | 低 |
| 家庭聚餐 | 中 | 高 | 中 | 中 | 高 |
| 带儿童 | 低 | 中 | 中 | 低 | 高 |

矩阵直接驱动引擎判断：同一动作对 A 客户有效、对 B 客户无效；为什么有些补救有效、有些没用。**初值 = 专家判断，Phase 4 用真实数据拟合。**

### 8.3 铁律

**恢复分不能超过原始损失**：上错菜扣 20，即使道歉+甜品+免单，最终只能"接近恢复"，一般不会比没出问题时更满意。

## 九、总体架构（v3）

```
前端（无新增独立模块，复用现有入口）
  ├─ 菜品/套餐测试工作台（新页面 frontend/src/pages/customer-twin/）
  ├─ 客群问答面板（模板版，同页面组）
  ├─ 营销活动预演（同页面组）
  └─ 培训场景生成器 → 并入现有「AI岗位教练」（job-coach.html，不新建模块）
API 层 server/domains/customer-twin/{routes.js(≤30行), service.js}
  ├─ POST /api/customer-twin/experiments/run   ├─ GET /api/customer-twin/experiments/:id
  ├─ POST /api/customer-twin/ask               └─ GET /api/customer-twin/segments
  └─ 培训卡片生成：写 job_coach_incident_cards（复用 /api/sales-sim/incidents/draw 消费）
引擎层 customer-twin/{generator, decider, expresser, calibrator}.js
  ├─ generator：Schema v1（16 层 + 隐性心理）真实分布采样，seed 确定，保留长尾
  ├─ decider：决策树 12 步 + 决策权重 + 组合约束 + 容忍/恢复量化计算（确定性，零 LLM）
  ├─ expresser：表达层（情绪风格 + 负反馈知识库 + 动作矩阵），仅此处调 LLM
  └─ calibrator：黄金基准集回归 + 真实反馈回流拟合权重
心智库（新表，全部走编号 migration）
  ├─ customer_twin_dimensions / customer_twin_personas / customer_twin_runs
  ├─ customer_twin_golden_cases（四层 Ground Truth）
  ├─ customer_twin_negative_feedback（负反馈知识库）
  ├─ customer_twin_surprises / deductions / recoveries / action_effect_matrix
  └─ 复用 knowledge_base + RAG
真实数据源（全部已核实）
  ├─ growth_customer_profiles（17,673）→ 分布
  ├─ table_visit_records（10,016）+ 差评（124/115）→ 反馈语料与校准
  ├─ pos_orders（43,493）+ pos_order_items（314,216）→ 行为层（人数/时长/点单/真实支付价）
  └─ dish_library_costs（468）→ 菜单/价格/成本
```

### 成本模型边界（500 跑批 ≠ 500 次 LLM）

- decider（点不点、满意度、复购率）是**确定性数值计算**：人格 × 权重 × 约束 × 容忍量化，500 人格跑批纯计算完成；
- LLM 只用于 expresser（吐槽 Top5、解释文本、问答回复），单次跑批 LLM 调用 ≤ 10 次；
- generator/decider 禁调 LLM，expresser 才调。

### POS 数据接入的价值（回答：要不要接——要，且是行为层的地基）

1. **人数与时长分布**：41,193 笔有 diners、40,912 笔有 duration → 校准"每桌几人、吃多久"的真实分布（等待容忍、上菜节奏基准）；
2. **真实点单行为**：314,216 行菜品明细 → 点菜顺序/搭配/招牌菜/犹豫对象（黄金基准集"点菜行为"的真实统计来源）；
3. **真实支付价**：unit_price + 折扣 → "价格-接受度"不再纯外推，可从真实购买行为观察（**升级 ① 工作台**）；
4. **满意度 × 点单关联**：桌访（日期/门店/桌号/人数）≈ POS 订单 → 建立"满意度 × 真实点了什么"训练对，直接校准 L6 菜品要求权重与扣分项；
5. **会员/复购行为**：phone/customer_id → 链接 growth_customer_profiles，形成个体行为记录（忠诚度 L14、复购规则的真实来源）。

## 十、数字客户应用问题与规避设计（8 条，保持不变）

| # | 已知问题 | 规避设计 |
|---|---|---|
| 1 | 平均化陷阱 | 结论禁止只给平均分：按客群分组 + 分位数；保留长尾采样；KL 分布距离测试 |
| 2 | 无生活约束 | 人格状态携带预算/忌口/身体限制/沉没成本；决策树硬检查 |
| 3 | 表态≠行为 | 区分 stated preference 与 choice under constraint；测试题给预算+菜单实景选择 |
| 4 | 只会迎合 | 吐槽强制模式；anti-sycophancy 测试（诱导性提问两次，立场漂移即失败） |
| 5 | 幻觉 | 事实闸门：价格/菜品只来自 dish_library_costs/pos；无数据维度显式标"假设" |
| 6 | 脱离情境失真 | 情境强制注入：缺菜单/价格/门店/时段参数拒绝生成 |
| 7 | 不可复现 | seed 确定性 + Schema/prompt 版本化 + runs 全量留档 |
| 8 | 高估置信度 | 输出定位"筛选与风险预判"；前端标注"模拟结果，需真实验证"；输出"建议真人验证的问题清单" |

## 十一、三角模型 → GAAS 产品定位

| 三角 | GAAS 对应 | 职责边界 |
|---|---|---|
| AI（广度） | 现有营销/菜品/门店诊断 Agent | 谁可能感兴趣、哪种内容更可能被接受 |
| 数字人（精度） | customer-twin 引擎 | 这类人在这个价格/菜单/门店下会怎么权衡 |
| 营销科学（因果） | 现有 growth-ab 实验域 | 真实转化率、增量验证 |

**产品承诺边界**：twin 能答"这类客群在这个价格下怎么权衡、哪些人会吐槽、复购条件是什么"，**不能答"实际转化率"**。

## 十二、分阶段开发计划

### Phase 0 — 数据底座（1-2 周）

- 确认并固化数据源：差评（feishu_generic_records/agent_messages）、桌访（table_visit_records）、菜品库（dish_library_costs）、POS（pos_orders/pos_order_items）、食客画像；
- 数据字典按四层结构组织（消费渠道/行为/动机犹豫/情境），标注每个心智层的 D/E 来源；
- 差评规范化到 GAAS 自有表（不再依赖 agent_messages jsonb）；
- 桌访 × POS 关联可行性验证（门店/日期/桌号/人数近似匹配）。
- **验收**：数据资产清单 + 覆盖率报告 + 关联命中率报告。

### Phase 1 — 心智 Schema v1 + 知识内容（2 周）

- 十六层 Schema + decision_weight + constraints + 隐性心理 v2 落表（专家值 = v1 参数）；
- 负反馈知识库首批入库（12 类，60+ 条专家语料 + 真实桌访/差评提取）；
- 惊喜/扣分/恢复/动作有效性矩阵首批入库（恢复不超原始损失铁律）；
- 黄金基准集 L1 首批 50 组（行为层 + 事件时间轴）；
- 满意度/复购规则初值：桌访"满意→复购"真实交叉统计。
- **验收**：Schema 校验 + 50 组合法/非法用例 + 基准集 50 组入库。

### Phase 2 — Twin 引擎（3-4 周）

- generator（真实分布采样 + 长尾保留 + 隐性心理初始化）；
- decider（决策树 12 步 + 权重 + 约束 + 容忍/恢复量化，纯计算）；
- expresser（情绪风格 + 负反馈知识库 + 事实闸门，唯一 LLM 入口）；
- 测试：确定性、决策分支、事实闸门、anti-sycophancy、情境缺失拒绝、KL 分布、**黄金基准集回归**；
- **验收**：10 人格 × 5 场景专家盲测 ≥ 80%；基准集回归零偏离。

### Phase 3A — ① 菜品测试工作台 + ④ 培训生成器（并入岗位教练，1-2 周）

- ① 工作台：跑批（决策层纯计算）→ 分组点单率、价格-接受度（真实支付价校准 + 模型推断标注）、吐槽 Top5、满意度/复购/推荐率、风险客群；A/B 留档对比；
- ④ 培训生成器：真实桌访/差评 → 生成 incident 卡写入 `job_coach_incident_cards`（meta.source='customer_twin' + 原文引用 id），**由现有 AI岗位教练（job-coach.html）自动消费，不新建前端模块**；建议加"审核发布"开关（active=false 待审）；
- **验收**：① 全流程浏览器实测；④ 生成卡片可在岗位教练中抽取并进入对话，可点开真实原文。

### Phase 3B — ③ 客群问答面板（模板版，1-2 周）

- 10-15 类高频老板问题模板，固定数据路由 + 事实闸门；引用可点开原文；自由 NLQ 后置。

### Phase 3C — ② 营销活动预演（定性版，1 周）

- 只输出定性（哪类客群更可能响应、口碑风险、设计建议）；**不输出"预期拉动 X%"**；定量待 growth-ab 真实活动数据。

### Phase 4 — 验证闭环与校准（持续）

- 黄金基准集 50 → 100 → 200 组扩展（行为/心理/语言/判卷四层）；
- 对比实验：孪生预测 vs 真实（吐槽预测 vs 真实差评、点单率排序 vs 真实新品）；
- 决策权重/约束/动作矩阵用真实数据拟合（桌访满意度 × POS 点单 × 差评归因）；
- 与 growth-ab 打通：孪生预判 → A/B 验证 → 回流校准；
- 模型无关回归：换模型跑基准集，偏离即拦截。
- **验收**：预测吻合度有基线、逐月提升。

## 十三、开发完成后的应用效果

| 入口 | 达到的效果 | 效果边界 |
|---|---|---|
| ① 测试工作台 | 新菜/套餐 5 分钟跑批：分组点单率、价格-接受度（数据校准+推断标注）、吐槽 Top5、满意度/复购/推荐、风险客群；A/B 对比 | 排序+风险预判，非销量预测；20 道候选缩到 3-5 道真人验证 |
| ④ 培训生成器 | 并入岗位教练：每天从真实客诉生成新陪练场景，员工练真实问题，复盘可查原文 | 生成场景而非答案，标准答案由专家维护 |
| ③ 模板问答 | 老板问 15 类高频问题，回答带可点开原文依据 + 决策轨迹 | v1 只答模板问题 |
| ② 定性预演 | 活动上线前客群体检 | 无定量 |

总体：老板/运营获得"可对话的客群实验室"；L3 后孪生成为菜单/营销决策的辅助依据（不是替代真人调研）。

## 十四、需要你提供的内容

业务专家：
1. ~~心智 Schema v1 评审~~ **已完成（你已给出十六层 + 权重 + 约束 + 隐性心理 v2）**；
2. 黄金基准集标注：首批 50 组（L1 行为层起步，四层结构模板已定）；
3. 负反馈语料扩充：首批 60+ 条已给，持续补充真实场景（与桌访/差评对照）；
4. 惊喜/扣分/恢复清单与动作有效性矩阵：首批已给，持续校正数值（恢复不超损失）；
5. 菜品知识（潮汕鲜度、烧鹅皮脆等）权重校准。

数据与权限：
6. POS 字段口径确认（diners/duration 的统计口径、桌号与桌访表对应关系）；
7. 飞书差评/桌访/菜品库读权限确认（FEISHU_APP_ID 持续可用）；
8. 历史活动数据（如有）——Phase 4 校准 ②；
9. 菜品库完整性（新品/套餐价格成本是否覆盖）。

决策确认：
10. 隐私口径（聚合分布脱敏可用、禁止生成真实顾客个体）；
11. 首批场景确认（① + ④）；
12. 岗位教练集成方式确认（卡片自动生成 + 审核发布开关）；
13. 专家评审投入安排。

## 十五、如何达到"真正好用准确"（5 个杠杆 + 基准集回归）

1. **确定性内核**：decider 纯计算、expresser 才调 LLM——可复现才能校准；
2. **数据校准优先于模型发明**：权重/约束/动作矩阵初值 = 专家值，Phase 4 用真实数据拟合；输出三色标注（数据统计/模型推断/专家假设）；
3. **四层黄金基准集 = 判卷标准**：模型无关回归，换模型偏离即拦截——这是"准确"可证明的核心机制；
4. **事实闸门 + 情境注入**：缺情境拒绝生成；无数据支撑显式标"假设"；
5. **渐进开放**：模板问答→自由问答、定性营销→定量营销、单一品牌→跨品牌；
6. **盲测 + 对比实验 + 月度回流**：专家分不清孪生与真实反馈（L2 门槛）；预测 vs 真实吻合度有基线、逐月报告。

**定义对齐**：twin 的"准确"= 方向性洞察准确（排序/风险/归因），不是数值预测准确。

## 十六、资源与风险

- 人力：1 后端 + 1 前端 + 业务专家（兼职评审/标注）；
- LLM 费用可控（决策层零 LLM，表达层复用 qwen-max/deepseek 通道）；
- 主要风险：隐性心理与部分容忍层无直接数据（先验起步，靠基准集校准）；桌访 × POS 关联是近似匹配（命中率 Phase 0 验证）；差评 124 条偏小（负反馈库以专家语料 + 桌访补充）。

## 十七、需要拍板的决策点

1. 首批场景确认（① + ④ 并行，④ 并入岗位教练模块）；
2. 是否允许用真实食客画像校准分布（脱敏，只用聚合分布）；
3. 是否同意差评规范化到 GAAS 自有表（不动 agents 侧共享表语义）；
4. 岗位教练卡片"审核发布"开关是否要做；
5. 专家评审与基准集标注投入安排；
6. 是否将本方案列入产品路线图（与现有 batch/phase 边界对齐）。
