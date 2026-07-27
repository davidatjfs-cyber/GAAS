/**
 * 飞书表格同步：失败通知（供 index.js 注册通知器，瞬态错误不告警）。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { childLogger } from '../../utils/logger.js';
import { isTransientFeishuBitableError } from './transient-errors.js';

const log = childLogger({ domain: 'feishu-sync' });

let _feishuSyncFailureNotifier = null;
/** 由 index 注册：飞书→PG 定时/按表同步失败时立刻通知 admin */
export function setFeishuSyncFailureNotifier(fn) {
  _feishuSyncFailureNotifier = typeof fn === 'function' ? fn : null;
}

export function notifyFeishuSyncFailure(label, error) {
  const msg = String(error?.message || error || '');
  if (isTransientFeishuBitableError(msg)) {
    log.warn({ msg: 'transient_feishu_error_skip_alert', label, err: msg.slice(0, 320) });
    return;
  }
  try {
    void _feishuSyncFailureNotifier?.(label, error);
  } catch (_e) {
    /* ignore */
  }
}
