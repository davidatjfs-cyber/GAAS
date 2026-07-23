/**
 * B7：innerHTML → setHTML + DOMPurify
 *
 * 在 Element.prototype.innerHTML 的 setter 上挂净化，覆盖全部现有赋值（含 +=）。
 * 本系统大量模板依赖 onclick/onchange 等内联事件，故 ADD_ATTR 放行；
 * 仍剥离 script/iframe/javascript: 等危险载荷。
 *
 * 新代码请优先用 setHTML(el, html) / appendHTML(el, html)。
 */
(function (global) {
  'use strict';

  var EVENT_ATTRS = [
    'onclick', 'ondblclick', 'onchange', 'oninput', 'onsubmit',
    'onfocus', 'onblur', 'onkeyup', 'onkeydown', 'onkeypress',
    'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmousemove',
    'ontouchstart', 'ontouchend', 'ontouchmove',
    'onload', 'onerror', 'onscroll', 'onpaste', 'oncut', 'oncopy',
  ];

  var CFG = {
    ADD_ATTR: EVENT_ATTRS.concat(['target', 'rel', 'download']),
    ADD_DATA_URI_TAGS: ['a', 'img'],
    ALLOW_DATA_ATTR: true,
    FORCE_BODY: false,
  };

  global.HRMS_DOMPURIFY_CFG = CFG;

  function sanitize(html) {
    var raw = html == null ? '' : String(html);
    if (typeof global.DOMPurify === 'undefined' || !global.DOMPurify.sanitize) {
      return raw;
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
