/**
 * P4 peel: upsertDailyReport schedule notification helpers.
 */

export function resolveDailyReportStore({
  role,
  bodyStore,
  allowedStores,
  currentStore,
  myStore,
}) {
  let store = String(bodyStore || '').trim();
  const allowed = Array.isArray(allowedStores) ? allowedStores : [];
  const current = String(currentStore || '').trim();
  if (role === 'store_manager') {
    store = (store && allowed.includes(store)) ? store : (current || myStore);
  } else if (role === 'store_production_manager' || role === 'front_manager') {
    store = myStore;
  }
  return store;
}

export function applyScheduleNotifications({
  state0,
  nextState,
  payload,
  store,
  date,
  item,
  stateFindUserRecord,
  addStateNotification,
  makeNotif,
}) {
  const allUsers = [
    ...(Array.isArray(state0.employees) ? state0.employees : []),
    ...(Array.isArray(state0.users) ? state0.users : []),
  ];
  const byName = new Map();
  allUsers.forEach((x) => {
    const name = String(x?.name || '').trim();
    if (!name) return;
    byName.set(name.toLowerCase(), x);
  });

  const resolveRecipient = (raw) => {
    const username0 = String(raw?.user || raw?.username || raw?.userName || '').trim();
    const name0 = String(raw?.name || raw?.employeeName || '').trim();
    if (username0) {
      const rec = stateFindUserRecord(state0, username0) || {};
      const displayName = String(rec?.name || name0 || username0).trim() || username0;
      return { username: username0, name: displayName };
    }
    if (!name0) return null;
    const rec = byName.get(name0.toLowerCase()) || null;
    const username1 = String(rec?.username || '').trim();
    if (!username1) return null;
    const displayName = String(rec?.name || name0).trim() || username1;
    return { username: username1, name: displayName };
  };

  let state = nextState;
  const notifyShift = (arr, shiftLabel, shiftKey) => {
    const seen = new Set();
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      const rec = resolveRecipient(x);
      if (!rec?.username) return;
      const k = String(rec.username || '').trim().toLowerCase() + '||' + shiftKey;
      if (seen.has(k)) return;
      seen.add(k);
      const msg = `亲爱的${rec.name}，你是明天${shiftLabel}，请准时到岗并准时完成打卡考勤。`;
      state = addStateNotification(state, makeNotif(rec.username, '排班通知', msg, {
        type: 'schedule_notice',
        store,
        date,
        shift: shiftKey,
        reportId: item?.id || '',
      }));
    });
  };

  const schedule = payload?.scheduleNextDay && typeof payload.scheduleNextDay === 'object' ? payload.scheduleNextDay : {};
  notifyShift(schedule?.morningStaff, '早班', 'morning');
  notifyShift(schedule?.afternoonStaff, '午班', 'afternoon');
  return state;
}

export async function upsertDailyReportItem({
  list,
  idx,
  prev,
  store,
  date,
  payload,
  username,
  now,
  wantSubmit,
  role,
  uuidFn,
  syncPg,
}) {
  if (idx >= 0) {
    const alreadySubmitted = !!(prev?.submittedAt || prev?.submitted);
    if (alreadySubmitted && role === 'store_manager') {
      return { error: 'locked', status: 403 };
    }

    const submittedAt = prev?.submittedAt || prev?.submitted_at || null;
    const submittedBy = prev?.submittedBy || prev?.submitted_by || null;
    const nextSubmittedAt = (wantSubmit && !submittedAt) ? now : submittedAt;
    const nextSubmittedBy = (wantSubmit && !submittedBy) ? username : submittedBy;
    const shouldNotifySchedule = !!(wantSubmit && !submittedAt);

    const item = {
      ...prev,
      store,
      date,
      data: payload,
      updatedAt: now,
      updatedBy: username,
    };

    const shouldSyncDailyReportsPg = !!wantSubmit || alreadySubmitted;
    if (shouldSyncDailyReportsPg) {
      await syncPg('update');
    }

    if (wantSubmit || submittedAt) {
      item.submittedAt = nextSubmittedAt;
      item.submittedBy = nextSubmittedBy;
    }
    list.splice(idx, 1);
    list.unshift(item);
    return { ok: true, item, shouldNotifySchedule };
  }

  const item = {
    id: uuidFn(),
    store,
    date,
    data: payload,
    createdAt: now,
    createdBy: username,
    updatedAt: now,
    updatedBy: username,
  };

  if (wantSubmit) {
    item.submittedAt = now;
    item.submittedBy = username;
  }

  if (wantSubmit) {
    await syncPg('insert');
  }

  list.unshift(item);
  return { ok: true, item, shouldNotifySchedule: !!wantSubmit };
}
