import { createDecipheriv } from 'crypto';

export function tryParseJson(input) {
  try {
    if (!input) return null;
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

export function decryptFeishuEncryptPayload(encryptValue, encryptKey) {
  if (!encryptKey) throw new Error('missing_feishu_encrypt_key');
  const cipherBuf = Buffer.from(String(encryptValue || ''), 'base64');
  if (!cipherBuf.length) throw new Error('invalid_encrypt_payload');

  let keyBuf = Buffer.from(String(encryptKey || ''), 'base64');
  if (keyBuf.length !== 32) {
    keyBuf = Buffer.from(String(encryptKey || ''), 'utf8');
    if (keyBuf.length < 32) {
      keyBuf = Buffer.concat([keyBuf, Buffer.alloc(32 - keyBuf.length)]);
    }
    if (keyBuf.length > 32) keyBuf = keyBuf.subarray(0, 32);
  }
  const iv = keyBuf.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', keyBuf, iv);
  let decrypted = decipher.update(cipherBuf, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
