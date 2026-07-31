/**
 * 租户侧 Job Coach —— 门店 JWT；按员工岗位解析 job_profile
 */
import multer from 'multer';
import { childLogger } from '../../utils/logger.js';
import { transcribeBrowserVoice } from '../../services/sales/sales-asr.js';
import { synthesizeSpeechMp3 } from '../../services/sales/sales-tts.js';
import {
  listSimPersonas,
  getSimRank,
  startSession,
  submitTurn,
  finishSession,
  getSessionDetail,
  listSessionHistory,
} from './session-service.js';
import { recommendNextSession } from './curriculum.js';
import { listNotifications, markNotificationRead, unreadCount } from './notify.js';
import { resolveJobProfileKey } from './profile-resolve.js';
import { getCoachMemory } from './coach-memory.js';
import { listActiveCompetencies } from './competency.js';
import { buildTrainingDashboard } from './dashboard.js';
import {
  listCategories, listIncidentCards, drawIncidentCard, getIncidentCard,
  attachKbArticles, publicIncidentCard,
} from './incident-cards.js';
import { ensureTalentEngineSeed } from './talent-seed.js';

const log = childLogger({ domain: 'sales-sim', handler: 'routes-tenant' });
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/** 门店岗位教练可用轨（不含销售公司 sales/cs） */
const STORE_PROFILES = new Set([
  'foh_server', 'cashier', 'store_manager', 'kitchen_staff', 'hq_ops',
]);

function tenantUser(req) {
  return {
    username: req.user?.username || req.auth?.username || 'staff',
    tenantId: req.user?.tenant_id || req.auth?.tenant_id || req.headers['x-tenant-id'] || 'default',
    role: req.user?.role || req.auth?.role || '',
    position: req.user?.position || req.auth?.position || '',
    store: req.user?.store || req.auth?.store || req.user?.current_store || '',
  };
}

async function resolveTrack(pool, req) {
  const explicit = req.query?.profile || req.query?.track || req.body?.profile || req.body?.track;
  if (explicit && STORE_PROFILES.has(String(explicit))) return String(explicit);
  const u = tenantUser(req);
  const key = await resolveJobProfileKey(pool, {
    role: u.role,
    position: u.position,
    explicit: explicit || null,
  });
  return STORE_PROFILES.has(key) ? key : 'foh_server';
}

async function tryTtsBase64(text, key) {
  try {
    const { mp3 } = await synthesizeSpeechMp3(text, { rolloutKey: key });
    return mp3?.length ? mp3.toString('base64') : null;
  } catch (_) {
    return null;
  }
}

/** @param {{ app: any, pool: any, authRequired: Function }} ctx */
export function registerSalesSimTenantRoutes(ctx) {
  registerTenantMetaRoutes(ctx);
  registerTenantSessionRoutes(ctx);
  registerTenantNotifyRoutes(ctx);
}

