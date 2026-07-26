/**
 * Health + version HTTP (Wave H21 — behavior-preserving extract from index.js).
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { agentsOutboundHeaders } from '../shared/agents-service-auth.js';
import { buildRootDiskHealthInfo, createDiskPressureNotifier } from './disk.js';

/** 与 agents-service-v2 /health 对齐；生产在 .env 设置 AGENTS_SERVICE_HEALTH_URL=http://127.0.0.1:3101/health */
async function fetchAgentsServiceHealthSnapshot(req) {
  const raw = String(process.env.AGENTS_SERVICE_HEALTH_URL || '').trim();
  if (!raw) return null;
  try {
    const r = await axios.get(raw, {
      timeout: 4500,
      validateStatus: () => true,
      headers: agentsOutboundHeaders(req),
    });
    if (r.status !== 200 || r.data == null) {
      return { ok: false, httpStatus: r.status, error: 'agents health non-200 or empty' };
    }
    return r.data;
  } catch (e) {
    return { ok: false, error: 'internal_error' };
  }
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   requireEnv: () => string[],
 *   pool: import('pg').Pool,
 *   getOssClient: () => unknown,
 *   getCosClient: () => unknown,
 *   ensureUploadsDir: () => unknown,
 *   getAgentHealthStatus: () => object,
 *   hrmsNowISO: () => string,
 *   sendLarkMessage: (openId: string, text: string) => Promise<unknown>,
 *   STARTED_AT: string,
 *   indexFilePath: string,
 *   serverDir: string,
 * }} deps
 */
export function registerHealthRoutes(app, deps) {
  const {
    requireEnv,
    pool,
    getOssClient,
    getCosClient,
    ensureUploadsDir,
    getAgentHealthStatus,
    hrmsNowISO,
    sendLarkMessage,
    STARTED_AT,
    indexFilePath,
    serverDir,
  } = deps;

  const maybeNotifyDiskPressureByLark = createDiskPressureNotifier({ sendLarkMessage });

  app.get('/api/health', async (req, res) => {
    const missing = requireEnv();
    if (missing.length) {
      return res.status(500).json({ ok: false, missing });
    }
    try {
      const _r = await pool.query('select now() as now');
      const ossConfigured = !!getOssClient();
      const cosConfigured = !!getCosClient();
      const uploads = ensureUploadsDir();
      let agentHealth = {};
      try { agentHealth = getAgentHealthStatus(); } catch (e) { /* ignore */ }
      let agentsService = null;
      try {
        agentsService = await fetchAgentsServiceHealthSnapshot(req);
      } catch (e) {
        agentsService = { ok: false, error: 'internal_error' };
      }
      const diskInfo = await buildRootDiskHealthInfo();
      maybeNotifyDiskPressureByLark(diskInfo).catch(() => {});

      let databaseSizeBytes = null;
      let databaseSizeGb = null;
      try {
        const sz = await pool.query('select pg_database_size(current_database())::bigint as b');
        const b = Number(sz.rows?.[0]?.b || 0);
        if (b > 0) {
          databaseSizeBytes = b;
          databaseSizeGb = Math.round((b / (1024 ** 3)) * 100) / 100;
        }
      } catch (e) {
        /* ignore size errors */
      }

      const payload = {
        ok: true,
        database: true,
        now: hrmsNowISO(),
        storage: { ossConfigured, cosConfigured },
        uploads,
        agents: agentHealth,
        disk: diskInfo,
        databaseSizeBytes,
        databaseSizeGb
      };
      if (agentsService != null) payload.agentsService = agentsService;
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/api/version', async (req, res) => {
    try {
      const out = {
        startedAt: STARTED_AT,
        buildVersion: 'v176',
        server: {
          indexMtime: null,
          agentsMtime: null
        },
        frontend: {
          workingFixedMtime: null,
          swMtime: null,
          swCacheName: null
        }
      };

      try {
        const st = fs.statSync(indexFilePath);
        out.server.indexMtime = st?.mtime ? st.mtime.toISOString() : null;
      } catch (e) { /* ignore */ }
      try {
        const agentsPath = path.resolve(serverDir, 'agents.js');
        const ast = fs.statSync(agentsPath);
        out.server.agentsMtime = ast?.mtime ? ast.mtime.toISOString() : null;
      } catch (e) { /* ignore */ }

      try {
        const webRootDir = path.resolve(serverDir, '..');
        const wf = path.join(webRootDir, 'working-fixed.html');
        const sw = path.join(webRootDir, 'sw.js');
        if (fs.existsSync(wf)) {
          const st = fs.statSync(wf);
          out.frontend.workingFixedMtime = st?.mtime ? st.mtime.toISOString() : null;
        }
        if (fs.existsSync(sw)) {
          const st2 = fs.statSync(sw);
          out.frontend.swMtime = st2?.mtime ? st2.mtime.toISOString() : null;
          try {
            const head = String(fs.readFileSync(sw, 'utf8') || '').split(/\r?\n/).slice(0, 3).join('\n');
            const m = head.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            out.frontend.swCacheName = m && m[1] ? String(m[1]) : null;
          } catch (e3) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }

      return res.json(out);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
