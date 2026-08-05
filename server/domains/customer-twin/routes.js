/**
 * Customer Twin 路由入口（v0 验证版）
 * 1) 真实客诉 → 岗位教练事故卡（生成/待审/审核）
 * 2) 引擎 v0 模拟（盲测用）
 */

import { childLogger } from '../../utils/logger.js';
import {
  generateIncidentCards, listPendingTwinCards, setTwinCardActive, rejectTwinCard,
} from './incident-generator.js';
import { ensureNegativeFeedbackSeed } from './seed-negative-feedback.js';
import { ensureGoldenCaseSeed } from './seed-golden-cases.js';
import { samplePersonas, runSimulation, expressUtterance } from './engine-v0.js';
import { PERSONA_KEYS } from './persona-schema.js';
import { createCustomerTwinAdminRequired } from './admin-guard.js';

const log = childLogger({ domain: 'customer-twin', handler: 'routes' });

async function loadCorpus(pool) {
  await ensureNegativeFeedbackSeed(pool);
  const r = await pool.query(
    `SELECT category, code, expression_style, severity, content
       FROM customer_twin_negative_feedback
      WHERE active = TRUE`
  );
  const byCategory = {};
  for (const row of r.rows || []) {
    (byCategory[row.category] ||= []).push(row);
  }
  return byCategory;
}

/**
 * @param {{ app: any, pool: any, platformAdminRequired: Function, callLLM?: Function }} ctx
 */
export function registerCustomerTwinRoutes(ctx) {
  const { app, pool } = ctx;
  const twinAdminRequired = createCustomerTwinAdminRequired();
  const adminName = (req) => req.platformAdmin?.username || req.twinAdmin?.username || 'admin';
  ensureGoldenCaseSeed(pool).catch((e) => log.warn({ msg: 'customer_twin_golden_seed_failed', err: e?.message }));

  app.post('/api/customer-twin/incidents/generate', twinAdminRequired, async (req, res) => {
    try {
      const limit = Math.min(Number(req.body?.limit_per_source) || 50, 200);
      const result = await generateIncidentCards(pool, { limitPerSource: limit });
      res.json({ ok: true, ...result });
    } catch (e) {
      log.error({ msg: 'twin_incidents_generate', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/customer-twin/incidents/pending', twinAdminRequired, async (_req, res) => {
    try {
      res.json({ ok: true, cards: await listPendingTwinCards(pool) });
    } catch (e) {
      log.error({ msg: 'twin_incidents_pending', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/customer-twin/incidents/:cardKey/approve', twinAdminRequired, async (req, res) => {
    try {
      const active = req.body?.active !== false;
      const username = adminName(req);
      const row = await setTwinCardActive(pool, req.params.cardKey, active, username);
      if (!row) return res.status(404).json({ ok: false, error: 'card_not_found' });
      res.json({ ok: true, card_key: row.card_key, active });
    } catch (e) {
      log.error({ msg: 'twin_incidents_approve', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.delete('/api/customer-twin/incidents/:cardKey', twinAdminRequired, async (req, res) => {
    try {
      const username = adminName(req);
      const row = await rejectTwinCard(pool, req.params.cardKey, username);
      if (!row) return res.status(404).json({ ok: false, error: 'card_not_found' });
      res.json({ ok: true, card_key: row.card_key, rejected: true });
    } catch (e) {
      log.error({ msg: 'twin_incidents_delete', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/customer-twin/simulate', twinAdminRequired, async (req, res) => {
    try {
      const personaKey = String(req.body?.persona_key || 'family_dinner');
      if (!PERSONA_KEYS.includes(personaKey)) {
        return res.status(400).json({ ok: false, error: 'unknown_persona', keys: PERSONA_KEYS });
      }
      const events = Array.isArray(req.body?.events) ? req.body.events : [{ type: 'wait_food', minutes: 25 }];
      const seed = Number(req.body?.seed) || 20260804;
      const [persona] = samplePersonas({ seed, count: 1, keys: [personaKey] });
      const sim = runSimulation({ persona, events, startEmotion: Number(req.body?.start_emotion) || 80 });
      const corpusByCategory = await loadCorpus(pool);
      const utterance = expressUtterance({
        persona,
        sim,
        corpusByCategory,
        seedText: JSON.stringify({ personaKey, events, seed }),
      });
      res.json({ ok: true, persona: { key: persona.persona_key, label: persona.label }, sim, utterance });
    } catch (e) {
      log.error({ msg: 'twin_simulate', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
