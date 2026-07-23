/**
 * POST /api/approvals/:id/decide — 审批决定（同意/拒绝）。
 * 从 index.js 拆出（P0-A1）；业务逻辑与拆前一致，依赖经 deps 注入。
 */
import { canAccessApprovalCenter } from '../../store-duty-bindings.js';

export async function handleApprovalDecide(req, res, deps) {
  const {
    pool,
    hrmsNowISO,
    makeNotif,
    appendNotifications,
    getSharedState,
    mergeSharedStateFields,
    stateFindUserRecord,
    uniqUsernames,
    safeDateOnly,
    safeNumber,
    safeErrMessage,
    safeBizMonth,
    shanghaiTodayDateOnly,
    toNullableUuid,
    randomUUID,
    buildOnboardingEmployeeRecordFromPayload,
    createTrainingAssignment,
    applyPromotionSalaryNextMonth,
    insertSalaryTimeline,
    findUserSalary,
    upsertPayrollLedgerEntry,
    resolveAttendancePayrollRules,
    getPromotionRequiredTopics,
    getPromotionTrackProgress,
    normalizePromotionTrainingPeriods,
    approvalTypeLabel,
    calcDateSpanDaysInclusive,
    isKitchenByRoleOrPosition,
    pickHqManagerUsername,
    pickStoreRoleUsernameByStore,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    notifyAdminsDualWriteFailure,
    bcrypt,
  } = deps;
  if (!canAccessApprovalCenter(req.user?.role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const __decideStartedAt = Date.now();
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  const id = String(req.params?.id || '').trim();
  const approved = !!req.body?.approved;
  const note = String(req.body?.note || '').trim();
  const departureType = String(req.body?.departureType || '').trim(); // voluntary | involuntary
  const remainingLeaveDaysRaw = req.body?.remainingLeaveDays;
  const mentorUsernameRaw = String(req.body?.mentorUsername || '').trim();
  const mentorNameRaw = String(req.body?.mentorName || '').trim();
  const trainingStartDateRaw = String(req.body?.trainingStartDate || '').trim();
  const trainingDaysRaw = Number(req.body?.trainingDays || 0);
  const trainingPeriodsRaw = Array.isArray(req.body?.trainingPeriods) ? req.body.trainingPeriods : [];
  const promotedSalaryRaw = req.body?.promotedSalary;
  if (!username) return res.status(400).json({ error: 'missing_user' });
  if (!id) return res.status(400).json({ error: 'missing_id' });

  /** 入职审批通过后同步员工档案时的告警（写入 hrms_state.employees） */
  let decideExtras = {};

  try {
    const r0 = await pool.query(
      'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at from approval_requests where id = $1 limit 1',
      [id]
    );
    const row = r0.rows?.[0] || null;
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (String(row.status || '') !== 'pending') return res.status(400).json({ error: 'not_pending' });
    const chain = Array.isArray(row.chain) ? row.chain : [];
    const idx = chain.findIndex(x => String(x?.assignee || '').toLowerCase() === username.toLowerCase() && String(x?.status || '') === 'pending');
    if (idx < 0) return res.status(403).json({ error: 'forbidden' });

    const nowIso = hrmsNowISO();
    chain[idx] = { ...chain[idx], status: approved ? 'approved' : 'rejected', decidedAt: nowIso, note };

    let nextStatus = approved ? 'pending' : 'rejected';
    let nextAssignee = null;
    let effectiveDate = row.effective_date;
    let updatedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};

    // Save departureType into offboarding approval payload
    if (String(row.type || '') === 'offboarding' && departureType && (departureType === 'voluntary' || departureType === 'involuntary')) {
      updatedPayload.departureType = departureType;
    }

    // Save remainingLeaveDays into leave approval payload (can be negative: employee owes days)
    if (String(row.type || '') === 'leave' && remainingLeaveDaysRaw != null && remainingLeaveDaysRaw !== '') {
      const remDays = Number(remainingLeaveDaysRaw);
      if (Number.isFinite(remDays)) {
        updatedPayload.remainingLeaveDays = remDays;
        updatedPayload.remainingLeaveDaysFilledBy = username;
      }
    }

    // Promotion qualification: store manager must assign mentor when approving
    if (String(row.type || '') === 'promotion') {
      const stage = String(updatedPayload?.promotionStage || '').trim().toLowerCase();
      if (stage === 'qualification') {
        const currentRole = String(role || '').trim().toLowerCase();
        const isStoreManagerStep = currentRole === 'store_manager';
        if (approved && isStoreManagerStep && !mentorUsernameRaw) {
          return res.status(400).json({ error: 'missing_mentor', message: '店长审批时必须指定带教人' });
        }
        if (mentorUsernameRaw) {
          // Defense-in-depth: even though the frontend now uses a picker (no more free-text typing),
          // reject mentor usernames that don't correspond to a real account to prevent silently
          // misrouted training assignments (see incident: NNYXLYR04 mistyped as nnyxlry04).
          const mentorExists = await pool.query(
            `select 1 from users where lower(username) = lower($1)
             union all
             select 1 from employees where lower(username) = lower($1)
             limit 1`,
            [mentorUsernameRaw]
          );
          if (!mentorExists.rows?.length) {
            return res.status(400).json({ error: 'mentor_not_found', message: '带教人账号不存在，请重新选择' });
          }
          updatedPayload.mentorUsername = mentorUsernameRaw;
          if (mentorNameRaw) updatedPayload.mentorName = mentorNameRaw;
          updatedPayload.mentorAssignedBy = username;
          updatedPayload.mentorAssignedAt = nowIso;
        }
        const dt = safeDateOnly(trainingStartDateRaw);
        if (dt) updatedPayload.trainingStartDate = dt;
        if (Number.isFinite(trainingDaysRaw) && trainingDaysRaw > 0) {
          updatedPayload.trainingDays = Math.max(1, Math.min(30, Math.floor(trainingDaysRaw)));
        }
        const normalizedPeriods = normalizePromotionTrainingPeriods(trainingPeriodsRaw);
        if (normalizedPeriods.length) {
          updatedPayload.trainingPeriods = normalizedPeriods;
        }
      }

      if (stage === 'formal') {
        const currentRole = String(role || '').trim().toLowerCase();
        const isStoreManagerStep = currentRole === 'store_manager';
        if (approved && isStoreManagerStep) {
          const salaryVal = Number(promotedSalaryRaw);
          if (!Number.isFinite(salaryVal) || salaryVal <= 0) {
            return res.status(400).json({ error: 'missing_promoted_salary', message: '店长审批正式晋升时必须填写晋升后薪资' });
          }
          updatedPayload.promotedSalary = Number(salaryVal.toFixed(2));
          updatedPayload.promotedSalarySetBy = username;
          updatedPayload.promotedSalarySetAt = nowIso;
        }
      }
    }

    if (approved) {
      const next = chain.slice(idx + 1).find(x => String(x?.status || '') === 'queued');
      if (next) {
        nextAssignee = String(next.assignee || '').trim() || null;
        const nextIdx = chain.findIndex(x => String(x?.assignee || '') === String(next.assignee || '') && String(x?.status || '') === 'queued');
        if (nextIdx >= 0) chain[nextIdx] = { ...chain[nextIdx], status: 'pending' };
      } else {
        nextStatus = 'approved';
        nextAssignee = null;
      }
    }

    if (nextStatus === 'approved' && String(row.type || '') === 'offboarding') {
      const resignDate = safeDateOnly(updatedPayload?.resignDate || updatedPayload?.date || updatedPayload?.resignationDate);
      if (resignDate) effectiveDate = resignDate;
    }

    const r1 = await pool.query(
      `update approval_requests
       set status=$2, current_assignee_username=$3, chain=$4::jsonb, effective_date=$5, payload=$6::jsonb, updated_at=now()
       where id=$1
       returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
      [id, nextStatus, nextAssignee, JSON.stringify(chain), effectiveDate || null, JSON.stringify(updatedPayload)]
    );
    const updated = r1.rows?.[0] || null;

    if (updated && String(updated.status || '') === 'approved' && String(updated.type || '') === 'onboarding') {
      const emp = updated.payload?.employee && typeof updated.payload.employee === 'object' ? updated.payload.employee : {};
      const stateForId = (await getSharedState()) || {};
      const built = buildOnboardingEmployeeRecordFromPayload(emp, stateForId);
      if (!built.ok) {
        console.error('[approval/onboarding] 审批已通过但无法构建员工记录', {
          approvalId: updated.id,
          reason: built.reason,
          employeeName: String(emp?.name || '').trim() || null
        });
        decideExtras.onboardingEmployeeSync = { ok: false, reason: built.reason };
      } else {
        const { nextEmp, newUsername, empName, empPassword } = built;
        try {
          // 原子合并，避免 saveSharedState 全量写回与并发请求互相覆盖导致「审批过了但员工没进表」
          await mergeSharedStateFields({ employees: [nextEmp] }, { employees: 'username' });
          decideExtras.onboardingEmployeeSync = { ok: true, username: newUsername };
        } catch (mergeErr) {
          console.error('[approval/onboarding] mergeSharedStateFields(employees) 失败', {
            approvalId: updated.id,
            username: newUsername,
            err: safeErrMessage(e)
          });
          decideExtras.onboardingEmployeeSync = { ok: false, reason: 'merge_failed', username: newUsername };
        }

        // 创建 users 表登录账号 + feishu_users 绑定记录（修复：入职审批通过后必须创建登录账号和飞书绑定）
        if (decideExtras.onboardingEmployeeSync?.ok) {
          try {
            const hash = await bcrypt.hash(empPassword, 10);
            await pool.query(
              `INSERT INTO users (username, password_hash, real_name, role, department, position, is_active, tenant_id)
               VALUES ($1, $2, $3, $4, $5, $6, true, $7)
               ON CONFLICT (username) DO UPDATE
               SET password_hash = EXCLUDED.password_hash,
                   real_name = EXCLUDED.real_name,
                   role = EXCLUDED.role,
                   department = EXCLUDED.department,
                   position = EXCLUDED.position,
                   is_active = true`,
              [newUsername, hash, empName, nextEmp.role, nextEmp.department || '', nextEmp.position || '', req.tenantId || req.user?.tenant_id || 'default']
            );
            console.log('[approval/onboarding] users account created:', newUsername);
            decideExtras.userAccountCreated = true;
          } catch (userErr) {
            console.error('[approval/onboarding] 创建 users 账号失败', {
              approvalId: updated.id,
              username: newUsername,
              err: String(userErr?.message || userErr)
            });
          }
          const onboardingOpenId = toNullableUuid(emp?.open_id || emp?.openId || emp?.feishuOpenId);
          if (onboardingOpenId) {
            try {
              await pool.query(
                `WITH updated AS (
                   UPDATE feishu_users
                      SET name = $2,
                          store = $3,
                          role = $4,
                          registered = FALSE,
                          updated_at = NOW()
                    WHERE username = $1
                      AND tenant_id = $5
                    RETURNING 1
                 )
                 INSERT INTO feishu_users (open_id, username, name, store, role, registered, tenant_id)
                 SELECT $6, $1, $2, $3, $4, FALSE, $5
                 WHERE NOT EXISTS (SELECT 1 FROM updated)`,
                [newUsername, empName, nextEmp.store || '', nextEmp.role || '', req.tenantId || req.user?.tenant_id || 'default', onboardingOpenId]
              );
              console.log('[approval/onboarding] feishu_users record created:', newUsername);
              decideExtras.feishuUsersCreated = true;
            } catch (feishuErr) {
              console.error('[approval/onboarding] 创建 feishu_users 记录失败', {
                approvalId: updated.id,
                username: newUsername,
                err: String(feishuErr?.message || feishuErr)
              });
            }
          } else {
            console.info('[approval/onboarding] 跳过 feishu_users 创建：缺少 open_id', {
              approvalId: updated.id,
              username: newUsername
            });
          }
        }

        if (decideExtras.onboardingEmployeeSync?.ok) {
          // 入职定薪写入底薪时间线（自 joinDate 起生效）
          try {
            const salNum = Number(nextEmp?.salary);
            const joinD = safeDateOnly(nextEmp?.joinDate) || hrmsNowISO().slice(0, 10);
            if (Number.isFinite(salNum) && salNum > 0) {
              await insertSalaryTimeline({
                tenantId: req.tenantId || req.user?.tenant_id || 'default',
                username: newUsername,
                amount: salNum,
                effectiveFrom: joinD,
                source: 'onboarding',
                approvalId: updated.id,
                note: '入职定薪',
                createdBy: username
              });
            }
          } catch (tlOnbErr) {
            console.error('[onboarding] salary timeline failed:', tlOnbErr?.message);
          }

          const state = (await getSharedState()) || {};
          const submitter = String(updated.applicant_username || '').trim();
          const empManager = String(nextEmp.managerUsername || '').trim();
          const empStore = String(nextEmp.store || '').trim();
          let storeManagerUsername = '';
          if (empStore) {
            const allEmps = Array.isArray(state.employees) ? state.employees : [];
            const smRec = allEmps.find(e => String(e?.store || '').trim() === empStore && String(e?.role || '').trim() === 'store_manager');
            if (smRec) storeManagerUsername = String(smRec.username || '').trim();
          }
          const title = '新员工入职审批已通过';
          const todayStr = hrmsNowISO().slice(0, 10).replace(/-/g, '年').replace(/年(\d{2})$/, '月$1日');
          const submitterRec = stateFindUserRecord(state, submitter) || {};
          const submitterName = String(submitterRec?.name || submitter).trim() || submitter;
          const msg = `${submitterName}你好，你提交的新员工「${empName}」入职已经成功，该员工的系统账号是 ${newUsername}，密码是 ${empPassword}，请通知该员工上线吧！\n门店：${empStore || '-'}\n总部 ${todayStr}`;
          const recipients = uniqUsernames([submitter, empManager, storeManagerUsername].filter(Boolean));
          const notifs = recipients.map(u => makeNotif(u, title, msg, { type: 'onboarding_result', approvalId: updated.id }));
          try {
            await mergeSharedStateFields({ notifications: notifs }, { notifications: 'id' });
          } catch (notifErr) {
            console.error('[approval/onboarding] mergeSharedStateFields(notifications) 失败', {
              approvalId: updated.id,
              err: String(notifErr?.message || notifErr)
            });
          }
        }
      }
    }

    // Onboarding step notifications: notify next approver or submitter on rejection
    try {
      if (updated && String(updated.type || '') === 'onboarding') {
        const state0 = (await getSharedState()) || {};
        let stateN = state0;
        const applicantUser = String(updated.applicant_username || '').trim();
        const applicantRec = stateFindUserRecord(stateN, applicantUser) || {};
        const applicantName = String(applicantRec?.name || applicantUser).trim() || applicantUser;
        const empPayload = updated.payload?.employee && typeof updated.payload.employee === 'object' ? updated.payload.employee : {};
        const empName = String(empPayload?.name || '').trim() || '新员工';

        if (String(updated.status || '') === 'pending' && nextAssignee) {
          // Intermediate step approved, notify next approver
          const title = '新员工入职审批待处理';
          const msg = `${applicantName} 提交的新员工「${empName}」入职申请需要您审批。`;
          await appendNotifications([makeNotif(nextAssignee, title, msg, { type: 'onboarding_request', approvalId: updated.id })]);
        }

        if (String(updated.status || '') === 'rejected') {
          // Rejected, notify submitter
          const title = '新员工入职审批被拒绝';
          const msg = `新员工「${empName}」入职申请被拒绝${note ? `：${note}` : ''}`;
          await appendNotifications([makeNotif(applicantUser, title, msg, { type: 'onboarding_result', approvalId: updated.id })]);
        }
      }
    } catch (e) { /* ignore */ }

    // --- Leave / Offboarding post-approval ---
    try {
      if (updated && (String(updated.type || '') === 'leave' || String(updated.type || '') === 'offboarding')) {
        const state0 = (await getSharedState()) || {};
        const applicant = stateFindUserRecord(state0, updated.applicant_username) || {};
        const applicantName = String(applicant?.name || updated.applicant_username).trim() || updated.applicant_username;
        const applicantManager = String(applicant?.managerUsername || '').trim();

        let state = state0;
        const tp = String(updated.type || '').trim();
        const _label = approvalTypeLabel(tp);
        const finalApproved = String(updated.status || '') === 'approved';
        const finalRejected = String(updated.status || '') === 'rejected';

        if (finalApproved && tp === 'leave') {
          const startDate = safeDateOnly(updated.payload?.startDate || updated.payload?.fromDate || updated.payload?.beginDate);
          const endDate = safeDateOnly(updated.payload?.endDate || updated.payload?.toDate || updated.payload?.finishDate);
          const reason = String(updated.payload?.reason || updated.payload?.leaveReason || '').trim();
          const reqDays = safeNumber(updated.payload?.days || updated.payload?.leaveDays);
          const autoDays = calcDateSpanDaysInclusive(startDate, endDate);
          const days = (reqDays != null && reqDays > 0) ? reqDays : (autoDays != null ? autoDays : null);

          const rec = {
            id: randomUUID(),
            approvalId: String(updated.id || ''),
            applicant: String(updated.applicant_username || '').trim(),
            applicantName,
            managerUsername: applicantManager,
            store: String(applicant?.store || '').trim(),
            department: String(applicant?.department || '').trim(),
            position: String(applicant?.position || '').trim(),
            startDate,
            endDate,
            days: days == null ? '' : days,
            reason,
            createdAt: hrmsNowISO(),
            status: 'approved'
          };
          const list = Array.isArray(state.leaveRecords) ? state.leaveRecords.slice() : [];
          list.unshift(rec);
          state = { ...state, leaveRecords: list };

          // 双写：休假记录同步到 hrms_leave_records 表
          try {
            await pool.query(
              `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, approval_id, approved_by, approved_at, submitted_by, tenant_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12,$13,$14,$15)
               ON CONFLICT (id) DO UPDATE SET
                 status='approved', approved_by=$12, approved_at=$13, days=$8`,
              [rec.id, String(applicant?.username || '').trim(), String(applicantName || '').trim(),
               String(applicant?.store || '').trim(), String(applicant?.brand || '').trim(),
               startDate, endDate, days == null ? 0 : days, String(updated.payload?.type || 'leave').trim(),
               reason, updated.id, username, new Date(hrmsNowISO()), username,
               req.tenantId || req.user?.tenant_id || 'default']
            );
          } catch (e) {
            console.error('[leave_records] dual-write failed:', e?.message);
            void notifyAdminsDualWriteFailure('hrms_leave_records（休假审批双写）', e);
          }

          // Format dates as X月X日
          const fmtLeaveDate = (d) => { if (!d) return ''; const p = String(d).split('-'); return p.length >= 3 ? `${Number(p[1])}月${Number(p[2])}日` : d; };
          const sd = fmtLeaveDate(startDate);
          const ed = fmtLeaveDate(endDate);
          // Notify applicant + direct supervisor
          const msg = `${applicantName}提交的休假申请${sd}至${ed}，已经审批通过。`;
          const recipients = uniqUsernames([updated.applicant_username, applicantManager].filter(Boolean));
          await appendNotifications(recipients.map((u) => makeNotif(u, '休假申请已通过', msg, { type: 'leave_result', approvalId: updated.id, leaveId: rec.id })));
        }

        if (finalRejected && tp === 'leave') {
          const fmtLeaveDate2 = (d) => { if (!d) return ''; const p = String(d).split('-'); return p.length >= 3 ? `${Number(p[1])}月${Number(p[2])}日` : d; };
          const startDate2 = safeDateOnly(updated.payload?.startDate || updated.payload?.fromDate || updated.payload?.beginDate);
          const endDate2 = safeDateOnly(updated.payload?.endDate || updated.payload?.toDate || updated.payload?.finishDate);
          const sd2 = fmtLeaveDate2(startDate2);
          const ed2 = fmtLeaveDate2(endDate2);
          const msg = `${applicantName}提交的休假申请${sd2}至${ed2}，因为${note || '相关原因'}没有审批通过。`;
          const recipients = uniqUsernames([updated.applicant_username, applicantManager].filter(Boolean));
          await appendNotifications(recipients.map((u) => makeNotif(u, '休假申请未通过', msg, { type: 'leave_result', approvalId: updated.id })));
        }

        // Intermediate step: notify next approver for leave
        if (String(updated.status || '') === 'pending' && nextAssignee && tp === 'leave') {
          const msg = `${applicantName} 提交了休假申请，需要您审批。`;
          await appendNotifications([makeNotif(nextAssignee, '休假申请待审批', msg, { type: 'leave_request', approvalId: updated.id })]);
        }

        if ((finalApproved || finalRejected) && tp === 'offboarding') {
          const resignDate = safeDateOnly(updated.payload?.resignDate || updated.payload?.date || updated.payload?.resignationDate);
          const todayWall = hrmsNowISO().slice(0, 10);
          const todaySh = shanghaiTodayDateOnly();
          const title = finalApproved ? '离职申请已通过' : '离职申请被拒绝';
          const disableNow = finalApproved && (!resignDate || (todaySh && resignDate && String(todaySh) >= String(resignDate)));
          const msg = finalApproved
            ? (disableNow
              ? `${applicantName} 离职申请已通过，离职日期：${resignDate || todayWall}。系统已关闭 HRMS 登录、数据库账号与飞书绑定（registered）。`
              : `${applicantName} 离职申请已通过，离职日期：${resignDate || '-'}。将于该日起自动关闭 HRMS 登录与飞书绑定（当前仍可登录至离职日前一日）。`)
            : `${applicantName} 离职申请被拒绝${note ? `：${note}` : ''}`;
          const recipients = finalApproved
            ? uniqUsernames([updated.applicant_username, applicantManager])
            : uniqUsernames([updated.applicant_username]);
          await appendNotifications(recipients.map((u) => makeNotif(u, title, msg, { type: 'offboarding_result', approvalId: updated.id })));

          if (finalApproved) {
            const applicantUser = String(updated.applicant_username || '').trim();
            const employeesList = Array.isArray(state.employees) ? state.employees : [];
            const empIdx = employeesList.findIndex(e => String(e?.username || '').toLowerCase() === applicantUser.toLowerCase());
            const effectiveResign = resignDate || todayWall;
            const patches = {};
            const idFields = {};
            if (empIdx >= 0) {
              const cur = employeesList[empIdx] || {};
              const nextEmp = disableNow
                ? { ...cur, offboardingApproved: true, offboardingDate: effectiveResign, status: '离职' }
                : { ...cur, offboardingApproved: true, offboardingDate: effectiveResign };
              const nextEmployees = employeesList.slice();
              nextEmployees[empIdx] = nextEmp;
              state = { ...state, employees: nextEmployees };
              patches.employees = [nextEmp];
              idFields.employees = 'username';
            }
            const usersList = Array.isArray(state.users) ? state.users : [];
            const userIdx = usersList.findIndex(u2 => String(u2?.username || '').toLowerCase() === applicantUser.toLowerCase());
            if (userIdx >= 0 && disableNow) {
              const nextUsers = usersList.slice();
              nextUsers[userIdx] = { ...nextUsers[userIdx], status: '离职' };
              state = { ...state, users: nextUsers };
              patches.users = [nextUsers[userIdx]];
              idFields.users = 'username';
            }
            if (Object.keys(patches).length) {
              await mergeSharedStateFields(patches, idFields);
            }
          }
        }

        // Intermediate step: notify next approver for offboarding
        if (String(updated.status || '') === 'pending' && nextAssignee && tp === 'offboarding') {
          const msg = `${applicantName} 提交了离职申请，需要您审批。`;
          const notif = makeNotif(nextAssignee, '离职申请待审批', msg, { type: 'offboarding_request', approvalId: updated.id });
          await mergeSharedStateFields({ notifications: [notif] }, { notifications: 'id' });
        }
      }
    } catch (e) { /* ignore */ }

    // --- Promotion post-approval ---
    try {
      if (updated && String(updated.type || '') === 'promotion') {
        const state0 = (await getSharedState()) || {};
        const applicantUser = String(updated.applicant_username || '').trim();
        const applicant = stateFindUserRecord(state0, applicantUser) || {};
        const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
        const applicantManager = String(applicant?.managerUsername || '').trim();
        const applicantStore = String(applicant?.store || updated.payload?.store || '').trim();
        const applicantRole = String(applicant?.role || '').trim();
        const applicantPosition = String(applicant?.position || updated.payload?.currentPosition || '').trim();
        const applicantDepartment = String(applicant?.department || updated.payload?.department || '').trim();
        const finalApproved = String(updated.status || '') === 'approved';
        const finalRejected = String(updated.status || '') === 'rejected';
        const stage = String(updated.payload?.promotionStage || 'qualification').trim().toLowerCase();
        let state = state0;

        if (finalApproved && stage === 'formal') {
          const formalPromoTier = String(updated.payload?.promoTier || 'level_promotion').trim();
          const isSkillBump = formalPromoTier === 'skill_bump';
          const newLevel = String(updated.payload?.newLevel || updated.payload?.level || '').trim();
          const newPosition = String(updated.payload?.newPosition || updated.payload?.position || '').trim();
          const promoReason = String(updated.payload?.reason || '').trim();
          const promotedSalary = Number(updated.payload?.promotedSalary);
          const hasPromotedSalary = Number.isFinite(promotedSalary) && promotedSalary > 0;
          const oldSalary = findUserSalary(state, applicantUser);

          // Update employee level/position and add promotion record
          // skill_bump: 只涨工资，级别/岗位不变
          const employees = Array.isArray(state.employees) ? state.employees : [];
          const empIdx = employees.findIndex(e => String(e?.username || '').toLowerCase() === applicantUser.toLowerCase());
          let oldLevel = '', oldPosition = '';
          if (empIdx >= 0) {
            const nextEmployees = employees.slice();
            oldLevel = String(nextEmployees[empIdx].level || '').trim();
            oldPosition = String(nextEmployees[empIdx].position || '').trim();
            const promoRecord = {
              date: hrmsNowISO().slice(0, 10),
              fromLevel: oldLevel,
              toLevel: isSkillBump ? oldLevel : (newLevel || oldLevel),
              fromPosition: oldPosition,
              toPosition: isSkillBump ? oldPosition : (newPosition || oldPosition),
              promoTier: formalPromoTier,
              reason: promoReason,
              approvalId: String(updated.id || '')
            };
            const history = Array.isArray(nextEmployees[empIdx].promotionHistory) ? nextEmployees[empIdx].promotionHistory.slice() : [];
            history.push(promoRecord);
            nextEmployees[empIdx] = {
              ...nextEmployees[empIdx],
              ...(isSkillBump ? {} : { level: newLevel || nextEmployees[empIdx].level, position: newPosition || nextEmployees[empIdx].position }),
              ...(hasPromotedSalary ? { salary: Number(promotedSalary.toFixed(2)) } : {}),
              promotionHistory: history
            };
            state = { ...state, employees: nextEmployees };
          }

          if (hasPromotedSalary) {
            const newSalary = Number(promotedSalary.toFixed(2));
            const oldSalaryNum = Number(oldSalary);
            const rec = {
              id: randomUUID(),
              approvalId: String(updated.id || ''),
              source: 'promotion_formal',
              targetUsername: applicantUser,
              targetName: applicantName,
              store: applicantStore,
              oldSalary: Number.isFinite(oldSalaryNum) ? Number(oldSalaryNum.toFixed(2)) : null,
              newSalary,
              delta: Number.isFinite(oldSalaryNum) ? Number((newSalary - oldSalaryNum).toFixed(2)) : null,
              approvedBy: username,
              approvedAt: hrmsNowISO(),
              reason: promoReason,
              chain: Array.isArray(updated.chain)
                ? updated.chain.map((s) => ({
                    step: Number(s?.step || 0) || 0,
                    assignee: String(s?.assignee || '').trim(),
                    status: String(s?.status || '').trim(),
                    decidedAt: String(s?.decidedAt || '').trim()
                  }))
                : []
            };
            const historyRows = Array.isArray(state.salaryChangeHistory) ? state.salaryChangeHistory.slice() : [];
            historyRows.unshift(rec);
            state = { ...state, salaryChangeHistory: historyRows };

            // 晋升调薪：次月1日生效（底薪时间线）；当月仍按旧薪计
            try {
              const tidPromo = req.tenantId || req.user?.tenant_id || 'default';
              if (Number.isFinite(oldSalaryNum) && oldSalaryNum > 0) {
                const joinD = safeDateOnly(applicant?.joinDate || applicant?.hireDate) || `${hrmsNowISO().slice(0, 7)}-01`;
                await insertSalaryTimeline({
                  tenantId: tidPromo,
                  username: applicantUser,
                  amount: oldSalaryNum,
                  effectiveFrom: joinD,
                  source: 'profile_baseline',
                  note: '晋升前底薪基线',
                  createdBy: username
                });
              }
              await applyPromotionSalaryNextMonth({
                tenantId: tidPromo,
                username: applicantUser,
                newSalary,
                approvalId: updated.id,
                approvedAt: hrmsNowISO().slice(0, 10),
                createdBy: username
              });
            } catch (tlErr) {
              console.error('[promotion] salary timeline failed:', tlErr?.message);
            }
          }

          // 闭环收尾：标记晋升资格记录已完成，并为新岗位尚未认证的晋升能力要求知识点派发培训任务
          const trackId = String(updated.payload?.promotionTrackId || '').trim();
          const tracks = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
          const trackIdx = tracks.findIndex(t => String(t?.id || '').trim() === trackId);
          if (trackIdx >= 0) {
            tracks[trackIdx] = { ...tracks[trackIdx], status: 'promoted', updatedAt: hrmsNowISO() };
          }

          // skill_bump 不升级，不需要新岗位培训任务
          if (!isSkillBump && newPosition) {
            const newPosTopics = await getPromotionRequiredTopics(newPosition, newLevel);
            if (newPosTopics.length) {
              const progress = await getPromotionTrackProgress(applicantUser, newPosTopics.map(t => t.id));
              const certifiedIds = new Set(progress.items.filter(i => i.certified).map(i => i.topicId));
              for (const topic of newPosTopics) {
                if (certifiedIds.has(topic.id)) continue;
                await createTrainingAssignment({
                  employeeUsername: applicantUser,
                  topicId: topic.id,
                  assignedBy: applicantManager || username,
                  note: `晋升至「${newPosition}」后的岗位培训`,
                  requirePractice: true,
                  source: 'promotion_formal',
                  relatedTrackId: trackId || null,
                  tenantId: req.tenantId || req.user?.tenant_id
                });
              }
            }
          }

          // Notify applicant + direct supervisor (正式晋升通过)
          const msg = `${applicantName}，恭喜，你的晋升已经审批通过。`;
          const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
          const notifs = recipients.map(u => makeNotif(u, '晋升申请已通过', msg, { type: 'promotion_result', approvalId: updated.id }));

          // 原子合并，避免 saveSharedState 全量写回与并发请求互相覆盖
          await mergeSharedStateFields(
            {
              employees: state.employees,
              salaryChangeHistory: state.salaryChangeHistory,
              notifications: notifs,
              ...(trackIdx >= 0 ? { promotionTracks: tracks } : {})
            },
            { employees: 'username', notifications: 'id', ...(trackIdx >= 0 ? { promotionTracks: 'id' } : {}) }
          );
        }

        if (finalApproved && stage === 'qualification') {
          const targetPosition = String(updated.payload?.targetPosition || updated.payload?.newPosition || '').trim();
          const targetLevel = String(updated.payload?.targetLevel || updated.payload?.newLevel || '').trim();
          const mentorUsername = String(updated.payload?.mentorUsername || '').trim();
          const mentorName = String(updated.payload?.mentorName || '').trim();
          const trainingStartDate = safeDateOnly(updated.payload?.trainingStartDate) || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          const trainingDays = Math.max(1, Math.min(30, Number(updated.payload?.trainingDays || 3) || 3));
          const trainingPeriods = normalizePromotionTrainingPeriods(updated.payload?.trainingPeriods);

          // 培训-晋升单一渠道：能力要求 = 培训知识库中标记了该岗位「晋升要求」的知识点
          // skill_bump: 申请人自选技能项（不升级，只涨工资）；level_promotion: 由系统按目标岗位+级别自动取全套
          const promoTier = String(updated.payload?.promoTier || 'level_promotion').trim();
          let requiredTopics;
          if (promoTier === 'skill_bump') {
            const selIds = Array.isArray(updated.payload?.selectedTopicIds)
              ? updated.payload.selectedTopicIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
              : [];
            if (selIds.length) {
              const sr = await pool.query('SELECT * FROM training_topics WHERE id = ANY($1::int[]) AND is_active = true ORDER BY sort_order, id', [selIds]);
              requiredTopics = sr.rows;
            } else {
              requiredTopics = [];
            }
          } else {
            requiredTopics = await getPromotionRequiredTopics(targetPosition, targetLevel);
          }

          let trainingDueDate = trainingStartDate;
          if (trainingPeriods.length) {
            trainingDueDate = trainingPeriods[trainingPeriods.length - 1].endDate;
          } else {
            const dueTs = new Date(trainingStartDate + 'T00:00:00').getTime() + (trainingDays - 1) * 86400000;
            trainingDueDate = new Date(dueTs).toISOString().slice(0, 10);
          }

          const trackId = randomUUID();
          const tracks = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
          tracks.unshift({
            id: trackId,
            approvalId: String(updated.id || ''),
            applicantUsername: applicantUser,
            applicantName,
            applicantRole: applicantRole,
            store: applicantStore,
            department: applicantDepartment,
            currentLevel: String(updated.payload?.currentLevel || applicant?.level || '').trim(),
            currentPosition: String(updated.payload?.currentPosition || applicantPosition || '').trim(),
            targetPosition,
            targetLevel,
            promotionType: String(updated.payload?.promotionType || '').trim(),
            promoTier,
            mentorUsername,
            mentorName,
            requiredTopicIds: requiredTopics.map(t => t.id),
            trainingStartDate,
            trainingDays,
            trainingPeriods,
            trainingDueDate,
            assessmentStatus: 'pending',
            formalApplied: false,
            status: 'qualification_approved',
            createdAt: hrmsNowISO(),
            updatedAt: hrmsNowISO()
          });
          state = { ...state, promotionTracks: tracks };

          // 唯一渠道：为每个晋升能力要求知识点创建培训指派
          for (const topic of requiredTopics) {
            await createTrainingAssignment({
              employeeUsername: applicantUser,
              topicId: topic.id,
              assignedBy: mentorUsername || username,
              dueDate: trainingDueDate,
              note: `晋升至「${targetPosition}」的能力要求培训`,
              requirePractice: true,
              source: 'promotion_qualification',
              relatedTrackId: trackId,
              tenantId: req.tenantId || req.user?.tenant_id
            });
          }

          const isKitchen = isKitchenByRoleOrPosition(applicantRole, applicantPosition, applicantDepartment);
          const productionManagerByStore = pickStoreRoleUsernameByStore(state, applicantStore, ['store_production_manager']);
          const storeManagerByStore = pickStoreRoleUsernameByStore(state, applicantStore, ['store_manager']);
          const hqManager = await pickHqManagerUsername(state);
          const mentorDisplay = mentorName || mentorUsername || '待指定带教人';

          const title = '晋升资格申请已批准';
          const msg = `${applicantName}的晋升资格申请已批准，指定带教人：${mentorDisplay}。请积极投入培训与考核，争取早日晋升成功！`;
          const recipients = uniqUsernames([
            applicantUser,
            mentorUsername,
            storeManagerByStore,
            hqManager,
            isKitchen ? productionManagerByStore : ''
          ].filter(Boolean));
          const notifications = recipients.map((u) => makeNotif(u, title, msg, { type: 'promotion_qualification_approved', approvalId: updated.id }));
          if (requiredTopics.length) {
            const planMsg = `系统已根据培训知识库为${applicantName}生成晋升能力培训任务：${requiredTopics.map(t => t.title).join('、')}，截止日期：${trainingDueDate}。`;
            notifications.push(...recipients.map((u) => makeNotif(u, '晋升培训任务已生成', planMsg, { type: 'promotion_training_plan', approvalId: updated.id })));
          }
          await appendNotifications(notifications);

          // 原子合并，避免 saveSharedState 全量写回与并发请求互相覆盖
          await mergeSharedStateFields(
            { promotionTracks: tracks },
            { promotionTracks: 'id' }
          );
        }

        if (finalRejected) {
          // Notify applicant + direct supervisor
          const stageLabel = stage === 'formal' ? '正式晋升' : '晋升资格';
          const msg = `${applicantName}，你的${stageLabel}申请因为${note || '相关原因'}没有审批通过。`;
          const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
          await appendNotifications(recipients.map((u) => makeNotif(u, '晋升申请未通过', msg, { type: 'promotion_result', approvalId: updated.id })));

          // P3: 正式晋升被拒 → 标记 track 为 formal_rejected 并重置 formalApplied，允许修改后重申
          if (stage === 'formal') {
            const formalTrackId = String(updated.payload?.promotionTrackId || '').trim();
            if (formalTrackId) {
              try {
                const stF = (await getSharedState()) || {};
                const tracksF = Array.isArray(stF.promotionTracks) ? stF.promotionTracks.slice() : [];
                const tIdx = tracksF.findIndex(t => String(t?.id || '').trim() === formalTrackId);
                if (tIdx >= 0) {
                  tracksF[tIdx] = { ...tracksF[tIdx], status: 'formal_rejected', formalApplied: false, updatedAt: hrmsNowISO() };
                  await mergeSharedStateFields({ promotionTracks: tracksF }, { promotionTracks: 'id' });
                }
              } catch (p3e) { console.warn('[promotion-p3] track update failed:', p3e?.message); }
            }
          }
        }

        // Intermediate step: notify next approver
        if (String(updated.status || '') === 'pending' && nextAssignee) {
          const stageLabel = stage === 'formal' ? '正式晋升申请' : '晋升资格申请';
          const nextAssigneeRec = stateFindUserRecord(state, nextAssignee) || {};
          const nextRole = String(nextAssigneeRec?.role || '').trim();
          const needAssignMentorTip = (stage === 'qualification' && nextRole === 'store_manager')
            ? '（通过时请指定带教人并确认培训起始日期）'
            : '';
          const msg = `${applicantName} 提交了${stageLabel}，需要您审批${needAssignMentorTip}。`;
          await appendNotifications([makeNotif(nextAssignee, '晋升申请待审批', msg, { type: 'promotion_request', approvalId: updated.id })]);
        }
      }
    } catch (e) { /* ignore */ }

    // --- Reward/Punishment post-approval ---
    try {
      if (updated && String(updated.type || '') === 'reward_punishment') {
        const state0 = (await getSharedState()) || {};
        const applicantUser = String(updated.applicant_username || '').trim();
        const applicant = stateFindUserRecord(state0, applicantUser) || {};
        const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
        const finalApproved = String(updated.status || '') === 'approved';
        const finalRejected = String(updated.status || '') === 'rejected';
        let state = state0;

        const targetUsername = String(updated.payload?.targetUsername || updated.payload?.employeeUsername || '').trim();
        const targetRec = targetUsername ? (stateFindUserRecord(state, targetUsername) || {}) : {};
        const targetName = String(targetRec?.name || targetUsername).trim() || targetUsername || applicantName;
        const rpType = String(updated.payload?.rpType || updated.payload?.category || '').trim();
        const amount = safeNumber(updated.payload?.amount);
        const rpReason = String(updated.payload?.reason || '').trim();
        const rpResult = String(updated.payload?.result || '').trim();
        const isReward = rpType === '奖励' || rpType === 'reward';
        const typeLabel = isReward ? '奖励' : '惩罚';

        if (finalApproved) {
          // Add to salary adjustment records
          const salaryAdj = {
            id: randomUUID(),
            approvalId: String(updated.id || ''),
            targetUsername: targetUsername || applicantUser,
            targetName,
            type: rpType || typeLabel,
            amount: Math.abs(amount || 0),
            signedAmount: isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0),
            reason: rpReason,
            result: rpResult,
            applicantUsername: applicantUser,
            applicantName,
            createdAt: hrmsNowISO(),
            status: 'approved'
          };
          const adjList = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments.slice() : [];
          adjList.unshift(salaryAdj);
          state = { ...state, salaryAdjustments: adjList };

          // 双写：奖惩记录同步到 hrms_reward_punishment_records 表
          try {
            await pool.query(
              `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, points, amount, reason, source, approval_id, status, created_by, tenant_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approval',$11,'active',$12,$13)
               ON CONFLICT (id) DO UPDATE SET
                 status='active', amount=$9, reason=$10`,
              [salaryAdj.id, targetUsername || applicantUser, targetName,
               String(targetRec?.store || '').trim(), String(targetRec?.brand || '').trim(),
               isReward ? 'reward' : 'punishment', rpType,
               isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0),
               Math.abs(amount || 0), rpReason, updated.id, applicantUser,
               req.tenantId || req.user?.tenant_id || 'default']
            );
          } catch (e) {
            console.error('[reward_punishment_records] dual-write failed:', e?.message);
            void notifyAdminsDualWriteFailure('hrms_reward_punishment_records（奖惩审批双写）', e);
          }

          // 薪资账本：按业务发生月入账（与终审日无关）
          try {
            const tidRp = req.tenantId || req.user?.tenant_id || 'default';
            const bizMonthRp = safeBizMonth(
              updated.payload?.bizMonth || updated.payload?.businessMonth || updated.payload?.occurMonth
              || updated.payload?.occurDate || updated.payload?.eventDate || updated.payload?.date
            ) || hrmsNowISO().slice(0, 7);
            const signed = isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0);
            await upsertPayrollLedgerEntry({
              tenantId: tidRp,
              username: targetUsername || applicantUser,
              store: String(targetRec?.store || '').trim(),
              bizMonth: bizMonthRp,
              entryType: isReward ? 'reward' : 'punishment',
              amount: signed,
              title: typeLabel,
              reason: rpReason,
              approvalId: updated.id,
              createdBy: username
            });
          } catch (ledErr) {
            console.error('[reward_punishment] payroll ledger failed:', ledErr?.message);
          }

          // Notify target person (the one being rewarded/punished)
          const notifications = [];
          if (targetUsername) {
            const msgTarget = isReward
              ? `${targetName}，由于${rpReason || '工作表现优秀'}原因，本月你会收到${amount || 0}元的奖励，继续努力哦！`
              : `${targetName}，由于${rpReason || '相关原因'}原因，本月你会收到${amount || 0}元的处罚，希望可以加油改进！`;
            notifications.push(makeNotif(targetUsername, `${typeLabel}通知`, msgTarget, { type: 'reward_punishment_result', approvalId: updated.id }));
          }
          // Notify initiator (applicant)
          const msgApplicant = isReward
            ? `${targetName}的奖励申请已审批通过，金额${amount || 0}元已计入薪资表。`
            : `${targetName}的处罚申请已审批通过，金额${amount || 0}元已计入薪资表。`;
          notifications.push(makeNotif(applicantUser, `${typeLabel}申请已通过`, msgApplicant, { type: 'reward_punishment_result', approvalId: updated.id }));
          await appendNotifications(notifications);
        }

        if (finalRejected) {
          const msg = `对${targetName}的${typeLabel}申请因为${note || '相关原因'}没有审批通过。`;
          await appendNotifications([makeNotif(applicantUser, `${typeLabel}申请未通过`, msg, { type: 'reward_punishment_result', approvalId: updated.id })]);
        }

        // Intermediate step: notify next approver
        if (String(updated.status || '') === 'pending' && nextAssignee) {
          const msg = `${applicantName} 提交了${typeLabel}申请（${targetName}），需要您审批。`;
          await appendNotifications([makeNotif(nextAssignee, `${typeLabel}申请待审批`, msg, { type: 'reward_punishment_request', approvalId: updated.id })]);
        }
      }
    } catch (e) { /* ignore */ }

    // --- Points post-approval ---
    // IMPORTANT: uses mergeSharedStateFields to avoid Read-Modify-Write race condition
    // that would overwrite concurrent pointRecords written by other approvers
    try {
      if (updated && String(updated.type || '') === 'points') {
        const state0 = (await getSharedState()) || {};
        const applicantUser = String(updated.applicant_username || '').trim();
        const applicant = stateFindUserRecord(state0, applicantUser) || {};
        const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
        const applicantManager = String(applicant?.managerUsername || '').trim();
        const finalApproved = String(updated.status || '') === 'approved';
        const finalRejected = String(updated.status || '') === 'rejected';
        const approvalId = String(updated.id || '').trim();

        // payload.items[]: multi-item payload (one item per employee event)
        const rawItems = Array.isArray(updated.payload?.items) ? updated.payload.items : null;
        const store = String(updated.payload?.store || applicant?.store || '').trim();
        // 业务发生月优先（与终审日无关）
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
          // Idempotency: skip if this approval was already applied
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

            // 每人写入薪资账本（业务发生月）；不再把积分预写进 payrollAdjustments 与人工补贴抢字段
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

            // Atomic targeted merge — does NOT overwrite other concurrent writes
            await mergeSharedStateFields({
              pointRecords: newRecords,
              pointsAppliedApprovals: { [approvalId]: true }
            }, { pointRecords: 'id' });

            // Dual-write to point_records table (authoritative backup)
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

          // Notifications: read fresh state AFTER the atomic merge
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
      }
    } catch (e) { /* ignore */ }

    // --- Monthly confirm post-approval ---
    try {
      if (updated && String(updated.type || '') === 'monthly_confirm') {
        const state0 = (await getSharedState()) || {};
        const applicantUser = String(updated.applicant_username || '').trim();
        const applicant = stateFindUserRecord(state0, applicantUser) || {};
        const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
        const payload = typeof updated.payload === 'string' ? JSON.parse(updated.payload) : (updated.payload || {});
        const confirmationId = String(payload?.confirmationId || '').trim();
        const mcMonth = String(payload?.month || '').trim();
        const mcStore = String(payload?.store || '').trim();

        if (String(updated.status || '') === 'approved' && confirmationId) {
          const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
          const mc = confirmations.find(c => c.id === confirmationId);
          if (mc) {
            mc.status = 'approved';
            mc.approvedAt = hrmsNowISO();
            mc.history = mc.history || [];
            mc.history.push({ action: 'approved', by: 'system', at: hrmsNowISO() });
            await mergeSharedStateFields({ monthlyConfirmations: [mc] }, { monthlyConfirmations: 'id' });
          }

          // Notify submitter
          const msg = `${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认已通过审批。工资数据将自动生成。`;
          await appendNotifications([makeNotif(applicantUser, '月度考勤确认已通过', msg, { type: 'monthly_confirm_result', approvalId: updated.id })]);
        }

        if (String(updated.status || '') === 'rejected' && confirmationId) {
          const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
          const mc = confirmations.find(c => c.id === confirmationId);
          if (mc) {
            mc.status = 'rejected';
            mc.history = mc.history || [];
            mc.history.push({ action: 'rejected', by: String(req.user?.username || ''), at: hrmsNowISO(), note });
            await mergeSharedStateFields({ monthlyConfirmations: [mc] }, { monthlyConfirmations: 'id' });
          }
          const msg = `${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认被驳回${note ? `：${note}` : ''}`;
          await appendNotifications([makeNotif(applicantUser, '月度考勤确认被驳回', msg, { type: 'monthly_confirm_result', approvalId: updated.id })]);
        }

        // Intermediate step: notify next approver
        if (String(updated.status || '') === 'pending' && nextAssignee) {
          let _state = state0;
          const msg = `${applicantName} 提交了 ${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认，需要您审批。`;
          await appendNotifications([makeNotif(nextAssignee, '月度考勤确认待审批', msg, { type: 'monthly_confirm_request', approvalId: updated.id })]);
        }
      }
    } catch (e) { console.error('monthly_confirm post-approval error:', e); }

    // 飞书通知：审批流转时通知下一审批人 / 审批结果通知申请人
    try {
      if (updated) {
        const feishuState = (await getSharedState()) || {};
        const feishuApplicant = stateFindUserRecord(feishuState, updated.applicant_username) || {};
        const feishuApplicantName = String(feishuApplicant?.name || updated.applicant_username).trim() || updated.applicant_username;
        const feishuLabel = approvalTypeLabel(String(updated.type || ''));

        if (String(updated.status || '') === 'pending' && nextAssignee) {
          // 中间步骤：通知下一审批人
          (async () => {
            try {
              const fu = await lookupFeishuUserByUsername(nextAssignee);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${feishuApplicantName} 提交了${feishuLabel}申请，需要您审批。\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            } catch (e) { console.error('[approval-decide] feishu notify next error:', e?.message); }
          })();
        }

        if (String(updated.status || '') === 'approved' || String(updated.status || '') === 'rejected') {
          // 最终结果：通知申请人
          const resultText = String(updated.status || '') === 'approved' ? '已通过' : '被拒绝';
          (async () => {
            try {
              const fu = await lookupFeishuUserByUsername(updated.applicant_username);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 审批结果】\n\n${feishuApplicantName}，您的${feishuLabel}申请${resultText}。${note ? `\n原因：${note}` : ''}\n\n请登录 HRMS 查看详情：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            } catch (e) { console.error('[approval-decide] feishu notify applicant error:', e?.message); }
          })();
        }
      }
    } catch (e) { /* ignore */ }

    const __decideMs = Date.now() - __decideStartedAt;
    console.log('[approval-decide] ok', { id, ms: __decideMs, status: updated?.status, type: updated?.type });
    return res.json(Object.keys(decideExtras).length ? { item: updated, decideMs: __decideMs, ...decideExtras } : { item: updated, decideMs: __decideMs });
  } catch (e) {
    console.log('[approval-decide] error', { id, ms: Date.now() - __decideStartedAt, err: safeErrMessage(e) });
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
}
