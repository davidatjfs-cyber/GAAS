/**
 * 结构化日志（pino）。与 agents-service-v2 对齐：JSON 行日志 + 可选 pretty。
 * 不要求一次清掉全部 console.*——入口 HTTP 与错误/进程路径先接上即可。
 */
import pino from 'pino';

const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'development';
const isProd = APP_ENV === 'production';
// 默认 JSON 行日志（生产/CI/测试一致）；本地可读性靠 LOG_PRETTY=1 显式打开。
const wantPretty = process.env.LOG_PRETTY === '1';

/** @type {import('pino').LoggerOptions} */
const options = {
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: {
    service: 'hrms-service',
    env: APP_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'password',
      'password_hash',
      'token',
      'access_token',
      'refresh_token',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.secret',
      '*.api_key',
    ],
    censor: '[Redacted]',
  },
};

if (wantPretty) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(options);

/** @param {Record<string, unknown>} [bindings] */
export function childLogger(bindings = {}) {
  return logger.child(bindings);
}

const QUIET_PATH_RE = /^\/(health|favicon\.ico|assets\/|sw\.js)/i;

/**
 * HTTP 访问日志：依赖先挂上的 req.requestId；auth 之后 finish 时带 tenant/username。
 * @param {import('pino').Logger} [root]
 */
export function createHttpAccessLogger(root = logger) {
  return function httpAccessLogger(req, res, next) {
    const start = process.hrtime.bigint();
    const requestId = req.requestId || null;
    req.log = root.child({ request_id: requestId });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const rawUrl = String(req.originalUrl || req.url || '');
      const pathOnly = rawUrl.split('?')[0] || '/';
      const status = res.statusCode || 0;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      if (level === 'info' && QUIET_PATH_RE.test(pathOnly)) return;

      req.log[level]({
        msg: 'http_request',
        method: req.method,
        path: pathOnly,
        status,
        duration_ms: Math.round(durationMs * 10) / 10,
        tenant_id: req.tenantId || req.user?.tenant_id || null,
        username: req.user?.username || req.platformAdmin?.username || null,
      });
    });

    next();
  };
}
