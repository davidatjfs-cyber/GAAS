/**
 * Multer uploaders for general / knowledge / training practice uploads
 * (P18 peel from index.js).
 */
export const UPLOAD_ALLOWED_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.txt', '.csv', '.zip', '.rar',
  '.mp4', '.mov', '.webm', '.avi',
]);

export const TRAINING_MEDIA_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.mp4', '.mov', '.webm', '.heic',
]);

/**
 * @param {object} deps
 * @param {Function} deps.multer
 * @param {object} deps.path
 * @param {object} deps.fs
 * @param {() => string} deps.randomUUID
 * @param {string} deps.uploadsDir
 * @param {() => {ok: boolean, error?: string}} deps.ensureUploadsDir
 */
export function createUploadMulters(deps) {
  const { multer, path, fs, randomUUID, uploadsDir, ensureUploadsDir } = deps;

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const st = ensureUploadsDir();
        if (!st.ok) return cb(new Error('uploads_dir_not_writable: ' + String(st.error || 'unknown')));
        return cb(null, uploadsDir);
      },
      filename: (req, file, cb) => {
        const orig = String(file?.originalname || 'file');
        const ext = path.extname(orig).toLowerCase().slice(0, 16);
        if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
          return cb(new Error(`blocked_file_type: ${ext || 'unknown'}`));
        }
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  const knowledgeUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const st = ensureUploadsDir();
        if (!st.ok) return cb(new Error('uploads_dir_not_writable: ' + String(st.error || 'unknown')));
        return cb(null, uploadsDir);
      },
      filename: (req, file, cb) => {
        const orig = String(file?.originalname || 'file');
        const ext = path.extname(orig).toLowerCase().slice(0, 16);
        if (!UPLOAD_ALLOWED_EXTS.has(ext) && !['.json', '.md', '.yaml', '.yml'].includes(ext)) {
          return cb(new Error(`blocked_file_type: ${ext || 'unknown'}`));
        }
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 500 * 1024 * 1024 },
  });

  const trainingPracticeUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const trainingDir = path.join(uploadsDir, 'training');
        fs.mkdirSync(trainingDir, { recursive: true });
        cb(null, trainingDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!TRAINING_MEDIA_EXTS.has(ext)) return cb(new Error('blocked_file_type'));
        cb(null, `training-${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  return { upload, knowledgeUpload, trainingPracticeUpload };
}
