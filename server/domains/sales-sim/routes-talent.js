/**
 * Talent Engine 配置只读 API（Ability / Profile / Competency / Coach Persona / Memory）
 */

import { childLogger } from '../../utils/logger.js';
import { listAbilities } from './ability.js';
import { listProfiles, listActiveCompetencies } from './competency.js';
import { listCoachPersonas } from './coach-persona.js';
import { getCoachMemory } from './coach-memory.js';
import { recommendLearningLoop } from './learning-loop.js';
import { ensureTalentEngineSeed } from './talent-seed.js';
import { createCaseSource, materializeCaseAsPersona } from './case-gen.js';

const log = childLogger({ domain: 'sales-sim', handler: 'routes-talent' });

/**
 * @param {{ app: any, pool: any, platformAdminRequired: Function, authRequired?: Function }} ctx
 */
export function registerTalentEngineRoutes(ctx) {
  const { app, pool, platformAdminRequired, authRequired } = ctx;

  app.get('/api/admin/talent/abilities', platformAdminRequired, async (_req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      res.json({ ok: true, abilities: await listAbilities(pool) });
    } catch (e) {
      log.error({ msg: 'talent_abilities', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/talent/profiles', platformAdminRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const activeOnly = req.query.all !== '1';
      res.json({ ok: true, profiles: await listProfiles(pool, { activeOnly }) });
    } catch (e) {
      log.error({ msg: 'talent_profiles', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/talent/competencies', platformAdminRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const profileKey = String(req.query.profile || req.query.track || 'sales');
      res.json({
        ok: true,
        job_profile_key: profileKey,
        competencies: await listActiveCompetencies(pool, profileKey),
      });
    } catch (e) {
      log.error({ msg: 'talent_competencies', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/talent/coach-personas', platformAdminRequired, async (_req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      res.json({ ok: true, coach_personas: await listCoachPersonas(pool) });
    } catch (e) {
      log.error({ msg: 'talent_coach_personas', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/talent/memory/:username', platformAdminRequired, async (req, res) => {
    try {
      const profileKey = String(req.query.profile || req.query.track || 'sales');
      const memory = await getCoachMemory(pool, req.params.username, profileKey);
      res.json({ ok: true, memory });
    } catch (e) {
      log.error({ msg: 'talent_memory', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/talent/learning-loop', platformAdminRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const profileKey = String(req.query.profile || req.query.track || 'sales');
      const loop = await recommendLearningLoop(pool, {
        jobProfileKey: profileKey,
        weakestCompetency: req.query.weakest || null,
      });
      res.json(loop);
    } catch (e) {
      log.error({ msg: 'talent_learning_loop', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/talent/cases', platformAdminRequired, async (req, res) => {
    try {
      const result = await createCaseSource(pool, {
        tenantId: req.body?.tenant_id || null,
        sourceType: req.body?.source_type || 'manual',
        sourceRef: req.body?.source_ref || null,
        title: req.body?.title || '',
        rawText: req.body?.raw_text || req.body?.text || '',
        suggestedProfileKey: req.body?.profile || req.body?.job_profile_key || null,
        meta: req.body?.meta || {},
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'talent_case_create', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/talent/cases/:id/materialize', platformAdminRequired, async (req, res) => {
    try {
      const username = req.platformAdmin?.username || 'admin';
      const result = await materializeCaseAsPersona(pool, Number(req.params.id), { username });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'talent_case_materialize', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  if (typeof authRequired === 'function') {
    app.get('/api/talent/my-memory', authRequired, async (req, res) => {
      try {
        const username = req.user?.username;
        const profileKey = String(req.query.profile || req.query.track || 'foh_server');
        if (!username) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const memory = await getCoachMemory(pool, username, profileKey);
        res.json({ ok: true, memory });
      } catch (e) {
        log.error({ msg: 'talent_my_memory', err: e?.message || e });
        res.status(500).json({ ok: false, error: 'server_error' });
      }
    });

    app.post('/api/talent/cases', authRequired, async (req, res) => {
      try {
        const role = req.user?.role || '';
        if (!['admin', 'hq_manager', 'store_manager', 'hr_manager'].includes(role)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        const result = await createCaseSource(pool, {
          tenantId: req.user?.tenant_id || null,
          sourceType: req.body?.source_type || 'complaint',
          sourceRef: req.body?.source_ref || null,
          title: req.body?.title || '',
          rawText: req.body?.raw_text || req.body?.text || '',
          suggestedProfileKey: req.body?.profile || null,
        });
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, error: 'server_error' });
      }
    });
  }
}
