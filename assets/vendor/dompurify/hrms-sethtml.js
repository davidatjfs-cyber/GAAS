/**
 * B7：innerHTML → setHTML + DOMPurify
 *
 * ⚠️ 防护边界（务必如实）：
 * - 已拦：`<script>` / `<iframe>` / `javascript:` 等。
 * - 已拦：全部 `on*` 事件属性（含 onchange/oninput/onsubmit/onfocus/onblur）。
 *   动态模板已迁到 data-change / data-input / data-submit / data-focus / data-blur 委托。
 * - 静态 HTML shell 里仍可能有遗留 inline onchange/oninput（不经 DOMPurify，页面加载原生生效）；
 *   新 UI 禁止再往 innerHTML 模板写 on*。
 * - 前提：写入 innerHTML 的内容须来自可信模板/服务端，不能把用户原文当 HTML 拼进去。
 *
 * fail-closed：DOMPurify 未加载时返回空串（并 console.error），禁止原样放行。
 * 新代码请优先用 setHTML(el, html) / appendHTML(el, html)。
 */
(function (global) {
  'use strict';

  var CFG = {
    ADD_ATTR: ['target', 'rel', 'download'],
    ADD_DATA_URI_TAGS: ['a', 'img'],
    ALLOW_DATA_ATTR: true,
    FORCE_BODY: false,
  };

  global.HRMS_DOMPURIFY_CFG = CFG;

  function sanitize(html) {
    var raw = html == null ? '' : String(html);
    if (typeof global.DOMPurify === 'undefined' || !global.DOMPurify.sanitize) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[B7] DOMPurify missing — fail-closed, returning empty HTML');
      }
      return '';
    }
    return global.DOMPurify.sanitize(raw, CFG);
  }

  function installInnerHTMLHook() {
    if (global.__HRMS_INNERHTML_HOOKED__) return true;
    if (typeof Element === 'undefined' || !Element.prototype) return false;
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return false;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      enumerable: true,
      get: function () {
        return desc.get.call(this);
      },
      set: function (v) {
        desc.set.call(this, sanitize(v));
      },
    });
    global.__HRMS_INNERHTML_HOOKED__ = true;
    return true;
  }

  function setHTML(el, html) {
    if (!el) return el;
    el.innerHTML = html == null ? '' : String(html);
    return el;
  }

  function appendHTML(el, html) {
    if (!el) return el;
    el.innerHTML = String(el.innerHTML || '') + (html == null ? '' : String(html));
    return el;
  }

  global.hrmsSanitizeHTML = sanitize;
  global.setHTML = setHTML;
  global.appendHTML = appendHTML;
  global.hrmsInstallInnerHTMLHook = installInnerHTMLHook;

  installInnerHTMLHook();
})(typeof window !== 'undefined' ? window : globalThis);
