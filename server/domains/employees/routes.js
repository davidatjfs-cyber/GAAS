import express from 'express';
import {
  deleteEmployeeFromTable,
  loadEmployeesFromTable,
  patchEmployeeStatus,
  renameEmployeeUsername,
  upsertEmployeeFromStateShape,
} from './service.js';

function canManageEmployees(role) {
  const r = String(role || '');
  return r === 'admin' || r === 'hq_manager' || r === 'hr_manager';
}

/**
 * 员工窄接口：表权威写入；同步 hrms_state 镜像由 deps.mergeEmployeesMirror 完成。
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   resolveTenantId: (req)=>string,
 *   mergeEmployeesMirror: (emps: object[], tenantId: string)=>Promise<void>,
 *   removeEmployeesMirror: (usernames: string[], tenantId: string)=>Promise<void>,
 *   applyAccountGate?: (emp: object)=>Promise<void>,
 * }} deps
 */
export function registerEmployeesDomainRoutes(app, authRequired, deps) {
  const { pool, resolveTenantId, mergeEmployeesMirror, removeEmployeesMirror, applyAccountGate } = deps;
  const r = express.Router();

  r.get('/', authRequired, async (req, res) => {
    if (!canManageEmployees(req.user?.role) && String(req.user?.role || '') !== 'store_manager') {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const items = await loadEmployeesFromTable(pool, tid);
      const role = String(req.user?.role || '');
      const safe =
        role === 'admin'
          ? items
          : items.map(({ _password, ...rest }) => rest);
      return res.json({ ok: true, items: safe, count: safe.length });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.post('/', authRequired, async (req, res) => {
    if (!canManageEmployees(req.user?.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const emp = req.body?.employee && typeof req.body.employee === 'object' ? req.body.employee : req.body;
      const username = String(emp?.username || '').trim();
      if (!username) return res.status(400).json({ error: 'missing_username' });
      const existing = await loadEmployeesFromTable(pool, tid);
      if (existing.some((e) => String(e.username || '').toLowerCase() === username.toLowerCase())) {
        return res.status(409).json({ error: 'duplicate_username' });
      }
      const saved = await upsertEmployeeFromStateShape(pool, tid, {
        ...emp,
        username,
        id: emp?.id || username,
        status: emp?.status || 'active',
        createdAt: emp?.createdAt || new Date().toISOString().slice(0, 10),
      });
      await mergeEmployeesMirror([saved], tid);
      if (applyAccountGate) {
        try {
          await applyAccountGate(saved);
        } catch (e) {
          console.error('[employees-api] account-gate', username, e?.message || e);
        }
      }
      return res.status(201).json({ ok: true, employee: saved });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.put('/:username', authRequired, async (req, res) => {
    if (!canManageEmployees(req.user?.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const pathUser = String(req.params.username || '').trim();
      const emp = req.body?.employee && typeof req.body.employee === 'object' ? req.body.employee : req.body;
      const nextUser = String(emp?.username || pathUser).trim();
      if (!pathUser || !nextUser) return res.status(400).json({ error: 'missing_username' });

      const existing = await loadEmployeesFromTable(pool, tid);
      const cur = existing.find((e) => String(e.username || '').toLowerCase() === pathUser.toLowerCase());
      if (!cur) return res.status(404).json({ error: 'not_found' });

      if (nextUser.toLowerCase() !== pathUser.toLowerCase()) {
        if (existing.some((e) => String(e.username || '').toLowerCase() === nextUser.toLowerCase())) {
          return res.status(409).json({ error: 'duplicate_username' });
        }
      }

      const merged = { ...cur, ...emp, username: nextUser, id: emp?.id || cur.id || nextUser };
      if (!Object.prototype.hasOwnProperty.call(emp || {}, 'password') || emp.password === '' || emp.password == null) {
        merged.password = cur.password || '';
      }

      let saved;
      if (nextUser.toLowerCase() !== pathUser.toLowerCase()) {
        saved = await renameEmployeeUsername(pool, tid, pathUser, merged);
        await removeEmployeesMirror([pathUser], tid);
      } else {
        saved = await upsertEmployeeFromStateShape(pool, tid, merged);
      }
      await mergeEmployeesMirror([saved], tid);
      if (applyAccountGate) {
        try {
          await applyAccountGate(saved);
        } catch (e) {
          console.error('[employees-api] account-gate', nextUser, e?.message || e);
        }
      }
      return res.json({ ok: true, employee: saved });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.patch('/:username/status', authRequired, async (req, res) => {
    if (!canManageEmployees(req.user?.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const username = String(req.params.username || '').trim();
      const status = String(req.body?.status || '').trim();
      if (!username || !status) return res.status(400).json({ error: 'missing_username_or_status' });
      const extra = {};
      if (req.body?.resignDate != null) extra.resignDate = req.body.resignDate;
      const saved = await patchEmployeeStatus(pool, tid, username, status, extra);
      await mergeEmployeesMirror([saved], tid);
      if (applyAccountGate) {
        try {
          await applyAccountGate(saved);
        } catch (e) {
          console.error('[employees-api] account-gate', username, e?.message || e);
        }
      }
      return res.json({ ok: true, employee: saved });
    } catch (e) {
      if (e?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.patch('/:username/password', authRequired, async (req, res) => {
    if (!canManageEmployees(req.user?.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const username = String(req.params.username || '').trim();
      const password = String(req.body?.password ?? '123456');
      if (!username) return res.status(400).json({ error: 'missing_username' });
      const list = await loadEmployeesFromTable(pool, tid);
      const cur = list.find((e) => String(e.username || '').toLowerCase() === username.toLowerCase());
      if (!cur) return res.status(404).json({ error: 'not_found' });
      const saved = await upsertEmployeeFromStateShape(pool, tid, { ...cur, password });
      await mergeEmployeesMirror([saved], tid);
      return res.json({ ok: true, employee: { ...saved, password: undefined } });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.delete('/:username', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const username = String(req.params.username || '').trim();
      if (!username) return res.status(400).json({ error: 'missing_username' });
      const n = await deleteEmployeeFromTable(pool, tid, username);
      if (!n) return res.status(404).json({ error: 'not_found' });
      await removeEmployeesMirror([username], tid);
      return res.json({ ok: true, deleted: username });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.use('/api/employees', r);
}
