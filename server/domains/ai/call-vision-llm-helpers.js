/**
 * Vision / video LLM helpers (P2 peel from agents.js).
 */
import fs from 'fs';
import path from 'path';
import {
  getLLMClientConfig,
  isRetryableLLMError,
  sleep,
} from './llm-provider-helpers.js';

/**
 * Build OpenAI-compatible vision content parts from imageUrl + prompt.
 * @returns {{ content: object[] } | { early: object }}
 */
export function buildVisionContentParts(imageUrl, prompt, io = { readFileSync: fs.readFileSync, extname: path.extname }) {
  const content = [];
  if (Array.isArray(imageUrl)) {
    for (const item of imageUrl) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text') {
        content.push({ type: 'text', text: String(item.text || '').trim() });
      } else if (item.type === 'image' && item.image_url) {
        content.push({ type: 'image_url', image_url: { url: String(item.image_url) } });
      } else if (item.type === 'image_url') {
        const url = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url;
        if (url) content.push({ type: 'image_url', image_url: { url: String(url) } });
      }
    }
  } else {
    const imagePath = String(imageUrl || '').trim();
    let imageContent;
    if (imagePath.startsWith('data:') || imagePath.startsWith('http')) {
      imageContent = { type: 'image_url', image_url: { url: imagePath } };
    } else {
      const buf = io.readFileSync(imagePath);
      const b64 = buf.toString('base64');
      const ext = io.extname(imagePath).replace('.', '') || 'jpeg';
      imageContent = {
        type: 'image_url',
        image_url: { url: `data:image/${ext};base64,${b64}` },
      };
    }
    content.push(imageContent);
    if (prompt) content.push({ type: 'text', text: String(prompt) });
  }

  if (!content.length && prompt) content.push({ type: 'text', text: String(prompt) });
  if (!content.length) return { early: { ok: false, error: 'invalid_vision_input', content: '' } };
  return { content };
}

/**
 * Extract text content from DashScope multimodal native response.
 */
export function extractDashScopeMultimodalText(output) {
  if (!output) return '';
  const msg = output.choices?.[0]?.message;
  if (Array.isArray(msg?.content)) {
    return msg.content.map((c) => c.text || '').join('').trim();
  }
  if (typeof msg?.content === 'string') return msg.content;
  return '';
}

/**
 * @param {object} deps
 * @param {unknown} imageUrl
 * @param {string} prompt
 * @param {object} [opts]
 */
export async function callVisionLLMBody(deps, imageUrl, prompt, opts = {}) {
  const { loadTenantAiConfig, getOpsVisionModel, axios, trackLLMResult, log } = deps;
  const tenantCfg = await loadTenantAiConfig('vision_scoring');
  const model = tenantCfg ? tenantCfg.model : getOpsVisionModel();
  const cfg = tenantCfg || getLLMClientConfig(model, { forceProvider: 'doubao' });
  const apiKey = cfg.apiKey;
  if (!apiKey) return { ok: false, error: 'no_api_key', content: '' };
  const maxTokens = Math.max(256, Math.min(16384, Number(opts.maxTokens ?? opts.max_tokens ?? 1500)));
  try {
    const built = buildVisionContentParts(imageUrl, prompt);
    if (built.early) return built.early;
    const { content } = built;

    let resp = null;
    let lastErr = null;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        resp = await axios.post(
          `${cfg.baseUrl}/chat/completions`,
          {
            model: cfg.model,
            messages: [{ role: 'user', content }],
            temperature: 0.2,
            max_tokens: maxTokens,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 90000,
          }
        );
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts && isRetryableLLMError(e)) {
          const waitMs = 800 * attempt;
          log.warn(
            `[agents] callVisionLLM transient error (attempt ${attempt}/${maxAttempts}), retry in ${waitMs}ms:`,
            e?.message || e
          );
          await sleep(waitMs);
          continue;
        }
      }
    }
    if (!resp) throw lastErr || new Error('vision_request_failed');
    trackLLMResult(true);
    return { ok: true, content: resp.data?.choices?.[0]?.message?.content || '', raw: resp.data };
  } catch (e) {
    trackLLMResult(false);
    log.error('[agents] callVisionLLM error:', e?.message || e);
    return { ok: false, error: String(e?.message || e), content: '' };
  }
}

/**
 * @param {object} deps
 * @param {string} videoUrl
 * @param {string} prompt
 * @param {object} [opts]
 */
export async function callVisionLLMVideoBody(deps, videoUrl, prompt, opts = {}) {
  const { loadTenantAiConfig, axios, trackLLMResult, log } = deps;

  // 租户自带 AI（通用 OpenAI 兼容端点）不支持 DashScope 专有的原生视频分析格式；
  // 直接跳过，让调用方走已有的"抽帧再走 callVisionLLM"回退路径（那条路径已接入租户配置）。
  if (await loadTenantAiConfig('vision_scoring')) {
    return { ok: false, error: 'tenant_custom_ai_no_native_video', content: '' };
  }
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'no_qwen_api_key', content: '' };
  }
  if (!videoUrl) {
    return { ok: false, error: 'no_video_url', content: '' };
  }
  const maxTokens = Math.max(256, Math.min(8192, Number(opts.maxTokens ?? opts.max_tokens ?? 3000)));

  try {
    const resp = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        model: 'qwen-vl-max',
        input: {
          messages: [
            {
              role: 'user',
              content: [{ video: String(videoUrl) }, { text: String(prompt) }],
            },
          ],
        },
        parameters: { max_tokens: maxTokens, temperature: 0.2 },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 300000,
      }
    );
    const content = extractDashScopeMultimodalText(resp.data?.output);
    trackLLMResult(true);
    return { ok: true, content, raw: resp.data };
  } catch (e) {
    trackLLMResult(false);
    log.error('[agents] callVisionLLMVideo error (native API):', e?.message);
  }

  try {
    const cfg = getLLMClientConfig('qwen-vl-max', { forceProvider: 'doubao' });
    const resp = await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      {
        model: cfg.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'video_url', video_url: { url: String(videoUrl) } },
              { type: 'text', text: String(prompt) },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 300000,
      }
    );
    trackLLMResult(true);
    return {
      ok: true,
      content: resp.data?.choices?.[0]?.message?.content || '',
      raw: resp.data,
    };
  } catch (e) {
    trackLLMResult(false);
    log.error('[agents] callVisionLLMVideo error (compatible API):', e?.message);
    return { ok: false, error: String(e?.message || e), content: '' };
  }
}
