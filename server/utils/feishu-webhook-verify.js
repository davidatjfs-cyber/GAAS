/**
 * 飞书/Lark 事件订阅签名校验（商业化安全止血 A4）
 * 算法：sha256(timestamp + nonce + encrypt_key + rawBody) === X-Lark-Signature
 * 另支持 Verification Token 明文校验（body.token / header.token）。
 */
import { createHash, timingSafeEqual } from 'crypto';

function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function computeFeishuSignature({ timestamp, nonce, encryptKey, rawBody }) {
  const prefix = `${String(timestamp || '')}${String(nonce || '')}${String(encryptKey || '')}`;
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return createHash('sha256').update(Buffer.concat([Buffer.from(prefix, 'utf8'), bodyBuf])).digest('hex');
}

/**
 * @returns {{ ok: boolean, reason?: string, mode?: string }}
 */
export function verifyFeishuWebhookRequest({
  headers = {},
  rawBody,
  parsedBody,
  encryptKey,
  verificationToken,
  requireSignature = false,
}) {
  const h = headers || {};
  const timestamp = String(h['x-lark-request-timestamp'] || h['x-lark-timestamp'] || '').trim();
  const nonce = String(h['x-lark-request-nonce'] || h['x-lark-nonce'] || '').trim();
  const signature = String(h['x-lark-signature'] || '').trim();
  const key = String(encryptKey || '').trim();
  const vtoken = String(verificationToken || '').trim();

  // URL challenge 常无签名头；若强制签名且无 encrypt key，仍允许 challenge 通过（否则无法配置 webhook）
  const isChallenge =
    parsedBody?.type === 'url_verification' ||
    (parsedBody?.challenge && !parsedBody?.header?.event_type);

  if (signature && key && timestamp && nonce) {
    const expected = computeFeishuSignature({ timestamp, nonce, encryptKey: key, rawBody });
    if (!safeEqualHex(expected, signature)) {
      return { ok: false, reason: 'bad_signature', mode: 'signature' };
    }
    return { ok: true, mode: 'signature' };
  }

  if (vtoken) {
    const bodyToken = String(
      parsedBody?.token ||
      parsedBody?.header?.token ||
      parsedBody?.event?.token ||
      ''
    ).trim();
    if (bodyToken) {
      if (!safeEqualHex(bodyToken, vtoken)) {
        return { ok: false, reason: 'bad_verification_token', mode: 'token' };
      }
      return { ok: true, mode: 'token' };
    }
  }

  if (requireSignature) {
    if (isChallenge && !signature) {
      // 首次配置 challenge：无签名时依赖后续 decrypt + token；此处不硬拒
      return { ok: true, mode: 'challenge_open' };
    }
    if (!key && !vtoken) {
      return { ok: false, reason: 'missing_verify_secrets', mode: 'none' };
    }
    if (!signature && !vtoken) {
      return { ok: false, reason: 'missing_signature', mode: 'none' };
    }
    // 有 verification token 配置但 body 无 token（加密包未解密前）——签名路径应优先
    if (key && !signature) {
      return { ok: false, reason: 'missing_signature', mode: 'none' };
    }
  }

  return { ok: true, mode: 'skipped' };
}

export function requireWebhookSignatureEnabled() {
  const v = String(process.env.REQUIRE_WEBHOOK_SIGNATURE || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
