// Polyfills and the adapted stylesheet for the old-TV build (imported before the app).

// Before Chrome 68, fetch() left cookies out unless asked, so the session cookie was
// never stored or sent and every sign-in bounced straight back to the sign-in screen.
{
  const origFetch = window.fetch;
  window.fetch = (input, init = {}) => origFetch(input, { credentials: 'same-origin', ...init });
}

if (!Element.prototype.replaceChildren) {
  const replaceChildren = function (...nodes) {
    while (this.lastChild) this.removeChild(this.lastChild);
    this.append(...nodes);
  };
  Element.prototype.replaceChildren = replaceChildren;
  DocumentFragment.prototype.replaceChildren = replaceChildren;
}
if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat(depth = 1) {
      return depth > 0
        ? this.reduce((acc, v) => acc.concat(Array.isArray(v) ? v.flat(depth - 1) : v), [])
        : this.slice();
    },
  });
}
if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap(fn, thisArg) {
      return this.map(fn, thisArg).flat(1);
    },
  });
}
if (!String.prototype.padStart) {
  String.prototype.padStart = function (len, fill = ' ') {
    let s = String(this);
    while (s.length < len) s = fill + s;
    return s.slice(-Math.max(len, String(this).length));
  };
}
if (!Object.fromEntries) Object.fromEntries = (entries) => [...entries].reduce((o, [k, v]) => ((o[k] = v), o), {});
if (!Promise.prototype.finally) {
  Promise.prototype.finally = function (fn) {
    return this.then((v) => Promise.resolve(fn()).then(() => v), (e) => Promise.resolve(fn()).then(() => { throw e; }));
  };
}
// scrollTo / scrollBy / scrollIntoView with an options object (smooth scrolling) came later.
for (const target of [window, Element.prototype]) {
  for (const name of ['scrollTo', 'scrollBy']) {
    const orig = target[name];
    if (!orig) continue;
    target[name] = function (a, b) {
      if (a && typeof a === 'object') {
        if (name === 'scrollTo') return orig.call(this, a.left ?? (this.scrollX ?? this.scrollLeft ?? 0), a.top ?? (this.scrollY ?? this.scrollTop ?? 0));
        return orig.call(this, a.left || 0, a.top || 0);
      }
      return orig.call(this, a, b);
    };
  }
}
if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = function (a, b) {
    const o = a && typeof a === 'object' ? a : { left: a, top: b };
    this.scrollLeft += o.left || 0;
    this.scrollTop += o.top || 0;
  };
}
{
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg) {
    if (arg && typeof arg === 'object') return orig.call(this, arg.block !== 'end');
    return orig.call(this, arg);
  };
}

// Swap in the adapted stylesheet.
const link = document.querySelector('link[href="styles.css"]');
if (link) link.href = 'tv/styles.css';

