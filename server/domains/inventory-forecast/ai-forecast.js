export function normalizeArkBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'https://ark.cn-beijing.volces.com/api/v3';
  const noSlash = raw.replace(/\/$/, '');
  if (/ark\.cn-beijing\.volces\.com/i.test(noSlash)) {
    if (/\/api\/v3$/i.test(noSlash)) return noSlash;
    return `${noSlash}/api/v3`;
  }
  return noSlash;
}

/**
 * 从租户自己在 HRMS「系统设置 → AI 配置」里填的模型/绑定（state0.settings.llm，多模型+
 * 按功能绑定的新格式）解析出应该用哪个模型；跟下面这套环境变量/aiConfig 兜底逻辑
 * （default 租户目前用的旧单模型格式）是两条独立路径，新格式没配置时完全走旧逻辑。
 */
export function resolveTenantAiConfigFromState(state0, featureKey = 'default') {
  const llm = state0?.settings?.llm;
  if (!llm || typeof llm !== 'object') return null;
  const models = Array.isArray(llm.models) ? llm.models : [];
  if (!models.length) return null; // 旧单模型格式走下面现有兜底链，不在这里处理
  const bindings = llm.bindings || {};
  const key = String(featureKey || 'default').trim() || 'default';
  const boundId = String(bindings?.[key] || bindings?.default || '').trim();
  let m = models.find((x) => x?.id === boundId && x?.enabled !== false);
  if (!m) m = models.find((x) => x?.enabled !== false);
  if (!m?.apiKey || !m?.baseUrl || !m?.model) return null;
  return { apiKey: String(m.apiKey).trim(), baseUrl: normalizeArkBaseUrl(m.baseUrl), model: String(m.model).trim() };
}

export async function resolveForecastArkConfig(state0, opts = {}) {
  const tenantCfg = resolveTenantAiConfigFromState(state0, opts.preferVision ? 'vision_scoring' : 'default');
  if (tenantCfg) return tenantCfg;

  const preferVision = !!opts.preferVision;
  const llm = state0?.settings?.llm && typeof state0.settings.llm === 'object' ? state0.settings.llm : {};
  const aiConfig = state0?.aiConfig && typeof state0.aiConfig === 'object' ? state0.aiConfig : {};
  const endpointId = String(
    process.env.ARK_ENDPOINT_ID
      || process.env.INVENTORY_FORECAST_ENDPOINT_ID
      || llm.endpointId
      || aiConfig.endpointId
      || ''
  ).trim();
  const modelRaw = String(
    (preferVision ? process.env.ARK_VISION_MODEL : '')
      || process.env.INVENTORY_FORECAST_MODEL
      || process.env.ARK_MODEL
      || llm.model
      || aiConfig.model
      || ''
  ).trim();
  const model = /^ep-/i.test(endpointId)
    ? endpointId
    : (/^ep-/i.test(modelRaw) ? modelRaw : 'ep-20260217191023-bjlrn');
  const apiKey = String(
    process.env.ARK_API_KEY
      || process.env.INVENTORY_FORECAST_API_KEY
      || process.env.FORECAST_API_KEY
      || process.env.OPENAI_API_KEY
      || llm.apiKey
      || aiConfig.apiKey
      || ''
  ).trim();
  const baseUrl = normalizeArkBaseUrl(
    process.env.INVENTORY_FORECAST_API_BASE
      || process.env.ARK_API_BASE
      || llm.baseUrl
      || aiConfig.apiUrl
      || 'https://ark.cn-beijing.volces.com'
  );
  return { apiKey, baseUrl, model };
}

export function createAiForecastHelpers({ isExcludedForecastProduct }) {
  async function buildForecastByAI({ historyRows, target, topN, state0 }) {
    const cfg = await resolveForecastArkConfig(state0 || {}, { preferVision: false });
    const apiKey = cfg.apiKey;
    if (!apiKey) return null;

    const baseUrl = cfg.baseUrl;
    const model = cfg.model;
    const rows = (Array.isArray(historyRows) ? historyRows : []).slice(0, 200);
    if (!rows.length) return null;

    const prompt = [
      '你是专业的餐饮门店备货预测AI助手。',
      '请仅输出 JSON，不要输出任何额外解释文字。',
      'JSON 格式：',
      '{"predictions":[{"product":"产品名","qty":12.3,"reason":"简短原因"}],"summary":"一句话总结","confidence":0.78}',
      '',
      '规则：',
      '1) predictions 只包含具体菜品产品，qty 为预测销售数量（非负数字），按 qty 降序排列；',
      '2) 【最重要】目标条件中的 expectedRevenue 是该时段（非全天）的预计营收。对比目标营收与历史同时段营收，按比例调整每个菜品的预测销量；',
      '3) 同时分析：目标日期是星期几、天气状况、是否假日，与历史同类条件下的销售数据对比；天气不能直接做固定比例加减，销量应主要由目标营收和历史样本决定；',
      `4) 只输出销量排名前 ${Math.min(topN || 20, 20)} 名的产品；`,
      '5) qty 必须是合理的整数或一位小数，不能为0；',
      '',
      '目标条件：',
      JSON.stringify(target),
      '',
      `历史销售样本（共${rows.length}条）：`,
      JSON.stringify(rows)
    ].filter(Boolean).join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      if (!resp.ok) {
        const tx = await resp.text().catch(() => '');
        throw new Error(`forecast_ai_http_${resp.status}:${tx.slice(0, 240)}`);
      }
      const data = await resp.json();
      const content = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!content) throw new Error('forecast_ai_empty');
      const jsonTextMatch = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonTextMatch ? jsonTextMatch[0] : content);
      const arr = Array.isArray(parsed?.predictions) ? parsed.predictions : [];
      const predictions = arr
        .map((x) => ({
          product: String(x?.product || '').trim(),
          qty: Number(Number(x?.qty || 0).toFixed(2)),
          reason: String(x?.reason || '').trim()
        }))
        .filter((x) => x.product && Number.isFinite(x.qty) && x.qty >= 0 && !isExcludedForecastProduct(x.product))
        .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
        .slice(0, Math.max(5, Math.min(80, Number(topN || 20) || 20)));
      const confidenceRaw = Number(parsed?.confidence);
      const confidence = Number.isFinite(confidenceRaw)
        ? Number(Math.max(0.05, Math.min(0.99, confidenceRaw)).toFixed(2))
        : 0.72;
      const summary = String(parsed?.summary || '').trim();
      return { predictions, confidence, summary };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    normalizeArkBaseUrl,
    resolveTenantAiConfigFromState,
    resolveForecastArkConfig,
    buildForecastByAI,
  };
}
