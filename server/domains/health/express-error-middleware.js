export function createExpressErrorMiddleware({ multer }) {
  return (err, req, res, next) => {
    if (!err) return next();
    const requestId = req.requestId || res.getHeader?.('X-Request-Id') || null;
    try {
      if (err instanceof multer.MulterError) {
        const code = String(err.code || 'multer_error');
        if (code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'file_too_large', request_id: requestId });
        }
        return res.status(400).json({ error: 'upload_error', code, request_id: requestId });
      }
    } catch (e) { /* ignore */ }

    const msg = String(err?.message || err);
    if (/uploads_dir_not_writable/i.test(msg)) {
      return res.status(500).json({ error: 'uploads_dir_not_writable', message: msg, request_id: requestId });
    }
    if (/blocked_file_type/i.test(msg)) {
      return res.status(400).json({ error: 'blocked_file_type', message: msg, request_id: requestId });
    }
    console.error('[express]', requestId || '-', msg);
    return res.status(500).json({ error: 'server_error', message: 'internal_error', request_id: requestId });
  };
}
