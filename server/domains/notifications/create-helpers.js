/**
 * Notifications / system-alert helpers factory (Wave H4).
 */

import { createMakeNotif, addStateNotification, uniqUsernames } from './make-notif.js';
import { createAppendHelpers } from './append.js';
import { systemAlertTitle, createSendAdminSystemAlert } from './system-alert.js';
import { createNotifyAdminsDualWriteFailure } from './dual-write-alert.js';
import { createNotifyAdminsOcrFailed } from './ocr-alert.js';
import { createMetricAlerts, setMetricAlerts } from '../shared/metric-alerts.js';

export function createNotificationsHelpers({
  pool,
  resolveTenantIdDefault,
  hrmsNowISO,
  sendLarkMessage,
  lookupFeishuUserByUsername,
  invalidateSharedStateCache,
}) {
  const makeNotif = createMakeNotif({ hrmsNowISO });
  const { appendNotifications, insertHrmsUserNotifications } = createAppendHelpers({
    pool,
    resolveTenantIdDefault,
    hrmsNowISO,
    invalidateSharedStateCache,
  });
  const sendAdminSystemAlert = createSendAdminSystemAlert({
    pool,
    makeNotif,
    appendNotifications,
    insertHrmsUserNotifications,
    uniqUsernames,
    systemAlertTitle,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    resolveTenantIdDefault,
  });
  setMetricAlerts(createMetricAlerts({ sendAdminSystemAlert }));
  const notifyAdminsDualWriteFailure = createNotifyAdminsDualWriteFailure({ pool, sendLarkMessage });
  const notifyAdminsOcrFailed = createNotifyAdminsOcrFailed({ pool, sendLarkMessage });

  return {
    makeNotif,
    addStateNotification,
    uniqUsernames,
    appendNotifications,
    insertHrmsUserNotifications,
    systemAlertTitle,
    sendAdminSystemAlert,
    notifyAdminsDualWriteFailure,
    notifyAdminsOcrFailed,
  };
}
