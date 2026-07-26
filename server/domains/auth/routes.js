/**
 * Auth domain routes — thin handlers over domains/auth/service.js.
 * Signature matches historical registerAuthRoutes(app, authRequired, loginRateLimit, deps).
 */
import {
  login,
  getAuthMe,
  getMe,
  switchStore,
  changePassword,
  loginAs,
  logout,
  heartbeat,
} from './service.js';

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerAuthRoutes(app, authRequired, loginRateLimit, deps) {
  async function handleLogin(req, res) {
    const result = await login(
      { body: req.body, headers: req.headers, reqLike: req, requestId: req.requestId },
      deps
    );
    return send(res, result);
  }

  app.get('/api/auth/me', authRequired, async (req, res) => {
    const result = await getAuthMe(
      { user: req.user, tenantId: req.tenantId, requestId: req.requestId },
      deps
    );
    return send(res, result);
  });

  app.get('/api/me', authRequired, async (req, res) => {
    const result = await getMe(
      { user: req.user, tenantId: req.tenantId, reqLike: req, requestId: req.requestId },
      deps
    );
    return send(res, result);
  });

  app.post('/api/auth/switch-store', authRequired, async (req, res) => {
    const result = await switchStore(
      { user: req.user, body: req.body },
      deps
    );
    return send(res, result);
  });

  app.post('/api/auth/change-password', authRequired, async (req, res) => {
    const result = await changePassword(
      { user: req.user, tenantId: req.tenantId, body: req.body },
      deps
    );
    return send(res, result);
  });

  app.post('/api/auth/login', loginRateLimit, handleLogin);
  app.post('/api/login', loginRateLimit, handleLogin);

  app.post('/api/auth/login-as', authRequired, async (req, res) => {
    const result = await loginAs(
      { user: req.user, tenantId: req.tenantId, body: req.body, reqLike: req },
      deps
    );
    return send(res, result);
  });

  app.post('/api/auth/logout', authRequired, async (req, res) => {
    const result = await logout({ user: req.user }, deps);
    return send(res, result);
  });

  app.post('/api/auth/heartbeat', authRequired, async (req, res) => {
    const result = await heartbeat({ user: req.user }, deps);
    return send(res, result);
  });
}
