/**
 * Upload / object-storage Content-Type + Content-Disposition helpers.
 */
import path from 'path';

export function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(String(str || ''))
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (m) => m.toLowerCase());
}

export function buildInlineContentDisposition(filename) {
  const name = String(filename || '').trim() || 'file';
  const encoded = encodeRFC5987ValueChars(name);
  return `inline; filename*=UTF-8''${encoded}`;
}

export function inferContentType({ declaredType, originalName, mimeType }) {
  const t = String(declaredType || '').trim().toLowerCase();
  const orig = String(originalName || '').trim();
  const ext = path.extname(orig).toLowerCase();
  const mt = String(mimeType || '').trim().toLowerCase();

  if (mt && mt !== 'application/octet-stream') return mt;

  if (t === 'pdf' || ext === '.pdf') return 'application/pdf';
  if (t === 'video' || ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (t === 'img' || ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';

  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return 'application/octet-stream';
}
