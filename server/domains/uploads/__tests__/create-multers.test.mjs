import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPLOAD_ALLOWED_EXTS,
  TRAINING_MEDIA_EXTS,
  createUploadMulters,
} from '../create-multers.js';

function fakeMulter({ storage, limits }) {
  return { _storage: storage, _limits: limits };
}
fakeMulter.diskStorage = (opts) => opts;

test('createUploadMulters builds three uploaders with expected limits', () => {
  const { upload, knowledgeUpload, trainingPracticeUpload } = createUploadMulters({
    multer: fakeMulter,
    path: { extname: (n) => n.slice(n.lastIndexOf('.')) },
    fs: { mkdirSync: () => {} },
    randomUUID: () => 'uuid',
    uploadsDir: '/tmp/uploads',
    ensureUploadsDir: () => ({ ok: true }),
  });
  assert.equal(upload._limits.fileSize, 100 * 1024 * 1024);
  assert.equal(knowledgeUpload._limits.fileSize, 500 * 1024 * 1024);
  assert.equal(trainingPracticeUpload._limits.fileSize, 200 * 1024 * 1024);
  assert.ok(UPLOAD_ALLOWED_EXTS.has('.pdf'));
  assert.ok(TRAINING_MEDIA_EXTS.has('.mp4'));
});

test('upload filename blocks unknown extensions', () => {
  const { upload, knowledgeUpload, trainingPracticeUpload } = createUploadMulters({
    multer: fakeMulter,
    path: { extname: (n) => n.slice(n.lastIndexOf('.')), join: (...a) => a.join('/') },
    fs: { mkdirSync: () => {} },
    randomUUID: () => 'id',
    uploadsDir: '/tmp/u',
    ensureUploadsDir: () => ({ ok: true }),
  });
  let err;
  upload._storage.filename({}, { originalname: 'x.exe' }, (e) => { err = e; });
  assert.match(String(err.message), /blocked_file_type/);
  let name;
  upload._storage.filename({}, { originalname: 'a.pdf' }, (e, n) => { assert.equal(e, null); name = n; });
  assert.equal(name, 'id.pdf');

  upload._storage.destination({}, {}, (e, dir) => {
    assert.equal(e, null);
    assert.equal(dir, '/tmp/u');
  });
  knowledgeUpload._storage.filename({}, { originalname: 'n.md' }, (e, n) => {
    assert.equal(e, null);
    assert.equal(n, 'id.md');
  });
  knowledgeUpload._storage.filename({}, { originalname: 'bad.exe' }, (e) => {
    assert.match(String(e.message), /blocked_file_type/);
  });
  trainingPracticeUpload._storage.destination({}, {}, (e, dir) => {
    assert.equal(e, null);
    assert.equal(dir, '/tmp/u/training');
  });
  trainingPracticeUpload._storage.filename({}, { originalname: 'v.mp4' }, (e, n) => {
    assert.equal(e, null);
    assert.equal(n, 'training-id.mp4');
  });
  trainingPracticeUpload._storage.filename({}, { originalname: 'x.txt' }, (e) => {
    assert.match(String(e.message), /blocked_file_type/);
  });
});

test('createUploadMulters destination fails when uploads dir not writable', () => {
  const { upload, knowledgeUpload } = createUploadMulters({
    multer: fakeMulter,
    path: { extname: () => '.pdf', join: (...a) => a.join('/') },
    fs: { mkdirSync: () => {} },
    randomUUID: () => 'id',
    uploadsDir: '/tmp/u',
    ensureUploadsDir: () => ({ ok: false, error: 'perm' }),
  });
  upload._storage.destination({}, {}, (e) => {
    assert.match(String(e.message), /uploads_dir_not_writable/);
  });
  knowledgeUpload._storage.destination({}, {}, (e) => {
    assert.match(String(e.message), /uploads_dir_not_writable/);
  });
});
