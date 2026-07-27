import { childLogger } from '../../utils/logger.js';
import {
  shanghaiCalendarForJobs as computeShanghaiCalendarForJobs,
  insertRewardPunishmentApprovalFromTemplate as insertRewardPunishmentApprovalFromTemplateImpl,
  runMonthlyRecurringRewardTemplatesJob as runMonthlyRecurringRewardTemplatesJobImpl,
} from './scheduler-recurring-reward-helpers.js';

const log = childLogger({ domain: 'approvals', handler: 'scheduler-recurring-reward' });

export function createRecurringRewardScheduler(deps) {
  const slotState = { lastSlot: '' };
  let started = false;

  function startRecurringRewardScheduler() {
    if (started) return;
    started = true;
    setInterval(() => {
      void runMonthlyRecurringRewardTemplatesJobImpl(deps, slotState).catch((e) =>
        log.error({ msg: 'recurring_reward_tick_failed', err: e?.message || String(e) })
      );
    }, 5 * 60 * 1000);
  }

  return {
    shanghaiCalendarForJobs: (now) =>
      computeShanghaiCalendarForJobs(now === undefined ? deps.getNow() : now),
    insertRewardPunishmentApprovalFromTemplate: (applicantUsername, payloadObj) =>
      insertRewardPunishmentApprovalFromTemplateImpl(deps, applicantUsername, payloadObj),
    runMonthlyRecurringRewardTemplatesJob: () =>
      runMonthlyRecurringRewardTemplatesJobImpl(deps, slotState),
    startRecurringRewardScheduler,
  };
}

export {
  computeShanghaiCalendarForJobs as shanghaiCalendarForJobs,
  insertRewardPunishmentApprovalFromTemplateImpl as insertRewardPunishmentApprovalFromTemplate,
  runMonthlyRecurringRewardTemplatesJobImpl as runMonthlyRecurringRewardTemplatesJob,
};
