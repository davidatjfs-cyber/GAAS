/**
 * Feishu marketing-copy pure helpers (P2 peel from agents.js).
 */

export const FEISHU_MARKETING_COPY_TTL_MS = 30 * 60 * 1000;
export const FEISHU_MARKETING_COPY_ROLES = new Set([
  'admin',
  'hq_manager',
  'store_manager',
  'store_production_manager',
  'store_product_manager'
]);

export const FEISHU_MARKETING_COPY_SET_MIN = 1;
export const FEISHU_MARKETING_COPY_SET_MAX = 12;
export const FEISHU_MARKETING_COPY_SET_DEFAULT = 2;
export const FEISHU_MARKETING_PLATFORMS_PER_SET = 4;

export function parseFeishuMarketingCopySetRaw(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function clampFeishuMarketingCopySetCount(n) {
  if (n == null || !Number.isFinite(n)) return FEISHU_MARKETING_COPY_SET_DEFAULT;
  return Math.max(FEISHU_MARKETING_COPY_SET_MIN, Math.min(FEISHU_MARKETING_COPY_SET_MAX, Math.round(n)));
}

/** 套数 N = 每平台 N 条；每轮顺序：大众点评 → 外卖 → 小红书 → 抖音 */
export function buildFeishuMarketingCopyHeadings(copySetCount) {
  const n = clampFeishuMarketingCopySetCount(copySetCount);
  const lines = [];
  for (let i = 1; i <= n; i++) {
    lines.push(`【大众点评｜第${i}套】`);
    lines.push(`【外卖｜第${i}套】`);
    lines.push(`【小红书｜第${i}套】`);
    lines.push(`【抖音｜第${i}套】`);
  }
  return { lines, setCount: n, totalBlocks: lines.length };
}

export function buildFeishuMarketingCopySystemPrompt(requiredHeadingsBlock, sectionCount) {
  return `你是餐饮门店的商家小编/运营，统一用「商家视角」写稿：可用「我们店/本店/这款/推荐」等，语气像真人店长或品牌账号在发声，但不要写公文或堆砌形容词。禁止假装成顾客写「我今天吃到」（顾客视角禁用）。

【互动与效果——红线】平台算法、账号权重、投放与时段均不可控。禁止承诺「必火」「必上热门」「保证 500 赞 / 300 条评论」或编造任何互动数据。请把内容设计成「高互动潜力」：评论有可答点、收藏有理由、开头 3 秒/首句能留住人、信息具体真实；若用户期望大体量互动，只在结构上对齐爆款常见特征，不写保证语。

【平台流量与内容规则——须落实到每一段】
A) 大众点评（评价/笔记向，堂食）：平台长期治理虚假评价与异常 AIGC 评价，内容须像真实到店体验：首句抓人、细节具体（环境/服务/菜品一环）、避免套话堆叠与明显 AI 模板腔。精选向常见特征：主题清晰、有画面感、字数充实（本任务 90～220 字）、可自然引导读者「想配图可拍门头/菜品/桌景」。严禁外卖配送话术（骑手、餐盒、拆盒、送到家等）。

B) 小红书（搜索 + 推荐双流量）：标题与正文埋「用户会搜的词」（品类、场景如聚餐/约会、地域或商圈可弱化编造）；首段承担留存，避免全是形容词；给一行「封面大字可写：xxx」作拍摄提示；正文末 #话题# 3～6 个，每段标签组合不同，兼顾垂直与泛流量词；可轻引导收藏「怕找不到先收藏」。遵守社区规范，避免虚假功效与极限承诺。

C) 抖音（短视频）：按 15～45 秒口播脚本写，结构必须含：①【0～3 秒钩子】冲突/反问/悬念（口语短句）；②【中段】菜品与店信息，节奏紧凑；③【结尾互动】设计 2 个低门槛评论问题（如二选一、扣 1、猜价格区间）；④【画面/字幕建议】一行。抖音公开信息强调推荐会综合多类用户行为信号（完播、点赞、评论、收藏、关注等，且随内容类型动态调整），勿只押单一指标；可提示发布后积极回复前若干条评论以提升互动链。禁止写成大众点评长评或外卖商品说明的换皮版本。

D) 外卖（到家场景）：同下条原则级。

【原则级：体裁与场景不可串台——违反即整段作废】
1) 【大众点评｜第N套】仅到店堂食：入座、点菜、上桌、趁热、店员介绍、店内环境等。禁止外卖话术。
2) 【外卖｜第N套】仅到家/配送：到手、打包、温度、拆盒、办公室或在家吃、套餐加购、搜索词等至少两类；禁止把堂食「刚端上桌现片」当主线；不少于约 120 字（不含标题）。
3) 【小红书｜第N套】商家种草笔记：标题+正文+标签+（可选）封面提示；非短视频脚本。
4) 【抖音｜第N套】短视频口播脚本：短句、强节奏、强互动，不得与另三段同结构抄袭。

【去 AI 味——出现任一即算失败，禁止输出】
综上所述、值得一提、不难发现、不仅…而且…、在当下的、深度、赋能、痛点、用户、极致体验、不容错过、宝藏、绝绝子、YYDS、姐妹们谁懂、家人们、沉浸式、氛围感拉满、一口沦陷、好吃到哭。

【吸引力与去重】
共 ${sectionCount} 个版块；任意两段开头 12 字不得相同；禁止整段复制或只改一两个词；同一平台内第 1 套与第 2 套须换钩子与角度。

【输出格式】
只输出下列标题块，顺序与标题文字必须完全一致；每个标题单独一行，标题下空一行再写正文；勿输出 JSON、前言或后记。

${requiredHeadingsBlock}

【合规】不编造折扣与活动；不医疗功效；信息不够就弱语气带过。`;
}

/** 解析「营销文案」表单：菜名、品牌、推荐理由（兼容旧字段 内容→菜名、备注→推荐理由）；可选 文案套数/套数/几套（1～12，默认 2；每 N 套 = 每平台各 N 条，共 4N 段） */
export function parseFeishuMarketingCopyTemplate(text) {
  const t = String(text || '').trim();
  // 注意：勿用 \b 接在中文「营销文案」后再接换行——JS 词边界在中文与 \\n 之间不成立，会导致整段匹配失败并误入 BI「营销方案」。
  if (!/^\s*营销文案/m.test(t)) return null;
  const pick = (label) => {
    const line = new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, 'im');
    let m = t.match(line);
    if (m) return String(m[1] || '').trim();
    const inline = new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`);
    m = t.match(inline);
    return m ? String(m[1] || '').trim() : '';
  };
  const dishNames = pick('菜名') || pick('内容');
  const brand = pick('品牌');
  const reason = pick('推荐理由') || pick('备注');
  const setRaw = pick('文案套数') || pick('套数') || pick('几套');
  const parsedCount = parseFeishuMarketingCopySetRaw(setRaw);
  const copySetCount = clampFeishuMarketingCopySetCount(parsedCount != null ? parsedCount : FEISHU_MARKETING_COPY_SET_DEFAULT);
  if (!dishNames && !brand && !reason) return null;
  return { dishNames, brand, reason, copySetCount };
}

export function buildFeishuMarketingCopyAckMessage(parsed) {
  const dish = parsed.dishNames || '—';
  const br = parsed.brand || '—';
  const rs = parsed.reason || '—';
  const n = parsed.copySetCount ?? FEISHU_MARKETING_COPY_SET_DEFAULT;
  const { totalBlocks } = buildFeishuMarketingCopyHeadings(n);
  const splitDesc = `每平台各 **${n}** 条，合计 **${totalBlocks}** 段（第 k 套 = 大众点评 + 外卖 + 小红书 + 抖音 各 1 条；外卖=到家，点评=堂食，抖音=短视频脚本）`;
  return (
    '✅ 已收到菜品信息！\n\n' +
    `📋 菜名：${dish}\n` +
    `🏷️ 品牌：${br}\n` +
    `💬 推荐理由：${rs}\n` +
    `🔢 文案套数：**${n}**（${splitDesc}）\n\n` +
    '📸 可继续发送菜品图片（建议2-5张，也可跳过），发完后回复「生成文案」或「生产文案」即可。\n' +
    '（**文案套数：数字**，范围 1～12；不写则默认 2 套 = 每平台 2 条，共 8 段。）\n\n' +
    '回复「取消」可终止本次任务。'
  );
}

