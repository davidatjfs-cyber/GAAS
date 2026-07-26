/**
 * Feishu marketing-copy generation / round handler (P2 peel from agents.js).
 */
import {
  FEISHU_MARKETING_COPY_ROLES,
  FEISHU_MARKETING_COPY_TTL_MS,
  FEISHU_MARKETING_PLATFORMS_PER_SET,
  buildFeishuMarketingCopyAckMessage,
  buildFeishuMarketingCopyHeadings,
  buildFeishuMarketingCopySystemPrompt,
  clampFeishuMarketingCopySetCount,
  parseFeishuMarketingCopyTemplate,
} from './marketing-copy-helpers.js';

export async function runFeishuMarketingCopyGeneration(deps, sess, feishuUser) {
  const { callLLM, callVisionLLM } = deps;

  const { params, imageUrls, role } = sess;
  const copySetCount = clampFeishuMarketingCopySetCount(params?.copySetCount);
  const { lines: headingLines } = buildFeishuMarketingCopyHeadings(copySetCount);
  const requiredHeadingsBlock = headingLines.join('\n');
  const sectionCount = headingLines.length;

  const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 6);
  let visualNotes = '（本次未上传图片，仅根据文字信息创作。）';
  if (urls.length) {
    const visionContent = [];
    for (const url of urls) {
      visionContent.push({ type: 'image_url', image_url: { url: String(url) } });
    }
    visionContent.push({
      type: 'text',
      text: '你是餐饮菜品视觉分析员。请综合以上图片，用中文简洁列出：可见的菜品或食材、色泽摆盘、适合顾客感知的卖点（不超过220字）。不要编造图片中不存在的配料或价格。'
    });
    const vis = await callVisionLLM(visionContent, '');
    const v = String(vis?.content || '').trim();
    if (v) visualNotes = v;
  }
  const totalBlocks = copySetCount * FEISHU_MARKETING_PLATFORMS_PER_SET;
  const brief = [
    `菜名：${params.dishNames || '-'}`,
    `品牌：${params.brand || '-'}`,
    `推荐理由：${params.reason || '-'}`,
    `文案套数：${copySetCount}（每平台各 ${copySetCount} 条，共 ${totalBlocks} 段；平台顺序每轮：大众点评→外卖→小红书→抖音；商家视角；点评=堂食、外卖=到家、小红书=笔记、抖音=短视频脚本；禁止承诺具体赞评数）`
  ].join('\n');
  const senderRole = String(role || feishuUser?.role || '').trim() || 'hq_manager';
  const maxTokens = Math.min(8192, 900 + copySetCount * FEISHU_MARKETING_PLATFORMS_PER_SET * 280);
  const r = await callLLM(
    [
      {
        role: 'system',
        content: buildFeishuMarketingCopySystemPrompt(requiredHeadingsBlock, sectionCount)
      },
      {
        role: 'user',
        content: `菜品与品牌信息：\n${brief}\n\n图片要点：\n${visualNotes}\n\n请严格按 ${sectionCount} 个标题依次输出；每条须符合对应平台的体裁与流量设计（点评堂食、外卖到家、小红书笔记、抖音短视频脚本），禁止漏块、禁止跨平台混用场景与话术。`
      }
    ],
    {
      role: senderRole,
      purpose: 'reasoning',
      temperature: 0.58,
      max_tokens: maxTokens,
      skipCache: true,
      timeout: 150000
    }
  );
  return String(r?.content || '').trim() || '生成结果为空，请重试。';
}

/**
 * 在飞书单聊中处理「营销文案」多轮流程；需在 `!text && !imageUrls` 短路之前调用。
 * @returns {Promise<{ handled: boolean, body?: object }|null>}
 */
export async function tryFeishuMarketingCopyRoundBody(deps, sessions, { openId, feishuUser, text, imageUrls }) {
  const { sendLarkMessage, prefixWithAgentName, callLLM, callVisionLLM, log } = deps;

  const key = String(openId || '').trim();
  if (!key) return null;
  const role = String(feishuUser?.role || '').trim();
  let pending = sessions.get(key);
  const now = Date.now();
  if (pending && now - pending.ts > FEISHU_MARKETING_COPY_TTL_MS) {
    sessions.delete(key);
    pending = null;
  }

  const t = String(text || '').trim();
  const imgs = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];

  if (!pending && t) {
    const parsed = parseFeishuMarketingCopyTemplate(t);
    if (!parsed) return null;
    if (!FEISHU_MARKETING_COPY_ROLES.has(role)) {
      await sendLarkMessage(
        openId,
        prefixWithAgentName(
          'master',
          '⚠️ 营销文案生成功能对以下角色开放：管理员、总部营运、门店店长、出品经理。如需权限请在 HRMS 中核对岗位角色。'
        ),
        { skipDedup: true }
      );
      return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'denied' } };
    }
    sessions.set(key, {
      ts: now,
      role,
      username: feishuUser?.username,
      params: parsed,
      imageUrls: []
    });
    await sendLarkMessage(openId, prefixWithAgentName('master', buildFeishuMarketingCopyAckMessage(parsed)), {
      skipDedup: true
    });
    return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'started' } };
  }

  if (!pending) return null;

  // 勿用 \b 接在中文后——JS 词边界对汉字不成立，会导致「取消」匹配失败。
  if (/^(取消|不做了|放弃)\s*$/.test(t)) {
    sessions.delete(key);
    await sendLarkMessage(openId, prefixWithAgentName('master', '已取消本次营销文案任务。'), { skipDedup: true });
    return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'cancelled' } };
  }

  if (imgs.length) {
    const set = new Set(pending.imageUrls || []);
    for (const u of imgs) set.add(u);
    pending.imageUrls = [...set];
    pending.ts = now;
    sessions.set(key, pending);
    await sendLarkMessage(
      openId,
      prefixWithAgentName(
        'master',
        `📸 已收到本批 ${imgs.length} 张图，累计 **${pending.imageUrls.length}** 张（建议 2～5 张即可）。\n可直接回复 **「生成文案」** 或 **「生产文案」**；也可继续发图后再生成。`
      ),
      { skipDedup: true }
    );
    return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'photos' } };
  }

  const isGenTrigger =
    /^(生成文案|生产文案|开始生成|生成|可以生成了|好了)\s*$/.test(t) ||
    /生成营销文案|生产营销文案|生成.*文案|生产.*文案/.test(t);
  if (isGenTrigger) {
    try {
      const out = await runFeishuMarketingCopyGeneration(
        { callLLM, callVisionLLM },
        pending,
        feishuUser
      );
      sessions.delete(key);
      const clipped = out.length > 16000 ? `${out.slice(0, 16000)}\n\n…（内容过长已截断，可减少「文案套数」或缩短菜名后重试）` : out;
      await sendLarkMessage(openId, prefixWithAgentName('master', clipped), { skipDedup: true });
    } catch (e) {
      log.error('[feishu] marketing copy generation error:', e?.message || e);
      await sendLarkMessage(
        openId,
        prefixWithAgentName('master', '营销文案生成失败，请稍后重试或减少图片数量。'),
        { skipDedup: true }
      );
    }
    return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'done' } };
  }

  if (t) {
    await sendLarkMessage(
      openId,
      prefixWithAgentName(
        'master',
        '当前有一条进行中的「营销文案」任务：可继续发菜品图（也可不发），准备好后回复「生成文案」或「生产文案」。回复「取消」可退出。'
      ),
      { skipDedup: true }
    );
    return { handled: true, body: { ok: true, route: 'master', marketingCopy: 'hint' } };
  }

  return null;
}
