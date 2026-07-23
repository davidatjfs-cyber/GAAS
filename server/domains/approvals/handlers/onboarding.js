export async function beforeUpdate(_ctx) {}

export async function afterDecide(ctx) {
  const {
    req,
    deps,
    updated,
    nextAssignee,
    note,
    username,
    decideExtras,
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
    safeDateOnly,
    safeErrMessage,
    toNullableUuid,
    buildOnboardingEmployeeRecordFromPayload,
    insertSalaryTimeline,
    bcrypt,
  } = deps;

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
        await mergeSharedStateFields({ employees: [nextEmp] }, { employees: 'username' });
        decideExtras.onboardingEmployeeSync = { ok: true, username: newUsername };
      } catch (mergeErr) {
        console.error('[approval/onboarding] mergeSharedStateFields(employees) 失败', {
          approvalId: updated.id,
          username: newUsername,
          err: safeErrMessage(mergeErr)
        });
        decideExtras.onboardingEmployeeSync = { ok: false, reason: 'merge_failed', username: newUsername };
      }

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
        const title = '新员工入职审批待处理';
        const msg = `${applicantName} 提交的新员工「${empName}」入职申请需要您审批。`;
        await appendNotifications([makeNotif(nextAssignee, title, msg, { type: 'onboarding_request', approvalId: updated.id })]);
      }

      if (String(updated.status || '') === 'rejected') {
        const title = '新员工入职审批被拒绝';
        const msg = `新员工「${empName}」入职申请被拒绝${note ? `：${note}` : ''}`;
        await appendNotifications([makeNotif(applicantUser, title, msg, { type: 'onboarding_result', approvalId: updated.id })]);
      }
    }
  } catch (e) { /* ignore */ }
}
