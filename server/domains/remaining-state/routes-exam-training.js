import { childLogger } from '../../utils/logger.js';
import {
  mergeStateFieldsOnClient,
  patchHrmsStateFieldsOnClient,
  withMirrorWriteTx,
} from '../shared/mirror-tx.js';
import { requireRemainingStateAdmin } from './routes-announcements.js';
import { loadQuestionSetsFromTable, saveQuestionSetsToTable } from './question-sets-service.js';

const log = childLogger({ domain: 'remaining-state', handler: 'routes-exam-training' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: any, getSharedState: Function, resolveTenantId: Function }} deps
 */
export function registerRemainingStateExamTrainingRoutes(app, authRequired, deps) {
  const { pool, getSharedState, resolveTenantId, invalidateSharedStateCache } = deps;

  app.get('/api/exam/question-bank', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      let questionSets = Array.isArray(state.questionSets) ? state.questionSets : [];
      try {
        const fromTable = await loadQuestionSetsFromTable(pool, tid);
        if (fromTable.length) questionSets = fromTable;
      } catch (_) { /* 表未迁移时回落 state */ }
      return res.json({
        questionBank: Array.isArray(state.questionBank) ? state.questionBank : [],
        questionSets,
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/exam/question-bank', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const questionBank = Array.isArray(req.body?.questionBank) ? req.body.questionBank : [];
      const questionSets = Array.isArray(req.body?.questionSets) ? req.body.questionSets : [];
      await withMirrorWriteTx(pool, async (client) => {
        await patchHrmsStateFieldsOnClient(client, tid, { questionBank });
        await saveQuestionSetsToTable(client, tid, questionSets);
      });
      if (typeof invalidateSharedStateCache === 'function') invalidateSharedStateCache(tid);
      return res.json({ ok: true, questionBank, questionSets });
    } catch (e) {
      log.error({ msg: 'put_api_exam_question_bank', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/exam/assignments', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      const items = Array.isArray(state.examAssignments) ? state.examAssignments : [];
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/exam/assignments', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const assignment = req.body?.assignment && typeof req.body.assignment === 'object' ? req.body.assignment : req.body;
      if (!assignment || typeof assignment !== 'object') return res.status(400).json({ error: 'missing_assignment' });
      const item = {
        ...assignment,
        id: String(assignment.id || '').trim() || `asg_${Date.now()}`,
        createdAt: String(assignment.createdAt || new Date().toISOString()),
        createdBy: String(assignment.createdBy || req.user?.username || '').trim(),
      };
      await withMirrorWriteTx(pool, async (client) => {
        await mergeStateFieldsOnClient(client, tid, { examAssignments: [item] }, { examAssignments: 'id' });
      });
      return res.json({ ok: true, item });
    } catch (e) {
      log.error({ msg: 'post_api_exam_assignments', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/training-materials', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      return res.json({ items: Array.isArray(state.trainingMaterials) ? state.trainingMaterials : [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/training-materials', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : Array.isArray(req.body?.trainingMaterials)
          ? req.body.trainingMaterials
          : [];
      await withMirrorWriteTx(pool, async (client) => {
        await patchHrmsStateFieldsOnClient(client, tid, { trainingMaterials: items });
      });
      return res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'put_api_training_materials', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
