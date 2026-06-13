import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';

// 晋升V2：各岗位/级别的晋升能力要求知识点。每条记录会创建一个 training_topics（promotion_required=true）。
// 一票否决项（生食食安规范）在描述中注明，逻辑上由「该级别所有知识点均需通过」的 AND 判定自动实现，无需额外字段。
const TOPICS = [
  // ===== 打荷线 (position: 打荷) =====
  { position: '打荷', level: 'L1', title: '打荷L1：后厨卫生与食安规范', description: '掌握后厨基础卫生标准与食品安全操作规范', key_points: ['个人卫生与着装规范', '食材生熟分区与交叉污染防范', '清洁消毒流程与频次', '食品安全留样与标识规范'], practice_task: '现场演示一次完整的开档卫生检查流程' },
  { position: '打荷', level: 'L1', title: '打荷L1：刀具与设备安全', description: '掌握常用刀具与厨房设备的安全操作与保养', key_points: ['常用刀具/设备的正确使用与防护', '设备清洁与日常保养', '安全事故应急处理'], practice_task: '演示安全使用并清洁一种厨房设备' },
  { position: '打荷', level: 'L1', title: '打荷L1：原料识别', description: '掌握常用食材的辨识与基础知识', key_points: ['常用食材名称、规格与产地辨识', '食材新鲜度判断', '常见食材替代与搭配常识'], practice_task: '现场辨认并说明10种常用食材的规格与用途' },
  { position: '打荷', level: 'L1', title: '打荷L1：传菜动线', description: '熟悉后厨出品交接与传菜动线', key_points: ['后厨各档口与传菜路线布局', '出品交接流程与时效要求', '高峰期动线避让与协调'], practice_task: '演示一次完整的出品交接与传菜动线走位' },
  { position: '打荷', level: 'L1', title: '打荷L1：出品摆盘基础', description: '掌握基础摆盘原则与标准', key_points: ['基础摆盘原则与餐具搭配', '常见菜品摆盘标准', '摆盘卫生与美观检查'], practice_task: '完成3款常见菜品的标准摆盘' },

  { position: '打荷', level: 'L2', title: '打荷L2：备料齐荷标准', description: '掌握各档口备料与齐荷检查标准', key_points: ['各档口备料清单与数量标准', '齐荷检查流程', '备料损耗控制'], practice_task: '独立完成一个档口的开档备料并通过齐荷检查' },
  { position: '打荷', level: 'L2', title: '打荷L2：走菜节奏配合', description: '掌握与炒锅/砧板的走菜节奏配合方法', key_points: ['与炒锅/砧板的节奏配合方法', '出品排序与等位处理', '高峰期协调沟通技巧'], practice_task: '高峰时段独立完成一次走菜节奏配合并无漏单' },
  { position: '打荷', level: 'L2', title: '打荷L2：调味料标准量', description: '掌握常用调味料标准用量与配比', key_points: ['常用调味料标准用量与配比', '调味料存储与有效期管理', '标准量误差控制'], practice_task: '按标准量独立完成5种常用调味料的称量配比' },
  { position: '打荷', level: 'L2', title: '打荷L2：装盘标准', description: '掌握各类菜品的装盘标准与一致性要求', key_points: ['各类菜品装盘规格与标准', '装盘一致性检查', '异常装盘的纠正处理'], practice_task: '独立完成5款菜品的标准装盘并通过质检' },

  { position: '打荷', level: 'L3', title: '打荷L3：多档口协调', description: '具备多档口出品节奏的统筹协调能力', key_points: ['多档口出品节奏统筹方法', '跨档口资源调配', '突发状况下的整体协调'], practice_task: '在高峰期独立统筹2个以上档口的出品协调' },
  { position: '打荷', level: 'L3', title: '打荷L3：出品质检', description: '掌握出品质量检查标准与流程', key_points: ['出品质量检查标准与流程', '常见出品问题识别与处理', '质检记录与反馈'], practice_task: '独立完成一轮班次出品质检并记录问题' },
  { position: '打荷', level: 'L3', title: '打荷L3：新人带教', description: '具备打荷新人带教与考核能力', key_points: ['新人培训计划制定', '带教示范与考核方法', '带教反馈与改进'], practice_task: '完成一名新人打荷岗位的带教并通过其L1认证' },

  // ===== 砧板线 (position: 砧板) =====
  { position: '砧板', level: '三砧', title: '三砧：基础刀工', description: '掌握常用刀法的规范操作', key_points: ['常用刀法（切/片/剁/拍）规范', '刀工安全操作', '刀工标准规格练习'], practice_task: '完成5种常见原料的标准刀工切配' },
  { position: '砧板', level: '三砧', title: '三砧：原料分档使用', description: '掌握原料分档存放与领用流程', key_points: ['原料分类分档存放标准', '原料先进先出与领用流程', '原料质量检查'], practice_task: '独立完成一次原料分档入库与领用记录' },
  { position: '砧板', level: '三砧', title: '三砧：配菜标准', description: '掌握常见菜品的配菜规格与标准', key_points: ['常见菜品配菜规格与配比', '配菜一致性要求', '配菜损耗控制'], practice_task: '独立完成5款菜品的标准配菜' },

  { position: '砧板', level: '二砧', title: '二砧：精细刀工', description: '掌握精细刀法与高难度食材处理', key_points: ['精细刀法（丝/茸/花刀等）规范', '高难度食材处理（如鱼/禽类拆解）', '刀工效率与品质平衡'], practice_task: '完成3种高难度食材的精细刀工处理' },
  { position: '砧板', level: '二砧', title: '二砧：各菜配料标准化', description: '掌握菜品配料SOP的制定与执行', key_points: ['菜品配料SOP制定与执行', '配料一致性把控', '配料异常处理'], practice_task: '独立制定并执行一份菜品配料SOP' },
  { position: '砧板', level: '二砧', title: '二砧：腌制上浆', description: '掌握常见食材的腌制与上浆标准', key_points: ['常见食材腌制配方与时间标准', '上浆比例与手法', '腌制/上浆质量检查'], practice_task: '完成5种食材的标准腌制与上浆并通过抽检' },

  { position: '砧板', level: '头砧', title: '头砧：配料总调度', description: '具备全店配料计划的统筹调度能力', key_points: ['全店配料计划制定与统筹', '跨档口配料协调', '配料质量总把控'], practice_task: '独立完成一周配料调度计划并执行' },
  { position: '砧板', level: '头砧', title: '头砧：采购下单与库存', description: '具备原料采购、验货与库存管理能力', key_points: ['原料采购需求测算与下单', '库存盘点与损耗分析', '供应商对接与验货标准'], practice_task: '独立完成一次采购下单与库存盘点' },
  { position: '砧板', level: '头砧', title: '头砧：出成率与成本控制', description: '掌握主要原料的出成率测算与成本核算', key_points: ['主要原料出成率标准与测算', '成本核算方法', '出成率异常分析与改进'], practice_task: '完成3种主要原料的出成率测算与成本分析报告' },
  { position: '砧板', level: '头砧', title: '头砧：菜单原料统筹', description: '具备菜单结构与原料统筹规划能力', key_points: ['菜单结构与原料关联分析', '新菜品原料筹备方案', '季节性原料调整建议'], practice_task: '针对一款新菜品提交原料筹备方案' },

  // ===== 炒锅/候镬线 (position: 炒锅) =====
  { position: '炒锅', level: '见习镬', title: '见习镬：镬气原理', description: '理解镬气形成原理与火候的关系', key_points: ['镬气形成的原理与作用', '火候与镬气的关系', '常见镬气不足的原因与改进'], practice_task: '完成一道菜品并解释镬气控制要点' },
  { position: '炒锅', level: '见习镬', title: '见习镬：火候基础', description: '掌握常见火力档位与火候判断方法', key_points: ['常见火力档位与适用场景', '火候判断方法（视觉/听觉/油温）', '火候失控的应急处理'], practice_task: '演示不同火候档位下3道基础菜品的烹制' },
  { position: '炒锅', level: '见习镬', title: '见习镬：基础芡汁', description: '掌握常见基础芡汁的配方与勾芡手法', key_points: ['常见基础芡汁配方与勾芡手法', '芡汁浓稠度标准', '芡汁失败的常见原因与纠正'], practice_task: '独立完成3种基础芡汁的勾制' },
  { position: '炒锅', level: '见习镬', title: '见习镬：基础小炒', description: '掌握常见小炒菜品的标准做法', key_points: ['常见小炒菜品标准做法', '小炒出品时间控制', '小炒口味一致性'], practice_task: '独立完成5款基础小炒菜品并达到出品标准' },

  { position: '炒锅', level: '二镬', title: '二镬：标准粤菜热炒', description: '掌握粤菜经典热炒菜品的标准做法', key_points: ['粤菜经典热炒菜品标准做法', '热炒火候与调味配合', '出品稳定性要求'], practice_task: '独立完成10款标准粤菜热炒并通过质检' },
  { position: '炒锅', level: '二镬', title: '二镬：芡汁体系', description: '掌握各类芡汁体系的分类与标准化管理', key_points: ['各类芡汁体系分类与适用菜品', '复合调味与芡汁搭配', '芡汁体系标准化管理'], practice_task: '独立完成一份芡汁体系对照表并应用于5款菜品' },
  { position: '炒锅', level: '二镬', title: '二镬：火候稳定性', description: '掌握不同批量/时段下的火候稳定控制', key_points: ['不同批量/不同时段火候稳定性控制', '高峰期连续出品的火候管理', '火候问题的快速诊断'], practice_task: '高峰期连续出品10道菜并保持火候稳定' },
  { position: '炒锅', level: '二镬', title: '二镬：出品一致性', description: '掌握出品口味与外观的一致性标准', key_points: ['出品口味/外观一致性标准', '出品自检与互检方法', '出品偏差的纠正流程'], practice_task: '独立完成一轮班次出品并通过一致性抽检' },

  { position: '炒锅', level: '头镬', title: '头镬：招牌菜与功夫菜', description: '掌握门店招牌菜与功夫菜的标准工艺', key_points: ['门店招牌菜/功夫菜标准做法与火候要点', '高难度菜品的工艺把控', '招牌菜出品标准维护'], practice_task: '独立完成3款招牌菜/功夫菜并达到标准' },
  { position: '炒锅', level: '头镬', title: '头镬：宴席大菜', description: '具备宴席大菜的统筹与出品能力', key_points: ['宴席菜品的统筹与出品节奏', '大菜烹制工艺与摆盘要求', '宴席出品时效与协调'], practice_task: '独立完成一场宴席的大菜出品统筹' },
  { position: '炒锅', level: '头镬', title: '头镬：出品质量总把关', description: '具备全店出品质量的总把关能力', key_points: ['全店出品质量标准制定', '出品质量巡查与纠偏', '出品质量问题追溯'], practice_task: '独立完成一轮全店出品质量巡查并记录改进项' },
  { position: '炒锅', level: '头镬', title: '头镬：菜品研发参与', description: '具备参与新菜品研发与标准化的能力', key_points: ['新菜品研发流程参与', '菜品试做与口味调试', '新菜品标准化文档编写'], practice_task: '参与并完成一款新菜品的研发试做与标准化文档' },

  // ===== 烧腊/烧味线 (position: 烧味/卤水) =====
  { position: '烧味/卤水', level: '学徒', title: '烧腊学徒：腌料配方', description: '掌握常用烧腊腌料的配方与配比', key_points: ['常用烧腊腌料配方与配比', '腌制时间与温度控制', '腌料质量检查'], practice_task: '独立完成2种烧腊产品的标准腌制' },
  { position: '烧味/卤水', level: '学徒', title: '烧腊学徒：上皮上色基础', description: '掌握上皮上色的材料与基本手法', key_points: ['上皮/上色材料与手法', '上色均匀度标准', '常见上色问题处理'], practice_task: '独立完成2种产品的上皮上色操作' },
  { position: '烧味/卤水', level: '学徒', title: '烧腊学徒：炉温认知', description: '掌握烧腊炉具结构与温度控制', key_points: ['烧腊炉具结构与温度区域认知', '炉温调节与监控方法', '炉温异常的应急处理'], practice_task: '独立完成一次炉温调节与监控记录' },
  { position: '烧味/卤水', level: '学徒', title: '烧腊学徒：卫生规范', description: '掌握烧腊操作区卫生标准', key_points: ['烧腊操作区卫生标准', '熟食存放与交叉污染防范', '卫生检查记录'], practice_task: '完成一次烧腊操作区开档卫生检查' },

  { position: '烧味/卤水', level: '师', title: '烧腊师：招牌产品标准出品', description: '掌握叉烧/烧鹅/烧肉/白切鸡的标准制作工艺', key_points: ['叉烧/烧鹅/烧肉/白切鸡的标准制作工艺', '出品色泽/口感标准', '常见出品问题诊断与改进'], practice_task: '独立完成叉烧/烧鹅/烧肉/白切鸡各1份并达到标准' },
  { position: '烧味/卤水', level: '师', title: '烧腊师：斩件刀工', description: '掌握烧腊斩件的标准规格与刀法', key_points: ['烧腊斩件标准规格与刀法', '斩件美观度与一致性', '斩件损耗控制'], practice_task: '独立完成3种烧腊产品的标准斩件' },
  { position: '烧味/卤水', level: '师', title: '烧腊师：保鲜与出品节奏', description: '掌握熟食保鲜与出品节奏管理', key_points: ['熟食保温/保鲜标准', '出品节奏与翻新管理', '损耗与报废处理流程'], practice_task: '独立完成一个班次的烧腊出品节奏管理并记录损耗' },

  { position: '烧味/卤水', level: '主管', title: '烧腊主管：全品类稳定出品', description: '具备全烧腊品类出品标准的维护能力', key_points: ['全烧腊品类出品标准维护', '多品类同时出品的统筹', '出品稳定性巡查'], practice_task: '独立完成一轮全品类出品巡查并记录改进项' },
  { position: '烧味/卤水', level: '主管', title: '烧腊主管：配方迭代', description: '具备配方优化与新产品试制能力', key_points: ['配方优化与迭代方法', '新口味/新产品试制', '配方标准化文档管理'], practice_task: '完成一次配方迭代试制并形成标准化文档' },
  { position: '烧味/卤水', level: '主管', title: '烧腊主管：损耗与出成把控', description: '掌握烧腊产品出成率与损耗分析', key_points: ['主要烧腊产品出成率标准', '损耗原因分析与改进', '成本核算'], practice_task: '完成一份烧腊出成率与损耗分析报告' },
  { position: '烧味/卤水', level: '主管', title: '烧腊主管：带教', description: '具备烧腊学徒/烧腊师的带教能力', key_points: ['烧腊学徒/烧腊师带教计划', '带教考核标准', '带教效果跟踪'], practice_task: '完成一名学员的带教并通过其考核' },

  // ===== 刺身岗位 (position: 刺身，向上对接厨师长) =====
  { position: '刺身', level: 'L1', title: '刺身L1：生食食安规范【强制及格线】', description: '一票否决项：生食类食品安全规范，未通过不可继续刺身岗位认证', key_points: ['生食类食品安全法规与标准', '低温链与时间控制规范', '生食原料异常的识别与处理'], practice_task: '完成生食食安规范笔试/实操并达到强制及格线' },
  { position: '刺身', level: 'L1', title: '刺身L1：专用刀具/砧板/容器分离使用', description: '掌握生食专用器具的分离使用与消毒规范', key_points: ['生食专用刀具/砧板/容器的分类与标识', '分离使用与清洁消毒规范', '交叉污染防范检查'], practice_task: '演示一次完整的专用器具分离使用与清洁流程' },
  { position: '刺身', level: 'L1', title: '刺身L1：基础鱼种识别', description: '掌握常见刺身鱼种的辨识与基础知识', key_points: ['常见刺身鱼种名称与外观特征', '鱼种新鲜度初步判断', '常见鱼种处理注意事项'], practice_task: '现场辨认并说明5种常见刺身鱼种特征' },

  { position: '刺身', level: 'L2', title: '刺身L2：标准鱼种处理', description: '掌握常见鱼种的标准分割与处理工艺', key_points: ['常见鱼种的标准分割与处理工艺', '各部位用途与出品对应', '处理效率与品质平衡'], practice_task: '独立完成3种鱼种的标准处理' },
  { position: '刺身', level: 'L2', title: '刺身L2：基础刀法', description: '掌握刺身基础刀法的规范操作', key_points: ['刺身基础刀法（平切/拉切等）规范', '厚薄/纹理一致性标准', '刀法安全操作'], practice_task: '独立完成2种鱼种的标准刺身切配' },
  { position: '刺身', level: 'L2', title: '刺身L2：摆盘与配菜', description: '掌握刺身常见摆盘样式与配菜搭配', key_points: ['刺身常见摆盘样式与配菜搭配', '摆盘美观度标准', '配菜新鲜度检查'], practice_task: '独立完成3款刺身拼盘的标准摆盘' },
  { position: '刺身', level: 'L2', title: '刺身L2：鲜度判断与损耗控制', description: '掌握鱼类鲜度判断方法与损耗控制', key_points: ['鱼类鲜度判断方法（色泽/气味/质感）', '鲜度异常的处理与上报', '损耗记录与控制'], practice_task: '完成一次鲜度检查并记录处理结果' },

  { position: '刺身', level: 'L3', title: '刺身L3：高端食材处理', description: '掌握高端刺身食材的处理工艺与损耗控制', key_points: ['高端刺身食材（如金枪鱼大块/海胆等）特性与处理工艺', '高端食材损耗控制', '高端食材出品标准'], practice_task: '独立完成1种高端食材的标准处理与出品' },
  { position: '刺身', level: 'L3', title: '刺身L3：活鱼处理', description: '掌握活鱼宰杀与放血处理规范', key_points: ['活鱼宰杀与放血处理规范', '活鱼处理安全操作', '活鱼处理后的品质保持'], practice_task: '独立完成一次活鱼处理全流程' },
  { position: '刺身', level: 'L3', title: '刺身L3：拼盘美学呈现', description: '掌握高级拼盘设计原则与创意呈现', key_points: ['高级拼盘设计原则与配色搭配', '拼盘创意呈现方法', '拼盘呈现一致性'], practice_task: '独立设计并完成1款高级刺身拼盘' },
  { position: '刺身', level: 'L3', title: '刺身L3：客户过敏应对', description: '掌握常见海鲜过敏原识别与应对流程', key_points: ['常见海鲜过敏原识别', '客户过敏信息确认与替代方案', '过敏突发情况处理流程'], practice_task: '完成一次客户过敏场景的应对演练' },

  { position: '刺身', level: '主管', title: '刺身主管：全品类统筹', description: '具备刺身全品类出品的统筹排班能力', key_points: ['刺身全品类出品统筹与排班', '多档口/多场景协调', '品类出品标准维护'], practice_task: '独立完成一轮刺身全品类出品统筹' },
  { position: '刺身', level: '主管', title: '刺身主管：采购验货', description: '掌握刺身原料采购与验货标准', key_points: ['刺身原料采购标准与供应商管理', '验货标准与拒收流程', '采购成本控制'], practice_task: '独立完成一次刺身原料采购验货' },
  { position: '刺身', level: '主管', title: '刺身主管：成本损耗管控', description: '掌握刺身品类成本核算与损耗分析', key_points: ['刺身品类成本核算方法', '损耗分析与改进措施', '成本损耗周期性复盘'], practice_task: '完成一份刺身品类成本与损耗分析报告' },
  { position: '刺身', level: '主管', title: '刺身主管：食安应急与带教', description: '掌握生食食安应急处理与刺身岗位带教', key_points: ['生食食安突发事件应急流程', '应急上报与处理记录', '刺身岗位带教计划与考核'], practice_task: '完成一次食安应急演练并带教1名学员通过认证' },

  // ===== 厨师长晋升之路 (position: 出品经理) =====
  // 阶段二：储备厨师长 - 管理预科
  { position: '出品经理', level: '储备', title: '储备厨师长：食安体系全盘管理(HACCP)', description: '掌握HACCP食安体系的全盘管理方法', key_points: ['HACCP体系核心原理与关键控制点', '食安体系文件与记录管理', '食安体系自查与整改'], practice_task: '完成一次门店HACCP体系自查并提交整改报告' },
  { position: '出品经理', level: '储备', title: '储备厨师长：成本与毛利结构', description: '掌握门店成本结构与毛利核算方法', key_points: ['门店成本结构与毛利核算方法', '成本异常分析与改进措施', '成本数据周期性复盘机制'], practice_task: '完成一份门店成本与毛利结构分析报告' },
  { position: '出品经理', level: '储备', title: '储备厨师长：排班与人力调度', description: '掌握后厨排班原则与人力调度方案', key_points: ['后厨排班原则与人力测算', '高峰期人力调度方案', '排班异常应急处理'], practice_task: '独立完成一周后厨排班并应对一次突发调度' },
  { position: '出品经理', level: '储备', title: '储备厨师长：跨站位协调实操', description: '通过代理厨师长1-2周，具备全档口协调统筹能力', key_points: ['全档口协调与出品统筹', '跨站位资源调配实操', '代理期间问题记录与复盘'], practice_task: '完成1-2周代理厨师长跨站位协调实操并提交复盘报告' },

  // 阶段三：厨师长 - 正式认证
  { position: '出品经理', level: '正式', title: '厨师长：出品全盘质量把控', description: '具备全店出品质量标准体系的建立与执行能力', key_points: ['全店出品质量标准体系建立', '出品质量巡查与考核机制', '质量问题追溯与改进闭环'], practice_task: '建立并执行一份全店出品质量巡查机制并提交一期报告' },
  { position: '出品经理', level: '正式', title: '厨师长：团队管理与带教体系', description: '具备后厨团队梯队建设与带教体系搭建能力', key_points: ['后厨团队梯队建设与晋升通道设计', '带教体系制定与落地', '团队绩效评估方法'], practice_task: '制定一份后厨团队带教体系方案并落地执行' },
  { position: '出品经理', level: '正式', title: '厨师长：菜单与经营协同', description: '具备菜单结构与经营数据协同分析能力', key_points: ['菜单结构与经营数据协同分析', '新菜品/季节菜单规划', '菜单调整对成本与营收的影响评估'], practice_task: '完成一份菜单优化建议并评估其经营影响' },
  { position: '出品经理', level: '正式', title: '厨师长：危机处理', description: '具备食安/客诉/设备等突发事件的处理能力', key_points: ['食安/客诉/设备等突发事件处理流程', '危机应急预案制定', '危机后复盘与改进'], practice_task: '完成一次突发场景的危机处理演练并提交复盘报告' },

  // ===== 楼面服务线 =====
  // 传菜/迎宾
  { position: '传菜', level: 'L1', title: '传菜L1：传菜动线与卫生', description: '掌握标准传菜动线与传菜卫生规范', key_points: ['传菜标准动线与时效要求', '传菜过程中的卫生规范', '传菜异常（漏单/错单）处理'], practice_task: '演示一次完整的标准传菜流程' },
  { position: '传菜', level: 'L1', title: '传菜L1：迎宾接待礼仪', description: '掌握迎宾接待的基本礼仪与流程', key_points: ['迎宾基本礼仪与话术规范', '客流引导与等位安排', '客户基本信息记录'], practice_task: '完成一次标准迎宾接待演练' },
  { position: '传菜', level: 'L1', title: '传菜L1：基础点餐流程协助', description: '掌握点餐系统基础操作与菜品信息介绍', key_points: ['点餐系统基础操作', '菜品基础信息介绍', '协助服务员处理简单需求'], practice_task: '完成一次基础点餐流程协助演练' },

  // 服务员
  { position: '服务员', level: 'L2', title: '服务员L2：全菜单讲解推荐', description: '掌握全菜单结构讲解与推荐技巧', key_points: ['全菜单结构与招牌菜讲解', '基于客户需求的菜品推荐技巧', '菜品禁忌/过敏提示'], practice_task: '完成一次全菜单讲解与推荐演练' },
  { position: '服务员', level: 'L2', title: '服务员L2：点单系统操作', description: '掌握点单系统全流程操作', key_points: ['点单系统全流程操作', '加单/改单/退单处理', '账单核对'], practice_task: '独立完成5次以上点单系统操作并无差错' },
  { position: '服务员', level: 'L2', title: '服务员L2：席间服务标准', description: '掌握席间巡台与服务标准动作', key_points: ['席间巡台与服务时机把握', '上菜/分餐/换盘标准动作', '席间需求响应时效'], practice_task: '完成一次完整席间服务流程演练' },
  { position: '服务员', level: 'L2', title: '服务员L2：投诉初步应对', description: '掌握常见客诉的初步应对与上报流程', key_points: ['常见客诉类型与初步应对话术', '投诉升级上报流程', '投诉记录与跟进'], practice_task: '完成一次客诉初步应对演练' },
  { position: '服务员', level: 'L2', title: '服务员L2：餐桌礼仪', description: '掌握标准餐桌礼仪与服务细节', key_points: ['标准餐桌礼仪与服务细节', '特殊场合（宴请/商务等）服务要点', '个人仪态与沟通规范'], practice_task: '完成一次餐桌礼仪规范演示' },

  // 领班/部长
  { position: '主管', level: 'L3', title: '领班/部长L3：区域管理', description: '具备责任区域人员与服务质量管理能力', key_points: ['责任区域人员与服务质量管理', '区域内排班与任务分配', '区域问题巡查与改进'], practice_task: '独立完成一轮责任区域巡查并记录改进项' },
  { position: '主管', level: 'L3', title: '领班/部长L3：宴席服务统筹', description: '具备宴席服务流程的统筹与调度能力', key_points: ['宴席服务流程统筹与人员调度', '宴席特殊需求对接', '宴席服务突发应对'], practice_task: '独立统筹完成一场宴席服务' },
  { position: '主管', level: 'L3', title: '领班/部长L3：突发处理', description: '掌握常见突发事件的处理流程', key_points: ['常见突发事件（设备故障/客诉升级等）处理流程', '突发事件上报机制', '突发处理后复盘'], practice_task: '完成一次突发事件处理演练并提交复盘' },
  { position: '主管', level: 'L3', title: '领班/部长L3：推销技巧', description: '掌握套餐/活动/高毛利菜品的推销技巧', key_points: ['套餐/活动/高毛利菜品推荐技巧', '团队推销话术培训', '推销效果跟踪'], practice_task: '完成一次团队推销话术培训并跟踪一周推销数据' },
  { position: '主管', level: 'L3', title: '领班/部长L3：新人带教', description: '具备楼面新人的带教与考核能力', key_points: ['楼面新人带教计划制定', '带教考核标准', '带教效果评估'], practice_task: '完成一名楼面新人的带教并通过其L2认证' },

  // 主管(L4)
  { position: '主管', level: 'L4', title: '主管L4：多区调度', description: '具备全场多区域人员与服务调度能力', key_points: ['全场多区域人员与服务调度', '高峰期跨区支援机制', '调度效果评估'], practice_task: '独立完成一次全场多区域调度并记录效果' },
  { position: '主管', level: 'L4', title: '主管L4：排班管理', description: '掌握楼面排班原则与人力测算', key_points: ['楼面排班原则与人力测算', '排班异常应急调整', '排班成本核算'], practice_task: '独立完成一周楼面排班并应对一次异常调整' },
  { position: '主管', level: 'L4', title: '主管L4：服务质量把控', description: '具备全场服务质量标准的制定与巡查能力', key_points: ['全场服务质量标准制定', '服务质量巡查与考核机制', '服务问题追溯与改进'], practice_task: '建立并执行一期全场服务质量巡查' },
  { position: '主管', level: 'L4', title: '主管L4：VIP/私域客户维护', description: '掌握VIP及私域客户的维护方法', key_points: ['VIP客户识别与服务标准', '私域客户运营与维护方法', '客户关系问题处理'], practice_task: '完成一份VIP/私域客户维护方案并执行' },

  // 楼面/餐厅经理
  { position: '前厅经理', level: 'L5', title: '楼面经理L5：全场运营', description: '具备门店全场运营标准与流程管理能力', key_points: ['门店全场运营标准与流程管理', '各岗位协同与考核', '运营数据日常分析'], practice_task: '完成一份门店全场运营日报分析' },
  { position: '前厅经理', level: 'L5', title: '楼面经理L5：营收与成本', description: '具备营收结构分析与成本控制能力', key_points: ['营收结构分析与目标拆解', '成本控制与毛利提升方法', '营收/成本异常应对'], practice_task: '完成一份营收与成本分析报告并提出改进建议' },
  { position: '前厅经理', level: 'L5', title: '楼面经理L5：活动落地', description: '具备营销活动方案的落地执行能力', key_points: ['营销活动方案落地执行流程', '活动效果跟踪与复盘', '活动资源协调'], practice_task: '独立完成一次营销活动的落地执行与复盘' },
  { position: '前厅经理', level: 'L5', title: '楼面经理L5：团队建设', description: '具备团队梯队建设与绩效管理能力', key_points: ['团队梯队建设与晋升通道规划', '团队激励与文化建设方法', '团队绩效管理'], practice_task: '制定一份团队建设方案并执行一期' },

  // ===== 收银/前台线 (position: 出纳) =====
  { position: '出纳', level: 'L1', title: '收银员L1：POS操作', description: '掌握POS系统基础操作与异常处理', key_points: ['POS系统基础操作与常见问题处理', '收款方式与流程规范', 'POS异常报修流程'], practice_task: '独立完成POS全流程操作演练' },
  { position: '出纳', level: 'L1', title: '收银员L1：结账流程', description: '掌握标准结账流程与差错处理', key_points: ['标准结账流程与核对要点', '折扣/优惠核销规范', '结账差错处理流程'], practice_task: '独立完成5笔以上结账并无差错' },
  { position: '出纳', level: 'L1', title: '收银员L1：会员积分系统', description: '掌握会员注册、查询与积分操作', key_points: ['会员注册/查询/积分操作', '积分兑换与活动规则', '会员信息保密规范'], practice_task: '独立完成会员注册与积分操作演练' },
  { position: '出纳', level: 'L1', title: '收银员L1：发票与对账', description: '掌握发票开具与日常对账流程', key_points: ['发票开具规范与税务要求', '日常对账流程与差错排查', '发票/对账记录留存'], practice_task: '独立完成一次日结对账并记录差错排查结果' },

  { position: '出纳', level: 'L2', title: '前台主管L2：账务核对', description: '掌握日/月账务核对与报表编制', key_points: ['日/月账务核对标准流程', '账务异常排查与处理', '账务报表编制'], practice_task: '独立完成一次月度账务核对并出具报告' },
  { position: '出纳', level: 'L2', title: '前台主管L2：会员私域引导', description: '掌握会员私域引导话术与转化跟踪', key_points: ['会员私域（企微/社群）引导话术与流程', '私域活动配合执行', '私域转化数据跟踪'], practice_task: '完成一次会员私域引导演练并记录转化数据' },
  { position: '出纳', level: 'L2', title: '前台主管L2：异常处理', description: '掌握收银/账务/系统异常处理流程', key_points: ['收银/账务/系统常见异常类型与处理流程', '异常升级上报机制', '异常处理记录与复盘'], practice_task: '完成一次异常处理演练并提交复盘' },
  { position: '出纳', level: 'L2', title: '前台主管L2：报表', description: '掌握日/周/月营收报表编制规范', key_points: ['日/周/月营收报表编制规范', '报表数据核对与异常标注', '报表呈报流程'], practice_task: '独立完成一份周报表编制并提交' },
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < TOPICS.length; i++) {
      const t = TOPICS[i];
      const existing = await pool.query(
        `SELECT id FROM training_topics WHERE title = $1 AND position = $2 AND level = $3 LIMIT 1`,
        [t.title, t.position, t.level]
      );
      if (existing.rows.length) { skipped++; continue; }
      await pool.query(
        `INSERT INTO training_topics
           (title, position, level, description, key_points, practice_task, sort_order, created_by, kb_article_ids, store, promotion_required, validity_days, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'system', '{}', '', true, 180, true)`,
        [t.title, t.position, t.level, t.description, JSON.stringify(t.key_points), t.practice_task, i + 1]
      );
      inserted++;
    }
    console.log(`done. inserted=${inserted} skipped(existing)=${skipped} total=${TOPICS.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
