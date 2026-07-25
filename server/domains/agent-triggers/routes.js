/**
 * Agent 手动触发 / 诊断测试路由（从 agents.js#registerAgentRoutes Group E 外提）。
 */
import {
  isTriggerAdminRole,
  isTriggerHqRole,
  matchRouteKeywords,
  maskTokenPreview,
  runManualAudit,
  runStoreRatingsRecalc,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: () => import('pg').Pool,
 *   runDataAuditor: Function,
 *   pushIssuesToFeishu: Function,
 *   syncDataAuditorIssuesToMasterTasks: Function,
 *   runChiefEvaluator: Function,
 *   pushScoresToFeishu: Function,
 *   sendLarkMessage: Function,
 *   callVisionLLM: Function,
 *   callLLM: Function,
 *   verifyLLMHealth: Function,
 *   getLarkTenantToken: Function,
 *   routeMessage: Function,
 *   inferBrandFromStoreName: Function,
 *   calculateStoreRating: Function,
 *   defaultLlmModel: string,
 * }} deps
 */
export function registerAgentTriggersRoutes(app, authRequired, deps) {
  const {
    pool,
    runDataAuditor,
    pushIssuesToFeishu,
    syncDataAuditorIssuesToMasterTasks,
    runChiefEvaluator,
    pushScoresToFeishu,
    sendLarkMessage,
    callVisionLLM,
    callLLM,
    verifyLLMHealth,
    getLarkTenantToken,
    routeMessage,
    inferBrandFromStoreName,
    calculateStoreRating,
    defaultLlmModel,
  } = deps;

  app.post('/api/agents/run/audit', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const payload = await runManualAudit({
        mode: req.body?.mode,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        runDataAuditor,
        pushIssuesToFeishu,
        syncDataAuditorIssuesToMasterTasks,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/run/store-ratings', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const payload = await runStoreRatingsRecalc(pool(), {
        period: req.body?.period,
        inferBrandFromStoreName,
        calculateStoreRating,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/run/evaluate', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const period = String(req.body?.period || '').trim();
    if (!period) return res.status(400).json({ error: 'missing_period' });
    try {
      const result = await runChiefEvaluator(
        period,
        req.tenantId || req.user?.tenant_id || 'default'
      );
      const pushed = await pushScoresToFeishu();
      return res.json({ ...result, feishuPushed: pushed });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/test-feishu', authRequired, async (req, res) => {
    if (!isTriggerAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const openId = String(req.body?.openId || '').trim();
    const text = String(req.body?.text || 'HRMS Agent 测试消息').trim();
    if (!openId) return res.status(400).json({ error: 'missing_openId' });
    try {
      return res.json(await sendLarkMessage(openId, text));
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/test-vision', authRequired, async (req, res) => {
    if (!isTriggerAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const imageUrl = String(req.body?.imageUrl || '').trim();
    const prompt = String(
      req.body?.prompt || '请识别这张图片中的内容，判断是否为餐厅厨房环境或整改照片'
    ).trim();
    if (!imageUrl) return res.status(400).json({ error: 'missing_imageUrl' });
    try {
      const result = await callVisionLLM(imageUrl, prompt);
      return res.json({ ok: result.ok, content: result.content, error: result.error || null });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/test-llm', authRequired, async (req, res) => {
    if (!isTriggerAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const prompt = String(req.body?.prompt || '请用一句话介绍潮汕菜的特点').trim();
    const model = String(req.body?.model || defaultLlmModel || '').trim() || defaultLlmModel;
    try {
      const result = await callLLM([{ role: 'user', content: prompt }], {
        model,
        temperature: 0,
        max_tokens: 120,
        skipCache: true,
      });
      return res.json({
        ok: result.ok,
        model,
        content: result.content,
        error: result.error || null,
      });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/llm-health-check', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const result = await verifyLLMHealth({
        notifyOnFailure: true,
        notifyOnRecovery: true,
        forceNotify: true,
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/feishu-token-test', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const token = await getLarkTenantToken();
      if (!token) {
        return res.json({
          ok: false,
          error: 'no_token — check LARK_APP_ID / LARK_APP_SECRET in .env',
        });
      }
      return res.json({
        ok: true,
        token: maskTokenPreview(token),
        length: token.length,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/feishu-send-test', authRequired, async (req, res) => {
    if (!isTriggerHqRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const openId = String(req.body?.openId || '').trim();
    const message = String(req.body?.message || 'HRMS Agent 测试消息').trim();
    if (!openId) return res.status(400).json({ error: 'missing openId' });
    try {
      return res.json(await sendLarkMessage(openId, message));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/route-test', authRequired, async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const hasImage = !!req.body?.hasImage;
    const route = await routeMessage(text, hasImage, String(req.user?.username || '').trim());
    return res.json({
      route,
      text,
      hasImage,
      matchedKeywords: matchRouteKeywords(text),
    });
  });
}
