export async function beforeUpdate(_ctx) {}

export async function afterDecide(ctx) {
  const {
    req,
    deps,
    updated,
    nextAssignee,
    note,
  } = ctx;
  const {
    pool,
    hrmsNowISO,
    makeNotif,
    appendNotifications,
    getSharedState,
    mergeSharedStateFields,
    stateFindUserRecord,
    uniqUsernames,
    safeNumber,
    safeBizMonth,
    randomUUID,
    upsertPayrollLedgerEntry,
    resolveAttendancePayrollRules,
    notifyAdminsDualWriteFailure,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'points') return;

    const state0 = (await getSharedState()) || {};
    const applicantUser = String(updated.applicant_username || '').trim();
    const applicant = stateFindUserRecord(state0, applicantUser) || {};
    const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
    const applicantManager = String(applicant?.managerUsername || '').trim();
    const finalApproved = String(updated.status || '') === 'approved';
    const finalRejected = String(updated.status || '') === 'rejected';
    const approvalId = String(updated.id || '').trim();

    const rawItems = Array.isArray(updated.payload?.items) ? updated.payload.items : null;
    const store = String(updated.payload?.store || applicant?.store || '').trim();
    const month = safeBizMonth(
      updated.payload?.bizMonth || updated.payload?.businessMonth || updated.payload?.occurMonth
      || updated.payload?.occurDate || updated.payload?.eventDate || updated.payload?.date
    ) || String(updated.created_at || updated.updated_at || '').slice(0, 7) || hrmsNowISO().slice(0, 7);
    const approvedBy = String(req.user?.username || '').trim();
    let pointsRate = 0.5;
    try {
      const resolvedPts = await resolveAttendancePayrollRules({
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        store
      });
      const rate = Number(resolvedPts?.rules?.pointsYuanPerPoint);
      if (Number.isFinite(rate) && rate >= 0) pointsRate = rate;
    } catch (_) { /* ignore */ }

    if (finalApproved) {
      const alreadyApplied = !!(state0?.pointsAppliedApprovals?.[approvalId]);
      if (!alreadyApplied) {
        let newRecords, _totalSubsidy;
        if (rawItems && rawItems.length > 0) {
          newRecords = rawItems.map(item => {
            const pts = safeNumber(item.points) || 0;
            return {
              id: randomUUID(),
              approvalId,
              username: String(item.username || applicantUser).trim(),
              name: String(item.name || applicantName).trim(),
              store: String(item.store || store).trim(),
              itemName: String(item.itemName || item.reason || '积分事项').trim().slice(0, 200),
              reason: String(item.reason || '').trim().slice(0, 500),
              points: pts,
              amount: Number((pts * pointsRate).toFixed(2)),
              approvedAt: hrmsNowISO(),
              approvedBy,
              bizMonth: safeBizMonth(item.bizMonth || item.occurDate || item.date) || month
            };
          });
          _totalSubsidy = newRecords.reduce((s, r) => s + r.amount, 0);
        } else {
          const pts = safeNumber(updated.payload?.points) || 0;
          const subsidy = Number((pts * pointsRate).toFixed(2));
          newRecords = [{
            id: randomUUID(),
            approvalId,
            username: applicantUser,
            name: applicantName,
            store,
            itemName: String(updated.payload?.itemName || '积分事项').trim(),
            reason: String(updated.payload?.reason || '').trim(),
            points: pts,
            amount: subsidy,
            approvedAt: hrmsNowISO(),
            approvedBy,
            bizMonth: month
          }];
          _totalSubsidy = subsidy;
        }

        try {
          const tidPts = req.tenantId || req.user?.tenant_id || 'default';
          for (const rec of newRecords) {
            await upsertPayrollLedgerEntry({
              tenantId: tidPts,
              username: rec.username,
              store: rec.store,
              bizMonth: rec.bizMonth || month,
              entryType: 'points',
              amount: rec.amount,
              points: rec.points,
              title: rec.itemName,
              reason: rec.reason,
              approvalId,
              createdBy: approvedBy,
              meta: { pointRecordId: rec.id }
            });
          }
        } catch (ledPtsErr) {
          console.error('[points] payroll ledger failed:', ledPtsErr?.message);
        }

        await mergeSharedStateFields({
          pointRecords: newRecords,
          pointsAppliedApprovals: { [approvalId]: true }
        }, { pointRecords: 'id' });

        try {
          for (const rec of newRecords) {
            const approvedAtVal = (rec.approvedAt && rec.approvedAt !== '') ? rec.approvedAt : null;
            await pool.query(
              `INSERT INTO point_records (id, approval_id, username, name, store, item_name, reason, points, amount, approved_at, approved_by, tenant_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
               ON CONFLICT (id) DO UPDATE SET
                 approval_id=EXCLUDED.approval_id, username=EXCLUDED.username, name=EXCLUDED.name,
                 store=EXCLUDED.store, item_name=EXCLUDED.item_name, reason=EXCLUDED.reason,
                 points=EXCLUDED.points, amount=EXCLUDED.amount, approved_at=EXCLUDED.approved_at,
                 approved_by=EXCLUDED.approved_by, updated_at=NOW()`,
              [rec.id, rec.approvalId || null, rec.username || '', rec.name || '', rec.store || '',
               rec.itemName || '积分事项', rec.reason || '', Number(rec.points) || 0,
               Number(rec.amount) || 0, approvedAtVal, rec.approvedBy || '',
               req.tenantId || req.user?.tenant_id || 'default']
            );
          }
        } catch (e2) {
          console.error('[point_records] dual-write failed (non-fatal):', e2?.message);
          void notifyAdminsDualWriteFailure('point_records（积分审批双写）', e2);
        }
      }

      const totalPoints = rawItems ? rawItems.reduce((s, i) => s + (safeNumber(i.points) || 0), 0) : (safeNumber(updated.payload?.points) || 0);
      const subsidyLabel = Number((totalPoints * pointsRate).toFixed(2));
      const itemLabel = rawItems && rawItems.length > 1
        ? `${rawItems.length}条积分事项（合计${totalPoints}分）`
        : String(updated.payload?.itemName || rawItems?.[0]?.reason || '积分事项').trim();
      const msg = `${applicantName}，你申请的"${itemLabel}"已通过审批，共获得${totalPoints}积分（折算¥${subsidyLabel.toFixed(2)}，已计入薪资账本，业务月 ${month}）。`;
      const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
      await appendNotifications(recipients.map((u) =>
        makeNotif(u, '积分申请已通过', msg, { type: 'points_result', approvalId })
      ));
    }

    if (finalRejected) {
      const msg = `${applicantName}，你申请的积分申请因为${note || '相关原因'}未通过审批。`;
      const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
      await appendNotifications(recipients.map((u) =>
        makeNotif(u, '积分申请未通过', msg, { type: 'points_result', approvalId })
      ));
    }

    if (String(updated.status || '') === 'pending' && nextAssignee) {
      const totalPoints = rawItems ? rawItems.reduce((s, i) => s + (safeNumber(i.points) || 0), 0) : (safeNumber(updated.payload?.points) || 0);
      const itemLabel = rawItems && rawItems.length > 1
        ? `${rawItems.length}条积分事项（合计${totalPoints}分）`
        : String(updated.payload?.itemName || rawItems?.[0]?.reason || '积分事项').trim();
      const msg = `${applicantName} 提交了积分申请（${itemLabel}），需要您审批。`;
      await appendNotifications([
        makeNotif(nextAssignee, '积分申请待审批', msg, { type: 'points_request', approvalId })
      ]);
    }
  } catch (e) { /* ignore */ }
}
