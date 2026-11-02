// TV mode: remote-control navigation for the Samsung (Tizen) app and other TV browsers.
//
// Turned on for Tizen / smart-TV browsers, or by opening the site with ?tv=1 (remembered).
// - Arrow keys move focus to the nearest button, link or poster in that direction.
// - The remote's Back key goes back (and closes the app from the home screen).
// - Play/Pause, Rewind and Fast-forward reach the player.
// In the player, arrows still seek and OK still plays/pauses while the controls are hidden.
// - A long press of OK on a Continue Watching card offers to remove it.

import { h, prefs } from './ui.js';
import { t } from './i18n.js';

const isTVBrowser = /Tizen|SMART-TV|SmartTV|Web0S|NetCast|HbbTV/i.test(navigator.userAgent);
const asked = new URLSearchParams(location.search).get('tv');
if (asked !== null) prefs.set('tv', asked !== '0');
export const tvMode = isTVBrowser || prefs.get('tv', false);

// Tizen remote key codes → standard key names the rest of the site understands.
const TIZEN_KEYS = {
  10009: 'Escape', // Back
  10252: 'MediaPlayPause',
  415: 'MediaPlayPause', // Play
  19: 'MediaPlayPause', // Pause
  412: 'MediaRewind',
  417: 'MediaFastForward',
  413: 'Escape', // Stop
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
const synthetic = new WeakSet();

function visible(el) {
  if (el.closest('[hidden], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.opacity !== '0' && st.pointerEvents !== 'none';
}

// Where focus may go: inside an open dialog or player panel if one is showing.
function scope() {
  return document.querySelector('dialog[open]')
    || [...document.querySelectorAll('.player-backdrop')].find((p) => !p.hidden)
    || document.querySelector('.watch')
    || document.body;
}

function candidates() {
  return [...scope().querySelectorAll(FOCUSABLE)].filter(visible);
}

// Pick the nearest element in the direction pressed: mostly by distance along that
// direction, with sideways drift costing a little.
function nearest(from, dir) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    let main;
    let side;
    // The candidate must start past the middle of the current element in that direction.
    if (dir === 'ArrowRight') { main = b.left - a.right; side = Math.abs(by - ay); if (b.left <= ax) continue; }
    else if (dir === 'ArrowLeft') { main = a.left - b.right; side = Math.abs(by - ay); if (b.right >= ax) continue; }
    else if (dir === 'ArrowDown') { main = b.top - a.bottom; side = Math.abs(bx - ax); if (b.top <= ay) continue; }
    else { main = a.top - b.bottom; side = Math.abs(bx - ax); if (b.bottom >= ay) continue; }
    // ←/→ stay in the same row (they must overlap vertically); ↑/↓ go to the nearest
    // row, then to whatever in it lines up best.
    const horizontal = dir === 'ArrowLeft' || dir === 'ArrowRight';
    if (horizontal && !(b.top < a.bottom - 4 && b.bottom > a.top + 4)) continue;
    const score = horizontal ? Math.max(main, 0) + side * 0.3 : Math.max(main, 0) * 3 + side * 0.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

// The highlight follows a class rather than :focus, which some TV browsers (and
// unfocused windows) don't apply reliably.
let marked = null;
function mark(el) {
  marked?.classList.remove('tv-focus');
  marked = el && el !== document.body ? el : null;
  marked?.classList.add('tv-focus');
}

function focusEl(el) {
  el.focus({ preventScroll: true });
  mark(el);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  // Keep rows centred vertically so the row above/below stays in view.
  const r = el.getBoundingClientRect();
  if (r.top < 90 || r.bottom > innerHeight - 40) scrollBy({ top: r.top - innerHeight / 2 + r.height / 2, behavior: 'smooth' });
}

function firstInView() {
  const list = candidates();
  return list.find((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 60 && r.bottom <= innerHeight && el.matches('.btn, .poster, .landscape, a.btn, button.btn');
  }) || list.find((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }) || list[0];
}

// ---------- scrubbing the seek bar with ←/→ ----------
// Presses less than 600 ms apart make a streak, and the step grows with it: presses 1–3
// move 10 s, 4–8 30 s, 9–16 1 min, then 2 min. Holding the key counts as a press about
// every 180 ms. The bar (and the time above it) moves right away; the video jumps 1.5 s
// after the last press, or at once on OK.
let scrub = null; // { input, dir, count, last, timer }
function scrubStep(input, dir) {
  const now = Date.now();
  if (scrub && scrub.input !== input) commitScrub();
  if (scrub && scrub.dir === dir && now - scrub.last < 180) {
    // Key repeat faster than a step: keep the streak alive without moving.
    clearTimeout(scrub.timer);
    scrub.timer = setTimeout(commitScrub, 1500);
    return;
  }
  if (!scrub) scrub = { input, dir, count: 0, last: 0 };
  if (scrub.dir !== dir || now - scrub.last > 600) scrub.count = 0;
  scrub.dir = dir;
  scrub.last = now;
  const n = ++scrub.count;
  const step = n <= 3 ? 10 : n <= 8 ? 30 : n <= 16 ? 60 : 120;
  const max = Number(input.max) || 0;
  input.value = String(Math.max(0, Math.min(max - 1, Number(input.value) + dir * step)));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  clearTimeout(scrub.timer);
  scrub.timer = setTimeout(commitScrub, 1500);
}
function commitScrub() {
  if (!scrub) return;
  clearTimeout(scrub.timer);
  const { input } = scrub;
  scrub = null;
  if (input.isConnected) input.dispatchEvent(new Event('change', { bubbles: true }));
}
function cancelScrub() {
  if (scrub) clearTimeout(scrub.timer);
  scrub = null;
}

// When the player's controls come up, focus goes to Skip Intro or the next-episode card
// if one is showing, otherwise to Play/Pause.
function playerFirst(watch) {
  const skip = watch.querySelector('.skip-btn');
  const next = watch.querySelector('.next-card .btn.play');
  return (skip && visible(skip) && skip) || (next && visible(next) && next) || watch.querySelector('.big-play');
}

// ---------- long press OK on a Continue Watching card ----------
// Held for 600 ms it asks to remove the card (through the card's ✕, hidden on TVs);
// let go sooner, it opens as usual.
let press = null; // { el, timer, long }
function startPress(el) {
  press = { el, long: false };
  press.timer = setTimeout(() => {
    press.long = true;
    el.closest('.landscape-wrap')?.querySelector('.remove-btn')?.click();
  }, 600);
}
function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  const { el, long } = press;
  press = null;
  if (!long && el.isConnected && document.activeElement === el) el.click();
}

function redispatch(target, key) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  synthetic.add(ev);
  target.dispatchEvent(ev);
}

function onKey(e) {
  if (synthetic.has(e)) return;
  const mapped = TIZEN_KEYS[e.keyCode];
  const key = mapped || e.key;
  const watch = document.querySelector('.watch');
  const active = document.activeElement;
  let onControl = active && active !== document.body && active !== watch && active.matches?.(FOCUSABLE);

  // ---------- in the player ----------
  if (watch) {
    // Controls hidden but focus still on one of them: start over from the player
    // itself (scrub, or show the controls on Play).
    if (watch.classList.contains('idle') && onControl && !active.closest('.player-backdrop, .next-card, .skip-btn')) {
      watch.focus();
      mark(null);
      onControl = false;
    }
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const seek = watch.querySelector('.seek');
    if (key === 'Escape') cancelScrub();
    // OK on the seek bar: jump to the scrubbed time now, or play/pause when not scrubbing.
    if (key === 'Enter' && onControl && active === seek) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (scrub) commitScrub();
      else redispatch(watch, 'MediaPlayPause');
      return;
    }
    // Nothing focused: ←/→ open the controls straight into scrubbing; any other key
    // (except Back) brings them up on Play (or Skip Intro / Next episode) and still does
    // its job: OK and Play/Pause play or pause.
    if (!onControl && key !== 'Escape' && !watch.querySelector('.player-backdrop:not([hidden])')) {
      if (horizontal && seek) {
        e.preventDefault();
        e.stopImmediatePropagation();
        watch.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        seek.focus();
        mark(seek);
        scrubStep(seek, key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      watch.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      const first = playerFirst(watch);
      if (first) { first.focus(); mark(first); }
      if (key.startsWith('Arrow') || mapped || key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!key.startsWith('Arrow')) redispatch(watch, key);
      }
      return;
    }
    if (mapped) {
      e.preventDefault();
      e.stopImmediatePropagation();
      redispatch(onControl ? active : watch, key);
      return;
    }
    if (!key.startsWith('Arrow')) return;
    // On the seek bar, ←/→ scrub.
    if (active === seek && horizontal) {
      e.preventDefault();
      e.stopImmediatePropagation();
      watch.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      scrubStep(seek, key === 'ArrowLeft' ? -1 : 1);
      return;
    }
  } else if (mapped === 'Escape') {
    // ---------- browsing: Back ----------
    e.preventDefault();
    e.stopImmediatePropagation();
    const dlg = document.querySelector('dialog[open]');
    if (dlg) return dlg.close();
    // An open profile menu: Back just closes it, back onto the profile button.
    const menu = document.querySelector('.profile-menu:not([hidden])');
    if (menu) {
      menu.hidden = true;
      const btn = document.querySelector('.profile-btn');
      if (btn) focusEl(btn);
      return;
    }
    if (active?.matches('input, textarea')) return active.blur();
    const atHome = !location.hash || location.hash === '#/' || location.hash === '#';
    if (atHome) {
      if (fromApp) confirmExit();
      else try { window.tizen?.application.getCurrentApplication().exit(); } catch {}
    } else {
      history.back();
    }
    return;
  }

  // OK on a Continue Watching card: wait to see whether it's a long press. Until OK is let
  // go, its repeats are swallowed (they'd otherwise press a button in the dialog).
  if (press && press.long && !e.repeat) press = null; // the key-up went missing
  if (key === 'Enter' && (press || active?.matches?.('.landscape-wrap .landscape'))) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!press) startPress(active);
    return;
  }

  if (!key.startsWith('Arrow')) return;
  // Typing in a text box: ←/→ move the cursor, and leave the box once the cursor
  // is already at that edge (always, when it's empty).
  if (active?.matches('input:not([type="range"]):not([type="checkbox"]), textarea') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const len = active.value.length;
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? len;
    const rtl = getComputedStyle(active).direction === 'rtl';
    const towardEnd = (key === 'ArrowRight') !== rtl;
    if (len && (towardEnd ? end < len : start > 0)) return;
  }

  e.preventDefault();
  e.stopImmediatePropagation();
  if (!onControl || !visible(active)) {
    const first = firstInView();
    if (first) focusEl(first);
    return;
  }
  const next = nearest(active, key);
  if (next) focusEl(next);
}

