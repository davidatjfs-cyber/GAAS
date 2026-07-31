/**
 * P3：租户侧训店员 —— 使用门店 JWT（authRequired），仅 tenant/both 受众人格。
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

const log = childLogger({ domain: 'sales-sim', handler: 'routes-tenant' });
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function tenantUser(req) {
  return {
    username: req.user?.username || req.auth?.username || 'staff',
    tenantId: req.user?.tenant_id || req.auth?.tenant_id || req.headers['x-tenant-id'] || 'default',
  };
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
  const { app, pool, authRequired } = ctx;
  if (typeof authRequired !== 'function') return;

  app.get('/api/sales-sim/personas', authRequired, async (req, res) => {
    try {
      const { tenantId } = tenantUser(req);
      const personas = await listSimPersonas(pool, 'cs', { audience: 'tenant', tenantId });
      res.json({ ok: true, personas });
    } catch (e) {
      log.error({ msg: 'tenant_personas', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/rank', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      res.json({ ok: true, ...(await getSimRank(pool, username, 'cs')) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/curriculum/next', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      res.json(await recommendNextSession(pool, username, 'cs'));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/sales-sim/sessions', authRequired, async (req, res) => {
    try {
      const { username } = tenantUser(req);
      res.json({
        ok: true,
        sessions: await listSessionHistory(pool, username, { track: 'cs', limit: 20 }),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/sales-sim/sessions', authRequired, async (req, res) => {
    try {
      const { username, tenantId } = tenantUser(req);
      const result = await startSession(pool, {
        username,
        track: 'cs',
        personaKey: req.body?.persona_key,
        difficulty: req.body?.difficulty,
        audience: 'tenant',
        tenantId,
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
          return res.status(400).json({ ok: false, error: 'missing_audio', message: '没录到声音，请点「开始录音」后再试' });
        }
        const text = await transcribeBrowserVoice(req.file.buffer, { mimeType: req.file.mimetype });
        if (!text) {
          return res.status(400).json({ ok: false, error: 'asr_failed', message: '没听清，请再说一次或改打字' });
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
