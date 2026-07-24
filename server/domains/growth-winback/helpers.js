export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}