// ---------- leaving the Samsung app ----------
// Only the app's own launcher page may close the app; the site, loaded from the server,
// can't. So the launcher stays first in history (it opens the site with ?app=1), every
// page here notes how far it is from it, and Exit goes back that many steps to the
// launcher, which then closes the app.
const fromApp = new URLSearchParams(location.search).get('app') === '1';
let depth = 0;
function stampDepth() {
  const st = history.state;
  if (st && typeof st.dsDepth === 'number') depth = st.dsDepth;
  else history.replaceState(Object.assign({}, st, { dsDepth: (depth += 1) }), '');
}

// The count can be off (a page swapped in place with location.replace looks like a new
// step, and a jump past the start does nothing), so after the jump keep stepping back
// until this page is gone. A dark cover hides the pages flicking past.
function leaveApp() {
  document.body.append(h('div', { class: 'exit-cover' }));
  if (depth > 0) history.go(-depth);
  setInterval(() => history.back(), 250);
}

function confirmExit() {
  confirmDialog({ title: t('Exit DriveStream?'), ok: t('Exit'), onOk: leaveApp });
}

// A yes/no question (Exit DriveStream?, Remove from Continue Watching?): Cancel and the
// action, with the action (or Cancel) focused. Cancel puts focus back where it was.
export function confirmDialog({ title, text, ok, onOk, focusCancel = false }) {
  const back = document.activeElement;
  let chosen = false;
  const dlg = h('dialog', { class: 'modal exit-modal' },
    h('h2', {}, title),
    text ? h('p', {}, text) : null,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn info', onclick: () => dlg.close() }, t('Cancel')),
      h('button', { class: 'btn play', onclick: () => { chosen = true; dlg.close(); onOk(); } }, ok)));
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (!chosen && back && back !== document.body && back.isConnected) { back.focus({ preventScroll: true }); if (tvMode) mark(back); }
  });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector(focusCancel ? '.btn.info' : '.btn.play');
  if (tvMode) focusEl(first);
  else first.focus();
}

if (tvMode) {
  document.documentElement.classList.add('tv');
  if (fromApp) {
    stampDepth();
    window.addEventListener('hashchange', stampDepth);
  }
  // A 1920-wide TV page reads tiny from the sofa: lay it out 1280 wide so the TV scales
  // everything up 1.5x (sharp, not zoomed pixels).
  if (innerWidth >= 1600) document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=1280');
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', (e) => { if (press && e.key === 'Enter') { e.preventDefault(); endPress(); } }, true);
  document.addEventListener('focusin', (e) => mark(e.target));
  // Ask Tizen to deliver the media keys to the page.
  try {
    for (const k of ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward', 'MediaStop']) {
      window.tizen?.tvinputdevice?.registerKey(k);
    }
  } catch {}
  // After the first screen and each page change, put focus somewhere sensible.
  const settle = () => setTimeout(() => {
    if (document.querySelector('.watch')) return;
    const a = document.activeElement;
    if (!a || a === document.body || !visible(a)) { const f = firstInView(); if (f) { f.focus({ preventScroll: true }); mark(f); } }
  }, 900);
  window.addEventListener('hashchange', settle);
  window.addEventListener('load', settle);
}
