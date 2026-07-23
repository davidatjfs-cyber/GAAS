import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const require = createRequire(import.meta.url);

function loadSetHtmlEnv() {
  let JSDOM;
  let createDOMPurify;
  try {
    ({ JSDOM } = require('jsdom'));
    createDOMPurify = require('dompurify');
  } catch {
    return null;
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nnyx.cc/' });
  const { window } = dom;
  window.DOMPurify = createDOMPurify(window);
  const purifySrc = readFileSync(join(ROOT, 'assets/vendor/dompurify/purify.min.js'), 'utf8');
  // vendor purify is browser UMD; we already injected via npm dompurify above
  void purifySrc;
  const hookSrc = readFileSync(join(ROOT, 'assets/vendor/dompurify/hrms-sethtml.js'), 'utf8');
  vm.runInNewContext(hookSrc, window, { filename: 'hrms-sethtml.js' });
  return window;
}

test('B7 hrms-sethtml：剥离 script，保留 onclick 与 data-*', async (t) => {
  const window = loadSetHtmlEnv();
  if (!window) {
    t.skip('需要 jsdom + dompurify（npm i -D jsdom dompurify）');
    return;
  }
  const el = window.document.createElement('div');
  el.innerHTML =
    '<button onclick="foo()" data-rid="x1">ok</button><script>alert(1)</script><img src=x onerror=alert(2)>';
  assert.match(el.innerHTML, /onclick=/i);
  assert.match(el.innerHTML, /data-rid="x1"/i);
  assert.equal(/<script/i.test(el.innerHTML), false);
  // onerror on img is an event handler we allow in ADD_ATTR for legacy; script body must still be gone
  assert.equal(typeof window.setHTML, 'function');
  window.setHTML(el, '<p>hi<script>x</script></p>');
  assert.equal(/<script/i.test(el.innerHTML), false);
  assert.match(el.innerHTML, /hi/);
});

test('B7 vendor 文件与 HTML 引用存在', () => {
  const purify = readFileSync(join(ROOT, 'assets/vendor/dompurify/purify.min.js'), 'utf8');
  assert.ok(purify.includes('DOMPurify'));
  const hook = readFileSync(join(ROOT, 'assets/vendor/dompurify/hrms-sethtml.js'), 'utf8');
  assert.ok(hook.includes('setHTML'));
  assert.ok(hook.includes('innerHTML'));
  const html = readFileSync(join(ROOT, 'working-fixed.html'), 'utf8');
  assert.ok(html.includes('/assets/vendor/dompurify/purify.min.js'));
  assert.ok(html.includes('/assets/vendor/dompurify/hrms-sethtml.js'));
  // 不能再引入第二个 \\n    <script>\\n 锚点，否则 bundle/build-shell 会炸
  const open = '\n    <script>\n';
  const first = html.indexOf(open);
  const second = html.indexOf(open, first + 1);
  assert.notEqual(first, -1);
  assert.equal(second, -1);
});
