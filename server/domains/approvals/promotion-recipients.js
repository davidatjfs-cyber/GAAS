/**
 * Promotion-track recipient helpers (kitchen detection + notify list).
 * Used by approval route DI and offboarding/promotion cron.
 */
export function createPromotionRecipientsHelpers({
  pickStoreRoleUsernameByStore,
  pickHqManagerUsername,
  uniqUsernames,
  stateFindUserRecord,
}) {
  function isKitchenByRoleOrPosition(roleRaw, positionRaw, departmentRaw) {
    const role = String(roleRaw || '').trim().toLowerCase();
    if (role === 'store_production_manager') return true;
    const txt = `${String(positionRaw || '')} ${String(departmentRaw || '')}`.toLowerCase();
    return /(后厨|厨房|后堂|后场|出品|厨师|厨工)/.test(txt);
  }

  async function getPromotionTrackRecipients(state, track) {
    const applicantUsername = String(track?.applicantUsername || '').trim();
    const mentorUsername = String(track?.mentorUsername || '').trim();
    const store = String(track?.store || '').trim();
    const currentPosition = String(track?.currentPosition || '').trim();
    const department = String(track?.department || '').trim();
    const applicantRec = stateFindUserRecord(state, applicantUsername) || {};
    const applicantRole = String(track?.applicantRole || applicantRec?.role || '').trim();
    const kitchen = isKitchenByRoleOrPosition(applicantRole, currentPosition, department);
    const storeManager = pickStoreRoleUsernameByStore(state, store, ['store_manager']);
    const productionManager = kitchen
      ? pickStoreRoleUsernameByStore(state, store, ['store_production_manager'])
      : '';
    const hqManager = await pickHqManagerUsername(state);
    return uniqUsernames(
      [applicantUsername, mentorUsername, storeManager, hqManager, productionManager].filter(Boolean)
    );
  }

  return { isKitchenByRoleOrPosition, getPromotionTrackRecipients };
}
