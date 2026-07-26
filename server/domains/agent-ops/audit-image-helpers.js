/**
 * Vision audit helpers (P2 peel from agents.js auditImage).
 */
import fs from 'fs';
import crypto from 'crypto';
import { resolveTenantIdDefault } from '../../utils/database.js';

export const AUDIT_TYPE_PROMPTS = {
  hygiene: `你是餐饮卫生检查专家。严格审核这张图片。如果是手机截图/屏幕录制/非实拍照片/与卫生无关的图片，必须判定fail。只有清晰的餐厅现场卫生实拍照片才可能pass。1.是否为真实卫生相关实拍 2.卫生状况如何 3.给出pass/fail/unclear。JSON回复：{"result":"pass/fail/unclear","confidence":0.0-1.0,"findings":"具体发现","clarity":0.0-1.0}`,
  plating: `你是餐饮出品专家。严格审核这张图片。如果是手机截图/屏幕录制/非实拍照片/与菜品出品无关的图片，必须判定fail。只有清晰的菜品实拍照片才可能pass。1.摆盘是否规范 2.分量是否达标 3.美学标准。JSON回复：{"result":"pass/fail/unclear","confidence":0.0-1.0,"findings":"具体发现","clarity":0.0-1.0}`,
  general: `你是餐饮门店食品安全与卫生审核专家。你的任务是严格审核食安巡检照片。

【必须判定为fail的情况】：
- 手机截图、屏幕录制、非实拍照片
- 与食品安全/卫生/餐饮现场完全无关的照片（如系统界面、聊天记录、风景照等）
- 照片模糊无法辨认内容
- 明显不是在门店现场拍摄的照片

【可以判定为pass的情况】：
- 清晰的餐厅现场实拍照片（厨房、前厅、仓库、冷柜、操作台等）
- 照片中可见真实的食品、餐具、设备等实物

请严格审核，宁可误判为unclear也不要轻易pass。
JSON回复：{"result":"pass/fail/unclear","confidence":0.0-1.0,"findings":"具体发现","type":"照片类型","clarity":0.0-1.0}`,
  seafood_pool_temperature: `你是海鲜池管理专家。审核这张水温计照片：1.温度是否清晰可见 2.温度是否在标准范围内(18-22°C) 3.水温计是否正常工作。JSON回复：{"result":"pass/fail/unclear","confidence":0.0-1.0,"findings":"具体发现","temperature":"数值"}`,
};

export function loadImageBufferForAudit(imageUrl) {
  if (imageUrl.startsWith('/') || imageUrl.startsWith('.')) {
    return fs.readFileSync(imageUrl);
  }
  if (imageUrl.startsWith('data:')) {
    const b64 = imageUrl.split(',')[1] || '';
    return Buffer.from(b64, 'base64');
  }
  return null;
}

export function hashImageBuffer(buf) {
  if (!buf) return '';
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function parseVisionAuditLlmContent(content) {
  let result = 'unclear';
  let confidence = 0;
  let findings = '';
  let agentRaw = {};
  let clarity = 0;
  if (!content) {
    return { result, confidence, findings, agentRaw, clarity };
  }
  try {
    const jsonMatch = String(content).match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = String(parsed.result || 'unclear').trim().toLowerCase();
      confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
      findings = String(parsed.findings || '').trim();
      clarity = Math.max(0, Math.min(1, Number(parsed.clarity || 0)));
      agentRaw = parsed;
    }
  } catch {
    findings = String(content);
  }
  return { result, confidence, findings, agentRaw, clarity };
}

export function applyVisionAuditJudgment({
  result,
  confidence,
  findings,
  clarity,
  duplicateOf,
  config,
  exifData,
  now = new Date(),
}) {
  let outResult = result;
  let outConfidence = confidence;
  let outFindings = findings;

  if (outResult === 'pass' && outConfidence < 0.7) {
    outResult = 'unclear';
    outFindings =
      `照片内容不够明确，无法自动判定合格（置信度${(outConfidence * 100).toFixed(0)}%）。请重新拍摄清晰的现场照片。` +
      (outFindings ? ' 原始分析: ' + outFindings : '');
  }

  if (duplicateOf) {
    outResult = 'fail';
    outFindings = `⚠️ 重复图片（与历史记录重复），疑似作弊。${outFindings ? ' 原始审核: ' + outFindings : ''}`;
    outConfidence = 0.95;
  } else if (clarity < config.visualInspection.accuracyThresholds.labelClarity) {
    outResult = 'fail';
    outFindings = config.judgmentStandards.visualAccuracy.poorQualityResponse;
    outConfidence = 0.9;
  }

  const exifTime = new Date(exifData.timestamp || now);
  const timeDiff = Math.abs(now - exifTime) / 1000;
  if (timeDiff > config.judgmentStandards.authenticity.exifTolerance) {
    outResult = 'fail';
    outFindings = `照片拍摄时间异常（误差${Math.round(timeDiff / 60)}分钟），请重新拍摄。`;
    outConfidence = 0.95;
  }

  return { result: outResult, confidence: outConfidence, findings: outFindings };
}

/**
 * @param {object} deps
 */
export async function auditImageBody(deps, imageUrl, auditType, context = {}) {
  const { pool, log, callVisionLLM, getOpsAgentConfig } = deps;
  const store = context.store || '';
  const brand = context.brand || '';
  const username = context.username || '';
  const config = getOpsAgentConfig();

  let imageHash = '';
  let exifData = {};
  try {
    const buf = loadImageBufferForAudit(imageUrl);
    if (buf) {
      imageHash = hashImageBuffer(buf);
      exifData = { timestamp: new Date().toISOString() };
    }
  } catch {
    /* ignore */
  }

  let duplicateOf = null;
  if (imageHash) {
    try {
      const dup = await pool().query(
        `SELECT id FROM agent_visual_audits WHERE image_hash = $1 LIMIT 1`,
        [imageHash]
      );
      if (dup.rows?.length) duplicateOf = dup.rows[0].id;
    } catch {
      /* ignore */
    }
  }

  const prompt = AUDIT_TYPE_PROMPTS[auditType] || AUDIT_TYPE_PROMPTS.general;
  const llmResult = await callVisionLLM(imageUrl, prompt);

  let parsed;
  if (llmResult.ok && llmResult.content) {
    parsed = parseVisionAuditLlmContent(llmResult.content);
  } else {
    parsed = {
      result: 'unclear',
      confidence: 0,
      findings: `视觉审核API调用失败: ${llmResult.error || '未知错误'}`,
      agentRaw: {},
      clarity: 0,
    };
  }

  const judged = applyVisionAuditJudgment({
    ...parsed,
    duplicateOf,
    config,
    exifData,
  });

  let auditId = null;
  try {
    const r = await pool().query(
      `INSERT INTO agent_visual_audits (store, brand, username, image_url, audit_type, result, confidence, findings, image_hash, duplicate_of, agent_raw, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING id`,
      [
        store,
        brand,
        username,
        imageUrl,
        auditType || 'general',
        judged.result,
        judged.confidence,
        judged.findings,
        imageHash || null,
        duplicateOf || null,
        JSON.stringify(parsed.agentRaw),
        resolveTenantIdDefault(),
      ]
    );
    auditId = r.rows?.[0]?.id || null;
  } catch (e) {
    log.error('[ops_supervisor] insert audit failed:', e?.message);
  }

  return {
    auditId,
    result: judged.result,
    confidence: judged.confidence,
    findings: judged.findings,
    duplicate: !!duplicateOf,
    imageHash,
    clarity: parsed.clarity,
  };
}
