import { statfs as defaultStatfs } from 'node:fs/promises';

/** 根分区空间（供 /api/health 与磁盘告警）；阈值偏保守，避免再次写满导致 PostgreSQL 宕机 */
export async function buildRootDiskHealthInfo(statfsImpl = defaultStatfs) {
  try {
    const s = await statfsImpl('/');
    const bsize = Number(s.bsize) || 4096;
    const total = Number(s.blocks) * bsize;
    const avail = Number(s.bavail) * bsize;
    const usedPct = total > 0 ? Math.round(((total - avail) / total) * 1000) / 10 : null;
    const availGb = Math.round((avail / (1024 ** 3)) * 100) / 100;
    const totalGb = Math.round((total / (1024 ** 3)) * 100) / 100;
    const availCrit = 2 * 1024 ** 3;
    const availWarn = 20 * 1024 ** 3;
    let level = 'ok';
    let message = null;
    if (avail < availCrit || (usedPct != null && usedPct >= 92)) {
      level = 'crit';
      message =
        '根分区空间危急：剩余过低或已用过高，PostgreSQL 可能无法扩展文件，导致全员无法登录。请立即清理 /opt/deploy-backups、journal、PM2 日志等。';
    } else if (avail < availWarn || (usedPct != null && usedPct >= 82)) {
      level = 'warn';
      message = '根分区空间紧张：建议尽快清理部署备份与日志，避免写满磁盘。';
    } else if (usedPct != null && usedPct >= 72) {
      level = 'notice';
      message = `根分区已用约 ${usedPct}%，请关注磁盘余量。`;
    }
    return {
      path: '/',
      totalBytes: total,
      availBytes: avail,
      totalGb,
      availGb,
      usedPercent: usedPct,
      level,
      message
    };
  } catch (e) {
    return { path: '/', error: 'internal_error' };
  }
}

/**
 * @param {{ sendLarkMessage: (openId: string, text: string) => Promise<unknown> }} deps
 * @returns {(disk: object) => Promise<void>}
 */
export function createDiskPressureNotifier({ sendLarkMessage }) {
  let __lastDiskLarkNoticeAt = 0;

  return async function maybeNotifyDiskPressureByLark(disk) {
    if (!disk || disk.error) return;
    if (disk.level !== 'crit' && disk.level !== 'warn') return;
    const ids = String(process.env.HRMS_DISK_ALERT_OPEN_IDS || '')
      .split(/[\s,]+/)
      .map(x => x.trim())
      .filter(Boolean);
    if (!ids.length) return;
    const now = Date.now();
    const minMs = disk.level === 'crit' ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (now - __lastDiskLarkNoticeAt < minMs) return;
    __lastDiskLarkNoticeAt = now;
    const text =
      `【HRMS 磁盘告警】\n${disk.message || '磁盘空间异常'}\n` +
      `剩余约 ${disk.availGb} GiB / 合计 ${disk.totalGb} GiB` +
      `${disk.usedPercent != null ? `（已用约 ${disk.usedPercent}%）` : ''}。\n` +
      '可在服务器执行 df -h / 与 du -sh /opt/deploy-backups/* 排查。';
    for (const id of ids) {
      try {
        await sendLarkMessage(id, text);
      } catch (e) {
        console.error('HRMS disk lark notify failed:', e?.message || e);
      }
    }
  };
}
