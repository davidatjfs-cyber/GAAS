import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrMessage } from '../safe-err-message.js';
import { domainJsonFieldEmpty } from '../domain-json-empty.js';
import {
  encodeRFC5987ValueChars,
  buildInlineContentDisposition,
  inferContentType,
} from '../../uploads/content-type.js';

test('safeErrMessage: production redacts', () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(safeErrMessage(new Error('secret sql')), 'internal_error');
    process.env.NODE_ENV = 'development';
    assert.equal(safeErrMessage(new Error('secret sql')), 'secret sql');
    assert.equal(safeErrMessage(null), 'internal_error');
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('domainJsonFieldEmpty', () => {
  assert.equal(domainJsonFieldEmpty(undefined), true);
  assert.equal(domainJsonFieldEmpty(null), true);
  assert.equal(domainJsonFieldEmpty([]), true);
  assert.equal(domainJsonFieldEmpty({}), true);
  assert.equal(domainJsonFieldEmpty([1]), false);
  assert.equal(domainJsonFieldEmpty({ a: 1 }), false);
  assert.equal(domainJsonFieldEmpty(0), false);
  assert.equal(domainJsonFieldEmpty(''), false);
});

test('buildInlineContentDisposition encodes filename', () => {
  assert.match(buildInlineContentDisposition('报告.pdf'), /^inline; filename\*=UTF-8''/);
  assert.equal(buildInlineContentDisposition(''), `inline; filename*=UTF-8''${encodeRFC5987ValueChars('file')}`);
});

test('inferContentType prefers mime then ext/declared', () => {
  assert.equal(
    inferContentType({ declaredType: '', originalName: 'a.bin', mimeType: 'image/png' }),
    'image/png'
  );
  assert.equal(
    inferContentType({ declaredType: 'pdf', originalName: 'x', mimeType: '' }),
    'application/pdf'
  );
  assert.equal(
    inferContentType({ declaredType: '', originalName: 'clip.mp4', mimeType: 'application/octet-stream' }),
    'video/mp4'
  );
  assert.equal(
    inferContentType({ declaredType: 'video', originalName: 'x', mimeType: '' }),
    'video/mp4'
  );
  assert.equal(inferContentType({ originalName: 'a.mov' }), 'video/quicktime');
  assert.equal(inferContentType({ declaredType: 'img', originalName: 'a' }), 'image/png');
  assert.equal(inferContentType({ originalName: 'a.jpg' }), 'image/jpeg');
  assert.equal(inferContentType({ originalName: 'a.webp' }), 'image/webp');
  assert.equal(inferContentType({ originalName: 'a.txt' }), 'text/plain; charset=utf-8');
  assert.equal(inferContentType({ originalName: 'a.doc' }), 'application/msword');
  assert.match(inferContentType({ originalName: 'a.docx' }), /wordprocessingml/);
  assert.equal(
    inferContentType({ declaredType: '', originalName: 'x.unknown', mimeType: '' }),
    'application/octet-stream'
  );
});