/**
 * AI OpenAI-compatible chat-completions proxy (behavior-preserving extract from index.js).
 */

/**
 * Normalize OpenAI-compatible API base URLs (incl. Volcengine Ark quirks).
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeOpenAiCompatibleBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const noSlash = raw.replace(/\/+$/, '');
  if (/ark\.cn-beijing\.volces\.com/i.test(noSlash)) {
    if (/\/api\/v3$/i.test(noSlash)) return noSlash;
    if (/\/v1$/i.test(noSlash)) return noSlash.replace(/\/v1$/i, '/api/v3');
    return `${noSlash}/api/v3`;
  }
  if (/\/v1$/i.test(noSlash)) return noSlash;
  return `${noSlash}/v1`;
}

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerAiChatCompletionsRoutes(app, authRequired) {
  app.post('/api/ai/chat-completions', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const baseUrl = normalizeOpenAiCompatibleBaseUrl(req.body?.baseUrl || req.body?.apiUrl || '');
    const apiKey = String(req.body?.apiKey || '').trim();
    const model = String(req.body?.model || '').trim();
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const maxTokens = Math.max(1, Math.min(4000, Number(req.body?.max_tokens || req.body?.maxTokens || 1024) || 1024));
    const temperature = Number(req.body?.temperature);

    if (!baseUrl) return res.status(400).json({ error: 'missing_base_url' });
    if (!apiKey) return res.status(400).json({ error: 'missing_api_key' });
    if (!model) return res.status(400).json({ error: 'missing_model' });
    if (!messages.length) return res.status(400).json({ error: 'missing_messages' });

    const payload = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: Number.isFinite(temperature) ? temperature : 0.2
    };

    const controller = new AbortController();
    /** 出题/长上下文等场景上游常 >25s；过短会 502 + 浏览器 aborted */
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await upstream.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { /* ignore */ }
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: 'upstream_error',
          message: String(data?.error?.message || data?.message || text || `HTTP ${upstream.status}`),
          upstreamStatus: upstream.status
        });
      }
      if (data && typeof data === 'object') return res.json(data);
      return res.json({ raw: text });
    } catch (e) {
      return res.status(502).json({ error: 'upstream_unreachable', message: 'internal_error' });
    } finally {
      clearTimeout(timer);
    }
  });
}
