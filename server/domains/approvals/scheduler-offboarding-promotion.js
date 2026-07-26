/**
 * Offboarding auto-disable + promotion-track progress sweep (every 30 min).
 * Wave H8 peel from index.js setInterval.
 */
import { childLogger } from '../../utils/logger.js';
import {
  runOffboardingPromotionTick,
} from './scheduler-offboarding-promotion-helpers.js';

const log = childLogger({ domain: 'approvals', handler: 'offboarding-promotion-scheduler' });

export function createOffboardingPromotionScheduler(deps) {
  let started = false;
  function startOffboardingPromotionScheduler() {
    if (started) return;
    started = true;
    setInterval(() => {
      void runOffboardingPromotionTick(deps).catch((e) =>
        log.error({ msg: 'offboarding_cron_tick_failed', err: e?.message || String(e) })
      );
    }, 30 * 60 * 1000);
  }

  return { runOffboardingPromotionTick: () => runOffboardingPromotionTick(deps), startOffboardingPromotionScheduler };
}
