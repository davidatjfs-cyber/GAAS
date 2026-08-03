import multer from 'multer';
import { childLogger } from '../../utils/logger.js';
import { transcribeBrowserVoice } from '../../services/sales/sales-asr.js';
import { synthesizeSpeechMp3 } from '../../services/sales/sales-tts.js';
import {
  listSimPersonas,
  listSimPlaybooks,
  getSimRank,
  startSession,
  submitTurn,
  finishSession,
  getSessionDetail,
  listSessionHistory,
} from './session-service.js';
import { recommendNextSession } from './curriculum.js';
import { setMentorEligible } from './rank.js';
import {
  nominatePlaybook, listPendingPlaybooks, reviewPlaybook,
} from './playbook-lifecycle.js';
import {
  listMenteeSessions, addMentorNote, listMentorNotes, assertMentor,
} from './mentor.js';
import {
  createBusinessPersonaFromPayload, createBusinessPersonaFromLead,
} from './business-persona.js';
import { buildTrainingDashboard } from './dashboard.js';
import { listNotifications, markNotificationRead, unreadCount } from './notify.js';

const log = childLogger({ domain: 'sales-sim', handler: 'routes-admin' });
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function usernameOf(req) {
  return req.platformAdmin?.username || 'admin';
}

function isManager(req) {
  const role = req.platformAdmin?.role || '';
  return ['super_admin', 'sales_manager', 'admin', 'gm'].includes(role) || role.includes('manager');
}

async function tryTtsBase64(text, rolloutKey) {
  try {
    const { mp3 } = await synthesizeSpeechMp3(text, { rolloutKey });
    if (!mp3?.length) return null;
    return mp3.toString('base64');
  } catch (e) {
    log.warn({ msg: 'sales_sim_tts_skip', err: e?.message || e });
    return null;
  }
}

/** @param {{ app: any, pool: any, platformAdminRequired: Function }} ctx */
export function registerSalesSimAdminRoutes(ctx) {
  registerSimCatalogRoutes(ctx);
  registerSimSessionRoutes(ctx);
  registerSimOpsRoutes(ctx);
}

