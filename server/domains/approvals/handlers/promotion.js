export async function beforeUpdate(ctx) {
  const {
    res,
    row,
    role,
    username,
    nowIso,
    approved,
    mentorUsernameRaw,
    mentorNameRaw,
    trainingStartDateRaw,
    trainingDaysRaw,
    trainingPeriodsRaw,
    promotedSalaryRaw,
    updatedPayload,
    deps,
  } = ctx;
  if (String(row.type || '') !== 'promotion') return;

  const { pool, safeDateOnly, normalizePromotionTrainingPeriods } = deps;

  const stage = String(updatedPayload?.promotionStage || '').trim().toLowerCase();
  if (stage === 'qualification') {
    const currentRole = String(role || '').trim().toLowerCase();
    const isStoreManagerStep = currentRole === 'store_manager';
    if (approved && isStoreManagerStep && !mentorUsernameRaw) {
      res.status(400).json({ error: 'missing_mentor', message: '店长审批时必须指定带教人' });
      return { abort: true };
    }
    if (mentorUsernameRaw) {
      const mentorExists = await pool.query(
        `select 1 from users where lower(username) = lower($1)
         union all
         select 1 from employees where lower(username) = lower($1)
         limit 1`,
        [mentorUsernameRaw]
      );
      if (!mentorExists.rows?.length) {
        res.status(400).json({ error: 'mentor_not_found', message: '带教人账号不存在，请重新选择' });
        return { abort: true };
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
        res.status(400).json({ error: 'missing_promoted_salary', message: '店长审批正式晋升时必须填写晋升后薪资' });
        return { abort: true };
      }
      updatedPayload.promotedSalary = Number(salaryVal.toFixed(2));
      updatedPayload.promotedSalarySetBy = username;
      updatedPayload.promotedSalarySetAt = nowIso;
    }
  }
}

export async function afterDecide(ctx) {
  const {
    req,
    deps,
    updated,
    nextAssignee,
    note,
    username,
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
    randomUUID,
    createTrainingAssignment,
    applyPromotionSalaryNextMonth,
    insertSalaryTimeline,
    findUserSalary,
    getPromotionRequiredTopics,
    getPromotionTrackProgress,
    normalizePromotionTrainingPeriods,
    isKitchenByRoleOrPosition,
    pickHqManagerUsername,
    pickStoreRoleUsernameByStore,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'promotion') return;

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

      const trackId = String(updated.payload?.promotionTrackId || '').trim();
      const tracks = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
      const trackIdx = tracks.findIndex(t => String(t?.id || '').trim() === trackId);
      if (trackIdx >= 0) {
        tracks[trackIdx] = { ...tracks[trackIdx], status: 'promoted', updatedAt: hrmsNowISO() };
      }

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

      const msg = `${applicantName}，恭喜，你的晋升已经审批通过。`;
      const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
      const notifs = recipients.map(u => makeNotif(u, '晋升申请已通过', msg, { type: 'promotion_result', approvalId: updated.id }));

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

      await mergeSharedStateFields(
        { promotionTracks: tracks },
        { promotionTracks: 'id' }
      );
    }

    if (finalRejected) {
      const stageLabel = stage === 'formal' ? '正式晋升' : '晋升资格';
      const msg = `${applicantName}，你的${stageLabel}申请因为${note || '相关原因'}没有审批通过。`;
      const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
      await appendNotifications(recipients.map((u) => makeNotif(u, '晋升申请未通过', msg, { type: 'promotion_result', approvalId: updated.id })));

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
  } catch (e) { /* ignore */ }
}
