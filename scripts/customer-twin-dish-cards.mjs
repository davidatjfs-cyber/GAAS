/**
 * 菜品知识卡全套生成器（v1 草稿）
 * 输入：菜品库属性（内嵌）+ 招牌话术 md；输出：docs/customer-twin-dish-knowledge-full.md
 * 规则：做法→出品原理；食材→忌口/过敏；字段→常见问题与标准回答；话术→推销卖点。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DISH_FACTS = [
  ['洪潮', '9秒生炒鱼片', 58, 13.73, '不辣', '河鲜', '炒', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '冰淇淋麻薯西多士', 33, 5.61, '不辣', '其他', '炸', '甜', '否', '中', '情侣约会、朋友聚会、独自用餐、工作餐'],
  ['洪潮', '冻吃手钓鲜鱿鱼', 128, 37.95, '不辣', '海鲜', '白灼', '咸鲜', '是', '中', '家庭聚餐、商务宴请、朋友聚会、情侣约会'],
  ['洪潮', '啫啫沙姜走地鸡', 78, 15.55, '不辣', '鸡肉', '啫啫', '浓郁', '是', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '潮汕蚝仔烙', 68, 13.22, '不辣', '海鲜', '炸', '香脆', '否', '中', '家庭聚餐、情侣约会、工作餐'],
  ['洪潮', '脆皮牛里脊', 48, 8, '不辣', '牛肉', '炸', '香脆', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '荔枝木脆皮烧鹅上庄', 98, 39.49, '不辣', '其他', '烤', '浓郁', '是', '中', '商务宴请、家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '葱姜炒鲜吊龙', 78, 21.76, '不辣', '牛肉', '炒', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '蚝仔捞饭', 58, 11.48, '不辣', '海鲜', '炒', '咸鲜', '是', '大', '家庭聚餐、情侣约会、朋友聚会、独自用餐、工作餐'],
  ['洪潮', '蜜汁红薯', 22, 2, '不辣', '蔬菜', '煲', '甜', '是', '小', '商务宴请、家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['洪潮', '豆酱焗清远鸡（半只）', 88, 23.78, '不辣', '鸡肉', '煲', '咸鲜', '是', '大', '商务宴请、家庭聚餐、情侣约会、朋友聚会'],
  ['洪潮', '豆酱焗老虎斑', 298, 71.27, '不辣', '海鲜', '啫啫', '咸鲜', '是', '大', '商务宴请、家庭聚餐、情侣约会、朋友聚会'],
  ['洪潮', '酱烧东山小管', 78, 22.7, '不辣', '海鲜', '啫啫', '浓郁', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '九秒生炒鱼片', 48, 13.73, '不辣', '河鲜', '炒', '咸鲜', '是', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '传统虾饺皇', 32, 9.44, '不辣', '主食', '蒸', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会'],
  ['马己仙', '厚切蜜汁叉烧', 68, 18.9, '不辣', '猪肉', '烤', '浓郁', '是', '中', '商务宴请、家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '叉烧手工肠粉', 28, 7.79, '不辣', '猪肉', '蒸', '咸鲜', '是', '小', '家庭聚餐、情侣约会、朋友聚会、工作餐、独自用餐'],
  ['马己仙', '啫啫紫苏牛蛙煲', 58, 14.91, '不辣', '其他', '啫啫', '浓郁', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '女儿红花雕鸡煲', 198, 60, '不辣', '鸡肉', '煲', '咸鲜', '否', '大', '家庭聚餐、情侣约会、朋友聚会'],
  ['马己仙', '手打全虾虾饼', 19, 5.09, '不辣', '海鲜', '炸', '咸鲜', '否', '小', '家庭聚餐、商务宴请、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '葱姜炒鲜吊龙', 68, 21.76, '不辣', '牛肉', '炒', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '虾籽鲜虾云吞面', 39, 13, '不辣', '主食', '煲', '清淡', '是', '小', '独自用餐、工作餐'],
  ['马己仙', '酱烧东山小管', 78, 22.7, '不辣', '海鲜', '啫啫', '浓郁', '是', '中', '商务宴请、家庭聚餐、情侣约会、朋友聚会'],
  ['马己仙', '酸菜牛肉炒饭', 48, 11, '不辣', '主食', '炒', '浓郁', '否', '中', '家庭聚餐、情侣约会、独自用餐、工作餐'],
  ['马己仙', '青芥末泪点虾', 38, 12.16, '不辣', '海鲜', '炸', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '顺德容边干蒸排骨', 48, 8.21, '不辣', '猪肉', '烤', '咸鲜', '否', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '顺德沙姜走地鸡', 58, 14.85, '不辣', '鸡肉', '啫啫', '浓郁', '是', '中', '家庭聚餐、情侣约会、朋友聚会、工作餐'],
  ['马己仙', '鲜虾手工肠粉', 28, 7.65, '不辣', '海鲜', '蒸', '咸鲜', '是', '小', '家庭聚餐、情侣约会、朋友聚会、独自用餐、工作餐'],
  ['马己仙', '黄油焗鸦片鱼头', 78, 35.1, '不辣', '海鲜', '啫啫', '浓郁', '否', '中', '商务宴请、家庭聚餐、情侣约会、朋友聚会'],
  ['马己仙', '黯然销魂饭', 48, 12, '不辣', '主食', '烤', '咸鲜', '是', '小', '独自用餐、工作餐'],
];

// 话术补充的招牌菜（无属性数据 → 价格/成本待确认）
const EXTRA_SIGNATURE = [
  ['洪潮', '黑金叉烧', 78, 18.9, '精选土猪五花肉，对肥瘦要求极高才能保证入口香而不腻，300度的炙烤和厚切的刀工保证每一口的肉的焦香，肉的多汁，让这口叉烧入口难忘'],
  ['洪潮', '潮州虾生', 108, 27.61, '因为真正新鲜的海虾，吃的就是它最原始的鲜甜。虾肉爽脆、清甜，再蘸一点潮汕特色酱汁，鲜味会更加突出'],
  ['洪潮', '潮州鱼生', 178, 56.21, '只选用深海活鱼，现点现切，鱼肉晶莹透亮、细嫩爽滑，搭配潮汕传统配料和蘸料，口感层次丰富，是潮汕经典代表菜'],
  ['洪潮', '冰激淋膏蟹', 238, 93.72, '选用膏满的新鲜膏蟹，低温熟成，蟹膏绵密细滑，蟹肉晶莹鲜甜，入口即化，潮汕最经典的生腌菜之一'],
  ['洪潮', '古法手工香酥芋泥鸭', 88, 21.64, '传统手工工艺，精选芋头和鸭肉，现炸后外皮酥脆，芋泥细腻香甜，鸭肉鲜嫩入味，外酥内糯，潮汕传统宴席功夫菜'],
  ['洪潮', '潮州手打虾饼', 19, 5.09, '能吃出一颗颗真实的虾肉，咬下去外酥、里面Q弹鲜嫩，小朋友和老人都很喜欢'],
  ['马己仙', '荔枝木烧鹅', null, null, '荔枝木烤出来的烧鹅，带有淡淡果木香气，皮酥而不硬，肉嫩而不柴，皮脆多汁是灵魂，现烤现吃，一天只出炉3次'],
];

const METHOD_PRINCIPLE = {
  炒: '猛火快炒，快速过蛋白质变性区间，锁住水分，肉嫩味鲜',
  炸: '高温定型外酥，内部锁住汁水，外酥里嫩',
  烤: '高温炙烤产生美拉德反应，表面焦香，内部保留肉汁',
  蒸: '蒸汽短时加热，保留食材原汁原味',
  煲: '慢火炖煮，让食材与汤汁充分融合，入味软糯',
  啫啫: '高温啫啫出锅气，锁香锁嫩，锅气足',
  白灼: '短时烫煮，突出食材本味与鲜甜',
};

const INGREDIENT_ALLERGY = {
  海鲜: '海鲜过敏客人必须确认（虾/蟹/贝类）；生食类（虾生/鱼生/生腌）不推荐孕妇、儿童、肠胃敏感人群',
  河鲜: '河鲜过敏客人必须确认；鱼类菜注意鱼刺',
  其他: '含豆酱/酱油类调味，大豆过敏客人需说明【按菜名含"豆酱"时启用】',
};

function norm(s) {
  return String(s || '').replace(/九/g, '9').replace(/[\s（）()【】]/g, '').toLowerCase();
}

function loadSellingPoints() {
  const mdPath = '/Users/xieding/GAAS知识库内容/招牌菜品介绍话术.md';
  const selling = new Map(); // key: norm(brand+dish)
  const text = readFileSync(mdPath, 'utf8');
  for (const line of text.split('\n')) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 4 && (parts[1] === '马己仙' || parts[1] === '洪潮') && parts[2]) {
      const key = norm(parts[1] + parts[2]);
      if (!selling.has(key) || parts[3].length > selling.get(key).length) {
        selling.set(key, parts[3]);
      }
    }
  }
  return selling;
}

function buildCard(brand, name, price, cost, spicy, ingredients, method, taste, signature, portion, scenes, sellingText) {
  const principle = METHOD_PRINCIPLE[method] || '按标准做法保证出品';
  let allergy = ingredients === '海鲜' || ingredients === '河鲜'
    ? INGREDIENT_ALLERGY[ingredients]
    : (name.includes('豆酱') || name.includes('酱油') ? '含豆酱/酱油，大豆过敏客人需说明' : '无常见过敏原【如含特殊调料请补充】');
  if (/(生腌|刺身|虾生|鱼生)/.test(name + method)) {
    allergy += '；生食类不推荐孕妇、儿童、肠胃敏感人群';
  }
  const rawDish = name.includes('豆酱焗清远鸡') ? '清远鸡（广东清远）' : '';
  const origin = rawDish || (name.includes('吊龙') ? '每日新鲜宰杀的贵州黄牛精选部位' : '');
  const why = `${principle}${origin ? '；' + origin : ''}`;
  const questions = [
    origin ? `这道菜用的是哪里的${ingredients === '牛肉' ? '牛肉' : '食材'}？` : `这道菜的主要食材是什么？`,
    `${name}的做法有什么讲究？`,
    `为什么这道菜${method === '炸' ? '外酥里嫩' : method === '炒' ? '这么嫩' : '这么好吃'}？`,
    portion === '小' ? '这个分量一个人够吃吗？' : portion === '大' ? '这个分量够几个人吃？' : '这个分量大概几个人合适？',
    signature === '是' ? '这是你们招牌菜吗？第一次来推荐点吗？' : '这道菜有什么特色？',
    `${scenes ? '适合' + scenes.split('、').slice(0, 3).join('、') + '这类场合吗？' : ''}`,
  ].filter(Boolean);
  const answers = [
    origin ? `用${origin}，每日新鲜准备` : `主料是${ingredients}，${spicy === '不辣' ? '不辣' : '辣度' + spicy}`,
    `做法是${method}，${taste}口味`,
    why,
    portion === '小' ? '小份，适合一人或配菜' : portion === '大' ? '大份，适合多人分享' : '中份，2-4 人比较合适【待确认：实际克数】',
    signature === '是' ? '是招牌，客人反馈很好' : '有特色，可以尝试',
    allergy,
  ].filter(Boolean);
  return {
    brand, name, price, cost, spicy, ingredients, method, taste,
    signature, portion, scenes,
    why,
    selling: sellingText || `${name}：${taste}口味，${signature === '是' ? '招牌推荐' : '特色菜'}，价格 ${price} 元`,
    allergy,
    questions,
    answers,
  };
}

function main() {
  const selling = loadSellingPoints();
  const cards = DISH_FACTS.map((f) => {
    const [brand, name, price, cost, spicy, ingredients, method, taste, signature, portion, scenes] = f;
    const sellingText = selling.get(norm(brand + name));
    return buildCard(brand, name, price, cost, spicy, ingredients, method, taste, signature, portion, scenes, sellingText);
  });
  for (const [brand, name, price, cost, text] of EXTRA_SIGNATURE) {
    const sellingText = selling.get(norm(brand + name)) || text;
    cards.push(buildCard(brand, name, price, cost, '不辣', inferIngredient(name), methodGuess(name), '咸鲜', '是', '中', '商务宴请、家庭聚餐、情侣约会、朋友聚会', sellingText));
  }
  cards.sort((a, b) => (a.brand === b.brand ? a.name.localeCompare(b.name, 'zh') : a.brand.localeCompare(b.brand, 'zh')));

  const lines = ['# 菜品知识卡全套（v1 草稿，待评审）', '', `> 共 ${cards.length} 张｜数据来源：菜品库属性 + 招牌话术 + 烹饪/忌口手册`, '> 标注【待确认】的字段需门店/厨房补充', ''];
  for (const c of cards) {
    lines.push(`## ${c.name}｜${c.brand}`, '');
    lines.push('| 字段 | 内容 |');
    lines.push('|---|---|');
    lines.push(`| 价格/成本 | ${c.price ? c.price + ' 元 / ' + (c.cost ?? '?') + ' 元' : '【待确认】'} |`);
    lines.push(`| 食材与产地 | ${c.ingredients}${c.name.includes('清远鸡') ? '（广东清远走地鸡）' : ''}${c.name.includes('吊龙') ? '（贵州黄牛鲜吊龙）' : ''} |`);
    lines.push(`| 做法/口味 | ${c.method} / ${c.taste} |`);
    lines.push(`| 为什么好 | ${c.why} |`);
    lines.push(`| 分量/适合场景 | ${c.portion === '小' ? '小份' : c.portion === '大' ? '大份' : '中份'}；${c.scenes} |`);
    lines.push(`| 常见客人问题 | ${c.questions.map((q) => '①' + q).join('')} |`);
    lines.push(`| 标准回答要点 | ${c.answers.map((a) => '①' + a).join('')} |`);
    lines.push(`| 忌口提醒 | ${c.allergy} |`);
    lines.push(`| 推销卖点 | ${c.selling.replace(/\s+/g, ' ').slice(0, 120)} |`);
    lines.push('');
  }
  lines.push('---', '', '### 评审要点', '1. 卡片结构是否够用；2.【待确认】项由门店/厨房补充；3. 常见问题是否贴近真实客人。', '');
  const outPath = join(process.cwd(), 'docs', 'customer-twin-dish-knowledge-full.md');
  writeFileSync(outPath, lines.join('\n'));
  console.log('已生成', cards.length, '张 →', outPath);
}

function methodGuess(name) {
  if (name.includes('烧鹅')) return '烤';
  if (name.includes('虾生') || name.includes('鱼生') || name.includes('膏蟹')) return '生腌';
  if (name.includes('虾饼')) return '炸';
  return '焗';
}

function inferIngredient(name) {
  if (/虾|蟹|鱼|鱿|蚝|贝/.test(name)) return '海鲜';
  if (/鸡/.test(name)) return '鸡肉';
  if (/牛/.test(name)) return '牛肉';
  if (/叉烧|排骨/.test(name)) return '猪肉';
  if (/鸭|鹅/.test(name)) return '禽类';
  return '其他';
}

main();
