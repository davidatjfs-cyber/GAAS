/**
 * 登录限流（商业化安全止血 A3）
 * 无 express-rate-limit 依赖：内存滑动窗口，按 IP + username + tenant 计数。
 * 阈值可用 LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW_MS 覆盖。
 */
const hits = new Map();

function cleanupExpired(now, windowMs) {
  if (hits.size < 5000) return;
  for (const [key, timestamps] of hits) {
    const kept = timestamps.filter((t) => now - t < windowMs);
    if (!kept.length) hits.delete(key);
    else hits.set(key, kept);
  }
}

export function createLoginRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs || process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
  const max = Number(options.max || process.env.LOGIN_RATE_LIMIT_MAX || 20);

  return function loginRateLimit(req, res, next) {
    const now = Date.now();
    cleanupExpired(now, windowMs);
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').replace('::ffff:', '');
    const username = String(req.body?.username || '').trim().toLowerCase() || '-';
    const tenantId = String(req.body?.tenant_id || req.body?.tenantId || req.query?.tenant_id || 'default').trim() || 'default';
    const key = `${ip}|${tenantId}|${username}`;
    const prev = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (prev.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'too_many_login_attempts', message: '登录尝试过于频繁，请稍后再试' });
    }
    // 只统计失败的登录尝试，避免同一账号被多台设备正常登录（如门店共用账号）时误触发限流
    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
        list.push(now);
        hits.set(key, list);
      }
    });
    return next();
  };
}

/** 测试用：清空计数 */
export function _resetLoginRateLimitForTests() {
  hits.clear();
}