function registerTenantMetaRoutes({ app, pool, authRequired }) {
  if (typeof authRequired !== 'function') return;

  app.get('/api/sales-sim/me', authRequired, async (req, res) => {
    try {
      const u = tenantUser(req);
      const track = await resolveTrack(pool, req);
      const memory = await getCoachMemory(pool, u.username, track).catch(() => null);
      const competencies = await listActiveCompetencies(pool, track).catch(() => []);
      const rank = await getSimRank(pool, u.username, track);
      res.json({
        ok: true,
        username: u.username,
        role: u.role,
        position: u.position,
        store: u.store,
        job_profile_key: track,
        memory,
        competencies,
        rank,
      });
    } catch (e) {
      log.error({ msg: 'tenant_me', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/personas', authRequired, async (req, res) => {
    try {
      const { tenantId } = tenantUser(req);
      const track = await resolveTrack(pool, req);
      const personas = await listSimPersonas(pool, track, { audience: 'tenant', tenantId });
      res.json({ ok: true, track, personas });
    } catch (e) {
      log.error({ msg: 'tenant_personas', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/rank', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const track = await resolveTrack(pool, req);
      res.json({ ok: true, track, ...(await getSimRank(pool, username, track)) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/curriculum/next', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const track = await resolveTrack(pool, req);
      res.json(await recommendNextSession(pool, username, track));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/sessions', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const track = await resolveTrack(pool, req);
      res.json({
        ok: true,
        track,
        sessions: await listSessionHistory(pool, username, { track, limit: 20 }),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/dashboard', authRequired, async (req, res) => {
    try {
      const u = tenantUser(req);
      const role = String(u.role || '');
      const canBoss = ['admin', 'hq_manager', 'store_manager', 'hr_manager', 'store_production_manager'].includes(role);
      if (!canBoss) return res.status(403).json({ ok: false, error: 'forbidden' });
      const track = await resolveTrack(pool, req);
      res.json(await buildTrainingDashboard(pool, { track }));
    } catch (e) {
      log.error({ msg: 'tenant_dashboard', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/categories', authRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const track = await resolveTrack(pool, req);
      const categories = await listCategories(pool, track);
      res.json({ ok: true, track, categories });
    } catch (e) {
      log.error({ msg: 'tenant_categories', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/incidents', authRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const track = await resolveTrack(pool, req);
      const cards = await listIncidentCards(pool, {
        jobProfileKey: track,
        categoryKey: req.query.category || null,
        competencyKey: req.query.competency || null,
        limit: Number(req.query.limit) || 50,
      });
      res.json({ ok: true, track, cards });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sales-sim/incidents/draw', authRequired, async (req, res) => {
    try {
      await ensureTalentEngineSeed(pool);
      const track = await resolveTrack(pool, req);
      const card = await drawIncidentCard(pool, {
        jobProfileKey: track,
        categoryKey: req.body?.category || req.body?.category_key || null,
        competencyKey: req.body?.competency || null,
        excludeKeys: Array.isArray(req.body?.exclude) ? req.body.exclude : [],
        maxDifficulty: Number(req.body?.max_difficulty) || 10,
      });
      if (!card) return res.status(404).json({ ok: false, error: 'no_card' });
      res.json({ ok: true, track, incident: publicIncidentCard(card) });
    } catch (e) {
      log.error({ msg: 'tenant_draw', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/incidents/:cardKey', authRequired, async (req, res) => {
    try {
      let card = await getIncidentCard(pool, req.params.cardKey);
      if (!card) return res.status(404).json({ ok: false, error: 'not_found' });
      card = await attachKbArticles(pool, card);
      res.json({ ok: true, incident: publicIncidentCard(card) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

function registerTenantSessionRoutes({ app, pool, authRequired }) {
  if (typeof authRequired !== 'function') return;

  app.post('/api/sales-sim/sessions', authRequired, async (req, res) => {
    try {
      const { username, tenantId } = tenantUser(req);
      const track = await resolveTrack(pool, req);
      const incidentCardKey = req.body?.incident_card_key || req.body?.card_key || null;
      if (!incidentCardKey && !req.body?.persona_key) {
        return res.status(400).json({ ok: false, error: 'incident_required', message: '请先抽取具体事故卡再开始' });
      }
      const result = await startSession(pool, {
        username,
        track,
        personaKey: req.body?.persona_key,
        difficulty: req.body?.difficulty,
        audience: 'tenant',
        tenantId,
        coachPersonaKey: req.body?.coach_persona_key || null,
        examMode: !!req.body?.exam_mode,
        scenarioKey: req.body?.scenario_key || null,
        incidentCardKey,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'tenant_start', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/sessions/:id', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const result = await getSessionDetail(pool, Number(req.params.id), username);
      res.status(result.ok ? 200 : 404).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sales-sim/sessions/:id/turn', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const result = await submitTurn(pool, {
        sessionId: Number(req.params.id),
        username,
        text: req.body?.text,
        voice: !!req.body?.voice,
      });
      if (result.ok && result.customer?.content && req.body?.tts) {
        result.customer_audio_base64 = await tryTtsBase64(result.customer.content, username);
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post(
    '/api/sales-sim/sessions/:id/turn-voice',
    authRequired,
    voiceUpload.single('audio'),
    async (req, res) => {
      try {
        const { username } = tenantUser(req);
        if (!req.file?.buffer?.length) {
          return res.status(400).json({
            ok: false, error: 'missing_audio', message: '没录到声音，请点「开始录音」后再试',
          });
        }
        const text = await transcribeBrowserVoice(req.file.buffer, { mimeType: req.file.mimetype });
        if (!text) {
          return res.status(400).json({
            ok: false, error: 'asr_failed', message: '没听清，请再说一次或改打字',
          });
        }
        const result = await submitTurn(pool, {
          sessionId: Number(req.params.id), username, text, voice: true,
        });
        if (result.ok) {
          result.transcript = text;
          if (result.customer?.content) {
            result.customer_audio_base64 = await tryTtsBase64(result.customer.content, username);
          }
        }
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        res.status(500).json({ ok: false, error: 'server_error' });
      }
    }
  );

  app.post('/api/sales-sim/sessions/:id/finish', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      const result = await finishSession(pool, {
        sessionId: Number(req.params.id),
        username,
        outcome: req.body?.outcome || 'completed',
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

function registerTenantNotifyRoutes({ app, pool, authRequired }) {
  if (typeof authRequired !== 'function') return;

  app.get('/api/sales-sim/notifications', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      res.json({
        ok: true,
        unread: await unreadCount(pool, username),
        items: await listNotifications(pool, username, {
          unreadOnly: req.query.unread === '1',
          limit: Number(req.query.limit) || 30,
        }),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sales-sim/notifications/:id/read', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      res.json(await markNotificationRead(pool, username, Number(req.params.id)));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
