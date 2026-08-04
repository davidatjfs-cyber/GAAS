/**
 * Whitelisted web-root static serving + shell HTML entry routes.
 * Security: never expose whole repo — only allowlisted files/dirs + hashed app.*.js/css.
 */

export function registerWebStaticRoutes(app, { express, fs, path, webRootDir }) {
  const STATIC_ALLOWED_ROOT_FILES = new Set([
    'working-fixed.html',
    'agents-admin.html',
    'platform-admin.html',
    'sales-sim.html',
    'job-coach.html',
    'customer-twin-review.html',
    'campaign.html',
    'forecast.html',
    'index.html',
    'member-agreement.html',
    'svremind.html',
    'winback.html',
    'manifest.json',
    'pwa-icon.svg',
    'sw.js',
    'script.js',
    'styles.css',
    'role-modules-ui.js',
  ]);
  const STATIC_ALLOWED_DIR_PREFIXES = ['assets/', 'dist/'];
  const staticServeWebRoot = express.static(webRootDir, {
    index: false,
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      const lp = String(filePath || '').toLowerCase();
      if (lp.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // no-cache（非 no-store）：浏览器可缓存，但每次用前必须带 ETag 回源校验
        res.setHeader('Cache-Control', 'no-cache');
      } else if (lp.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const reqPath = decodeURIComponent(String(req.path || '')).replace(/^\/+/, '');
    const isAllowedDir = STATIC_ALLOWED_DIR_PREFIXES.some((pre) => reqPath.startsWith(pre));
    const isAllowedFile = STATIC_ALLOWED_ROOT_FILES.has(reqPath) || reqPath === '';
    const isHashedAsset = /^app\.[0-9a-f]+\.(js|css)$/.test(reqPath);
    if (!isAllowedDir && !isAllowedFile && !isHashedAsset) return next();
    return staticServeWebRoot(req, res, next);
  });

  app.get('/agent/tenant-operation-inspection', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webRootDir, 'agents-admin.html'));
  });

  app.get('/', (req, res) => {
    const p1 = path.join(webRootDir, 'working-fixed.html');
    const p2 = path.join(webRootDir, 'index.html');
    const target = fs.existsSync(p1) ? p1 : fs.existsSync(p2) ? p2 : null;
    if (!target) return res.status(404).send('Missing frontend html');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(target);
  });
}

/** Pure helper for tests: whether a decoded request path is allowlisted. */
export function isWebStaticPathAllowed(reqPathRaw) {
  const STATIC_ALLOWED_ROOT_FILES = new Set([
    'working-fixed.html',
    'agents-admin.html',
    'platform-admin.html',
    'sales-sim.html',
    'job-coach.html',
    'campaign.html',
    'forecast.html',
    'index.html',
    'member-agreement.html',
    'svremind.html',
    'winback.html',
    'manifest.json',
    'pwa-icon.svg',
    'sw.js',
    'script.js',
    'styles.css',
    'role-modules-ui.js',
  ]);
  const STATIC_ALLOWED_DIR_PREFIXES = ['assets/', 'dist/'];
  const reqPath = decodeURIComponent(String(reqPathRaw || '')).replace(/^\/+/, '');
  if (STATIC_ALLOWED_DIR_PREFIXES.some((pre) => reqPath.startsWith(pre))) return true;
  if (STATIC_ALLOWED_ROOT_FILES.has(reqPath) || reqPath === '') return true;
  if (/^app\.[0-9a-f]+\.(js|css)$/.test(reqPath)) return true;
  return false;
}
