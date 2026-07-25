import { logger } from '../../utils/logger.js';

export function createUnhandledRejectionHandler({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH }) {
  let _lastRejectionAlertAt = 0;
  const _rejectionAlertCooldownMs = 15 * 60 * 1000;
  return (reason, _promise) => {
    const detail = reason instanceof Error ? reason.stack : String(reason);
    logger.error({ err: reason, msg: 'unhandled_rejection' });
    const now = Date.now();
    if (now - _lastRejectionAlertAt > _rejectionAlertCooldownMs) {
      _lastRejectionAlertAt = now;
      sendLarkMessage(
        FEISHU_ALERT_ADMIN_HEALTH,
        `⚠️【HRMS 未处理的Promise异常】\n\n${String(detail || '').slice(0, 800)}\n\n（15分钟内只告警一次，日志里可能还有更多同类异常，请查看服务器日志确认。）`,
        { skipDedup: true }
      ).catch((e) => logger.error({ err: e, msg: 'unhandled_rejection_alert_failed' }));
    }
  };
}

export function createUncaughtExceptionHandler({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH }) {
  return (err) => {
    const detail = err instanceof Error ? err.stack : String(err);
    logger.fatal({ err, msg: 'uncaught_exception' });
    const alertPromise = sendLarkMessage(
      FEISHU_ALERT_ADMIN_HEALTH,
      `🚨【HRMS 进程崩溃】\n\n${String(detail || '').slice(0, 800)}\n\n进程即将重启(PM2)，如果频繁重启请立即排查。`,
      { skipDedup: true }
    ).catch((e) => logger.error({ err: e, msg: 'uncaught_exception_alert_failed' }));
    Promise.race([alertPromise, new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(1));
  };
}

export function registerProcessGuards({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH }) {
  process.on('unhandledRejection', createUnhandledRejectionHandler({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH }));
  process.on('uncaughtException', createUncaughtExceptionHandler({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH }));
}