function registerSimCatalogRoutes({ app, pool, platformAdminRequired }) {
  app.get('/api/admin/sales-sim/personas', platformAdminRequired, async (req, res) => {
    try {
      const personas = await listSimPersonas(pool, req.query.track || null, {
        audience: req.query.audience || 'internal',
      });
      res.json({ ok: true, personas });
    } catch (e) {
      log.error({ msg: 'sales_sim_personas', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/playbooks', platformAdminRequired, async (req, res) => {
    try {
      res.json({ ok: true, playbooks: await listSimPlaybooks(pool, req.query.track || null) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/rank', platformAdminRequired, async (req, res) => {
    try {
      const track = req.query.track === 'cs' ? 'cs' : 'sales';
      res.json({ ok: true, ...(await getSimRank(pool, usernameOf(req), track)) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/curriculum/next', platformAdminRequired, async (req, res) => {
    try {
      const track = req.query.track === 'cs' ? 'cs' : 'sales';
      res.json(await recommendNextSession(pool, usernameOf(req), track));
    } catch (e) {
      log.error({ msg: 'sales_sim_curriculum', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

function registerSimSessionRoutes({ app, pool, platformAdminRequired }) {
  app.get('/api/admin/sales-sim/sessions', platformAdminRequired, async (req, res) => {
    try {
      const rows = await listSessionHistory(pool, usernameOf(req), {
        track: req.query.track || null,
        limit: Number(req.query.limit) || 20,
      });
      res.json({ ok: true, sessions: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/sessions', platformAdminRequired, async (req, res) => {
    try {
      const track = ['sales', 'cs', 'consult'].includes(req.body?.track) ? req.body.track : 'sales';
      const result = await startSession(pool, {
        username: usernameOf(req),
        track,
        personaKey: req.body?.persona_key,
        difficulty: req.body?.difficulty,
        audience: 'internal',
        coachPersonaKey: req.body?.coach_persona_key || null,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'sales_sim_start', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/sessions/:id', platformAdminRequired, async (req, res) => {
    try {
      const result = await getSessionDetail(pool, Number(req.params.id), usernameOf(req));
      if (result.ok) {
        result.mentor_notes = await listMentorNotes(pool, Number(req.params.id));
      }
      res.status(result.ok ? 200 : 404).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/sessions/:id/turn', platformAdminRequired, async (req, res) => {
    try {
      const result = await submitTurn(pool, {
        sessionId: Number(req.params.id),
        username: usernameOf(req),
        text: req.body?.text,
        voice: !!req.body?.voice,
      });
      if (result.ok && result.customer?.content && req.body?.tts) {
        result.customer_audio_base64 = await tryTtsBase64(result.customer.content, usernameOf(req));
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'sales_sim_turn', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post(
    '/api/admin/sales-sim/sessions/:id/turn-voice',
    platformAdminRequired,
    voiceUpload.single('audio'),
    async (req, res) => {
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({
            ok: false, error: 'missing_audio', message: '没录到声音，请点「语音输入」后再试',
          });
        }
        const text = await transcribeBrowserVoice(req.file.buffer, { mimeType: req.file.mimetype });
        if (!text) {
          return res.status(400).json({
            ok: false, error: 'asr_failed', message: '没听清，请再说一次或改打字',
          });
        }
        const result = await submitTurn(pool, {
          sessionId: Number(req.params.id),
          username: usernameOf(req),
          text,
          voice: true,
        });
        if (result.ok) {
          result.transcript = text;
          if (result.customer?.content) {
            result.customer_audio_base64 = await tryTtsBase64(result.customer.content, usernameOf(req));
          }
        }
        res.status(result.ok ? 200 : 400).json(result);
      } catch (e) {
        log.error({ msg: 'sales_sim_turn_voice', err: e?.message || e });
        res.status(500).json({ ok: false, error: 'server_error' });
      }
    }
  );

  app.post('/api/admin/sales-sim/sessions/:id/finish', platformAdminRequired, async (req, res) => {
    try {
      const result = await finishSession(pool, {
        sessionId: Number(req.params.id),
        username: usernameOf(req),
        outcome: req.body?.outcome || 'completed',
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'sales_sim_finish', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

function registerSimOpsRoutes({ app, pool, platformAdminRequired }) {
  app.post('/api/admin/sales-sim/playbooks/nominate', platformAdminRequired, async (req, res) => {
    try {
      const result = await nominatePlaybook(pool, {
        track: req.body?.track === 'cs' ? 'cs' : 'sales',
        targetSceneKey: req.body?.target_scene_key,
        title: req.body?.title,
        exemplarText: req.body?.exemplar_text,
        principleIds: req.body?.principle_ids || [],
        originalTraineeText: req.body?.original_trainee_text,
        sessionId: req.body?.session_id ? Number(req.body.session_id) : null,
        username: usernameOf(req),
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/playbooks/pending', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
      res.json({ ok: true, items: await listPendingPlaybooks(pool, req.query.track || null) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/playbooks/:id/review', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const result = await reviewPlaybook(pool, {
        id: Number(req.params.id),
        approve: !!req.body?.approve,
        reviewerUsername: usernameOf(req),
        sourceLabel: req.body?.source_label,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/rank/mentor-eligible', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const track = req.body?.track === 'cs' ? 'cs' : 'sales';
      const status = await setMentorEligible(pool, {
        username: req.body?.username,
        track,
        eligible: req.body?.eligible !== false,
        actor: usernameOf(req),
      });
      res.json({ ok: true, ...status });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/mentor/sessions', platformAdminRequired, async (req, res) => {
    try {
      const track = req.query.track === 'cs' ? 'cs' : (req.query.track === 'sales' ? 'sales' : null);
      const ok = track ? await assertMentor(pool, usernameOf(req), track) : (
        await assertMentor(pool, usernameOf(req), 'sales') || await assertMentor(pool, usernameOf(req), 'cs')
      );
      if (!ok && !isManager(req)) return res.status(403).json({ ok: false, error: 'not_mentor' });
      res.json({
        ok: true,
        sessions: await listMenteeSessions(pool, {
          track,
          menteeUsername: req.query.username || null,
          limit: Number(req.query.limit) || 40,
        }),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/mentor/notes', platformAdminRequired, async (req, res) => {
    try {
      const result = await addMentorNote(pool, {
        sessionId: Number(req.body?.session_id),
        mentorUsername: usernameOf(req),
        note: req.body?.note,
      });
      if (!result.ok && result.error === 'not_mentor' && isManager(req)) {
        const r = await pool.query(
          `INSERT INTO sales_sim_mentor_notes (session_id, mentor_username, note) VALUES ($1,$2,$3) RETURNING *`,
          [Number(req.body?.session_id), usernameOf(req), String(req.body?.note || '').trim()]
        );
        return res.json({ ok: true, note: r.rows[0] });
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/business-personas', platformAdminRequired, async (req, res) => {
    try {
      const result = req.body?.lead_id
        ? await createBusinessPersonaFromLead(pool, Number(req.body.lead_id))
        : await createBusinessPersonaFromPayload(pool, req.body || {});
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      log.error({ msg: 'sales_sim_biz_persona', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/dashboard', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req) && req.platformAdmin?.role !== 'super_admin') {
        const self = await buildTrainingDashboard(pool, { track: req.query.track || null, limit: 5 });
        self.people = (self.people || []).filter((p) => p.username === usernameOf(req));
        self.recent = (self.recent || []).filter((p) => p.username === usernameOf(req));
        return res.json(self);
      }
      res.json(await buildTrainingDashboard(pool, {
        track: req.query.track || null,
        limit: Number(req.query.limit) || 100,
      }));
    } catch (e) {
      log.error({ msg: 'sales_sim_dashboard', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales-sim/notifications', platformAdminRequired, async (req, res) => {
    try {
      const items = await listNotifications(pool, usernameOf(req), {
        unreadOnly: req.query.unread === '1',
        limit: Number(req.query.limit) || 30,
      });
      res.json({ ok: true, unread: await unreadCount(pool, usernameOf(req)), items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales-sim/notifications/:id/read', platformAdminRequired, async (req, res) => {
    try {
      res.json(await markNotificationRead(pool, usernameOf(req), Number(req.params.id)));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
