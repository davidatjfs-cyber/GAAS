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

test('B7 hrms-sethtml：剥离 script 与全部 on* 事件属性；fail-closed', async (t) => {
  const window = loadSetHtmlEnv();
  if (!window) {
    t.skip('需要 jsdom + dompurify（npm i -D jsdom dompurify）');
    return;
  }
  const el = window.document.createElement('div');
  el.innerHTML =
    '<button onclick="foo()" data-rid="x1">ok</button>' +
    '<script>alert(1)</script>' +
    '<img src=x onerror=alert(2)>' +
    '<svg onload=alert(3)></svg>' +
    '<input onchange="bar()" data-x="1">' +
    '<input onfocus=alert(4) autofocus>' +
    '<form onsubmit="baz()"><button>go</button></form>';
  assert.equal(/onclick=/i.test(el.innerHTML), false, 'onclick 已剥离');
  assert.equal(/onerror=/i.test(el.innerHTML), false, 'onerror 已剥离');
  assert.equal(/onload=/i.test(el.innerHTML), false, 'onload 已剥离');
  assert.equal(/onchange=/i.test(el.innerHTML), false, 'onchange 已剥离');
  assert.equal(/onfocus=/i.test(el.innerHTML), false, 'onfocus 已剥离');
  assert.equal(/onsubmit=/i.test(el.innerHTML), false, 'onsubmit 已剥离');
  assert.equal(/<script/i.test(el.innerHTML), false);
  assert.match(el.innerHTML, /data-rid="x1"/i);
  assert.equal(typeof window.setHTML, 'function');
  window.setHTML(el, '<p>hi<script>x</script></p>');
  assert.equal(/<script/i.test(el.innerHTML), false);
  assert.match(el.innerHTML, /hi/);

  // fail-closed：无 DOMPurify 时不得原样放行
  const prev = window.DOMPurify;
  delete window.DOMPurify;
  assert.equal(window.hrmsSanitizeHTML('<script>alert(1)</script><img src=x onerror=alert(2)>'), '');
  window.DOMPurify = prev;
});

test('B7 vendor 文件与 HTML 引用存在；ADD_ATTR 不含 on*', () => {
  const purify = readFileSync(join(ROOT, 'assets/vendor/dompurify/purify.min.js'), 'utf8');
  assert.ok(purify.includes('DOMPurify'));
  const hook = readFileSync(join(ROOT, 'assets/vendor/dompurify/hrms-sethtml.js'), 'utf8');
  assert.ok(hook.includes('setHTML'));
  assert.ok(hook.includes('innerHTML'));
  assert.equal(/LEGACY_EVENT_ATTRS/.test(hook), false, '过渡白名单已移除');
  assert.equal(/\bon[a-z]+\b/.test(hook.match(/ADD_ATTR:\s*\[[^\]]*\]/)?.[0] || ''), false, 'ADD_ATTR 不得含 on*');
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

test('B7：frontend pages 动态模板不得再写 onchange/oninput/onsubmit/onfocus/onblur=', () => {
  const pagesDir = join(ROOT, 'frontend/src/pages');
  const { readdirSync } = require('fs');
  const re = /\bon(change|input|submit|focus|blur)=/i;
  const hits = [];
  for (const name of readdirSync(pagesDir)) {
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(join(pagesDir, name), 'utf8');
    if (re.test(src)) hits.push(name);
  }
  assert.deepEqual(hits, [], `pages 仍含过渡 on* 属性: ${hits.join(', ')}`);
});
