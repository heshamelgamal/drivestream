// Shared helpers for building the UI.

import { t } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

const ICONS = {
  play: '<path d="M8 5.1v13.8a1 1 0 0 0 1.5.86l11-6.9a1 1 0 0 0 0-1.72l-11-6.9A1 1 0 0 0 8 5.1z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  back10: '<path d="M12.6 3.2A8.8 8.8 0 1 1 5.6 6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12.9.6 8.3 3.2l4.6 2.6z"/><text x="12" y="15.1" font-size="8" font-weight="700" text-anchor="middle">10</text>',
  fwd10: '<g transform="translate(24 0) scale(-1 1)"><path d="M12.6 3.2A8.8 8.8 0 1 1 5.6 6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12.9.6 8.3 3.2l4.6 2.6z"/></g><text x="12" y="15.1" font-size="8" font-weight="700" text-anchor="middle">10</text>',
  volume: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',
  mute: '<path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15.3" font-size="7" font-weight="800" text-anchor="middle">CC</text>',
  fullscreen: '<path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/>',
  exitFullscreen: '<path d="M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z"/>',
  next: '<path d="M5 5.5v13a1 1 0 0 0 1.55.83L16 13v6h2V5h-2v6L6.55 4.67A1 1 0 0 0 5 5.5z"/>',
  back: '<path d="M20.5 12H4.5M11 5.2 4.2 12l6.8 6.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 10h2v7h-2zM11 7h2v2h-2z"/>',
  check: '<path d="M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  chevronL: '<path d="M15.4 4.6L8 12l7.4 7.4 1.4-1.4-6-6 6-6z"/>',
  chevronR: '<path d="M8.6 4.6L16 12l-7.4 7.4-1.4-1.4 6-6-6-6z"/>',
  refresh: '<path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS[name]}</svg>`; // static, trusted markup
  return span;
}

export async function api(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !/^\/api\/(login|me)\b/.test(url)) window.dispatchEvent(new Event('ds:signed-out'));
  if (!res.ok) throw Object.assign(new Error(body.error ? t(body.error) : `Request failed (${res.status})`), { status: res.status, field: body.field });
  return body;
}

// Required by the DriveStream license (LICENSE §3, NOTICE): keep this credit visible.
// tools/check-credit.mjs and the server's startup check look for it.
export const credit = () => h('p', { class: 'credit' }, t('Developed by '), h('strong', {}, 'Hesham Elgamal'));

// "Download App" buttons for the newest Android phone and TV builds the server has.
export async function appDownloads() {
  const apps = await fetch('/api/apps').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const labels = { Phone: ['📱', 'Android Phone'], TV: ['📺', 'Android TV'] };
  const links = Object.entries(labels)
    .filter(([key]) => apps[key])
    .map(([key, [emoji, name]]) => h('a', { class: 'app-dl', href: apps[key].url, download: '' },
      h('span', { class: 'app-dl-icon', 'aria-hidden': 'true' }, emoji),
      h('span', {}, h('small', {}, t('Download App')), h('strong', {}, t(name)), h('em', {}, `v${apps[key].version} · ${Math.round(apps[key].size / 1048576)} MB`))));
  return links.length ? h('div', { class: 'app-downloads' }, links) : null;
}

export const send = (url, method, body) =>
  api(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

export function avatar(user, size = 32) {
  return h('span', { class: 'avatar', style: `background:${user.color || '#e50914'};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.48)}px`, 'aria-hidden': 'true' },
    (user.name || '?').trim().charAt(0).toUpperCase());
}

export const tmdbImg = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

export const posterUrl = (it) => tmdbImg(it.poster, 'w342') || (it.posterId ? `/thumb/${it.posterId}?s=500` : null);
export const backdropUrl = (it, size = 'w1280') =>
  tmdbImg(it.backdrop, size) || (it.thumbId ? `/thumb/${it.thumbId}?s=${size === 'original' ? 1600 : 1280}` : null);

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function fmtRuntime(min) {
  if (!min) return '';
  return min >= 60 ? t('{h}h {m}m', { h: Math.floor(min / 60), m: min % 60 }) : t('{m}m', { m: min });
}

export function fmtSize(bytes) {
  const b = Number(bytes);
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i > 2 ? 1 : 0)} ${u[i]}`;
}

export const qualityBadge = (hgt) => (!hgt ? null : hgt >= 2000 ? '4K' : hgt >= 1000 ? 'HD' : hgt >= 700 ? 'HD' : 'SD');

export function img(src, alt, cls, onFail) {
  if (!src) return onFail ? onFail() : null;
  const el = h('img', { src, alt, class: cls, loading: 'lazy', decoding: 'async' });
  el.addEventListener('error', () => (onFail ? el.replaceWith(onFail()) : el.remove()), { once: true });
  return el;
}

export const prefs = {
  get(k, d = null) {
    try { return JSON.parse(localStorage.getItem('ds.' + k)) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('ds.' + k, JSON.stringify(v)); } catch {}
  },
};
