// Builds the "old TV" version of the web front end into public/tv/.
//
// Older smart TVs (e.g. Samsung 2018, Tizen 4.0 = Chrome 56) can't run the site as is:
// no ES modules, no optional chaining, and no CSS clamp()/min()/max(), grid, flex gap,
// aspect-ratio, inset or translate. Modern browsers keep using public/app.js and
// styles.css; index.html loads public/tv/app.js only on browsers without module support.
//
//   node tools/build-tv.mjs
//
// The CSS is adapted for the 1280×720 layout TV mode uses, so viewport units and
// clamp()/min()/max() are worked out to fixed sizes.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const out = path.join(pub, 'tv');
mkdirSync(out, { recursive: true });

// ---------- JavaScript ----------
await build({
  entryPoints: [path.join(pub, 'tv-entry.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome56',
  minify: true,
  outfile: path.join(out, 'app.js'),
  logLevel: 'warning',
});

// ---------- CSS ----------
// TV mode lays the page out 1280×720 (tv.js sets the viewport), scaled up 1.5x by the TV.
const VW = 12.8;
const VH = 7.2;

// Work out a length at 1920×1080; null when it depends on something we can't know (%, var()).
function px(v) {
  v = v.trim();
  let m;
  if ((m = v.match(/^(-?[\d.]+)px$/))) return Number(m[1]);
  if ((m = v.match(/^(-?[\d.]+)vw$/))) return Number(m[1]) * VW;
  if ((m = v.match(/^(-?[\d.]+)vh$/))) return Number(m[1]) * VH;
  if ((m = v.match(/^(-?[\d.]+)svh$/))) return Number(m[1]) * VH;
  if ((m = v.match(/^(-?[\d.]+)rem$/))) return Number(m[1]) * 16;
  if (v === '0') return 0;
  return null;
}

function splitArgs(s) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; } else cur += ch;
  }
  args.push(cur);
  return args.map((a) => a.trim());
}

// Replace clamp()/min()/max() (innermost first) with a fixed value where possible.
function resolveFns(value) {
  const re = /\b(clamp|min|max)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/;
  for (let guard = 0; guard < 20; guard++) {
    const m = value.match(re);
    if (!m) break;
    const args = splitArgs(m[2]).map((a) => resolveFns(a));
    const nums = args.map(px);
    let rep;
    if (m[1] === 'clamp') {
      const [lo, mid, hi] = nums;
      rep = mid != null && lo != null && hi != null ? `${Math.round(Math.min(hi, Math.max(lo, mid)))}px`
        : (args[1].includes('%') ? args[1] : args[2]);
    } else if (nums.every((n) => n != null)) {
      rep = `${Math.round(m[1] === 'min' ? Math.min(...nums) : Math.max(...nums))}px`;
    } else {
      // min(720px, 100%) → 720px; max(..) with an unknown → the known one
      rep = args.find((a, i) => nums[i] != null) || args[0];
    }
    value = value.replace(m[0], rep);
  }
  return value.replace(/(\d)svh\b/g, '$1vh');
}

function adaptDecls(selector, body) {
  const decls = body.split(/;(?![^(]*\))/).map((d) => d.trim()).filter(Boolean);
  const map = new Map();
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i > 0) map.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  const outDecls = [];
  const extra = [];
  const display = map.get('display');
  const isGrid = display === 'grid' || display === 'inline-grid';
  const isFlex = display === 'flex' || display === 'inline-flex';
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i < 0) { outDecls.push(d); continue; }
    const prop = d.slice(0, i).trim();
    let val = resolveFns(d.slice(i + 1).trim());
    if (prop === 'inset') {
      const p = val.split(/\s+/);
      const [t, r = t, b = t, l = r] = p;
      outDecls.push(`top: ${t}`, `right: ${r}`, `bottom: ${b}`, `left: ${l}`);
    } else if (prop === 'translate') {
      const [x, y = '0'] = val.split(/\s+/);
      const tr = map.get('transform');
      outDecls.push(`transform: translate(${x}, ${y})${tr && tr !== 'none' ? ' ' + resolveFns(tr) : ''}`);
    } else if (prop === 'aspect-ratio') {
      const [w, h] = val.split('/').map((n) => Number(n.trim()));
      const width = map.get('width');
      if (width && !width.includes('%')) outDecls.push(`height: calc(${resolveFns(width)} * ${h} / ${w})`);
    } else if (prop === 'display' && isGrid) {
      outDecls.push(`display: ${val === 'inline-grid' ? 'inline-flex' : 'flex'}`);
    } else if (prop === 'place-items') {
      outDecls.push('align-items: center', 'justify-content: center');
    } else if (prop === 'gap' && (isFlex || isGrid)) {
      const [rowGap, colGap = rowGap] = val.split(/\s+/);
      const column = map.get('flex-direction') === 'column';
      const sels = selector.split(',').map((s) => s.trim());
      if (column) extra.push(`${sels.map((s) => `${s} > * + *`).join(', ')} { margin-top: ${rowGap}; }`);
      else {
        extra.push(`${sels.map((s) => `${s} > * + *`).join(', ')} { margin-left: ${colGap}; }`);
        // Right-to-left (Arabic) rows run the other way, so the space goes on the right.
        const rtl = (s) => (/^html\b/.test(s) ? s.replace(/^html/, 'html[dir="rtl"]') : `html[dir="rtl"] ${s}`);
        extra.push(`${sels.map((s) => `${rtl(s)} > * + *`).join(', ')} { margin-left: 0; margin-right: ${colGap}; }`);
        if (map.get('flex-wrap') === 'wrap') extra.push(`${sels.map((s) => `${s} > *`).join(', ')} { margin-bottom: ${rowGap}; }`);
      }
    } else if (prop === 'grid-template-columns') {
      // dropped: hand-written replacements below
    } else {
      outDecls.push(`${prop}: ${val}`);
    }
  }
  return { body: outDecls.join('; '), extra };
}

function adaptCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:focus-visible/g, ':focus');
  // The adapted stylesheet lives in tv/, so relative urls (fonts, images) move up a level.
  css = css.replace(/url\((['"]?)(?!data:|https?:|\/|\.\.\/)/g, 'url($1../');
  let result = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      // find the matching close of the block and adapt its contents recursively
      let depth = 1;
      let j = open + 1;
      while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      result += `${resolveFns(selector)} {\n${adaptCss(css.slice(open + 1, j - 1))}}\n`;
      i = j;
      continue;
    }
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    if (selector.startsWith('@font-face') || selector.startsWith('@keyframes') || selector.startsWith('from') || selector.startsWith('to') || /^\d+%$/.test(selector)) {
      result += `${selector} {${body}}\n`;
    } else {
      const { body: b, extra } = adaptDecls(selector, body);
      result += `${selector} { ${b} }\n${extra.join('\n')}${extra.length ? '\n' : ''}`;
    }
    i = close + 1;
  }
  return result;
}

const fixes = `
/* ---------- hand-written replacements for grid / aspect-ratio ---------- */
.landscape-img { height: calc(var(--land-w) * 9 / 16); }
.grid { display: flex; flex-wrap: wrap; }
.grid > * { width: var(--poster-w); margin: 0 12px 18px 0; }
.grid > * + * { margin-left: 0; }
.episode { display: flex; align-items: center; }
.episode > * + * { margin-left: 18px; }
html[dir="rtl"] .episode > * + * { margin-left: 0; margin-right: 18px; }
.episode > .ep-num { flex: none; width: 34px; }
.episode > .ep-img { flex: none; width: 220px; height: 124px; }
.episode > :last-child { flex: 1; min-width: 0; }
.detail-hero, .hero { height: 720px; }
.detail-hero { height: auto; min-height: 720px; }
`;

const css = readFileSync(path.join(pub, 'styles.css'), 'utf8');
writeFileSync(path.join(out, 'styles.css'), adaptCss(css) + fixes);
console.log('Built public/tv/app.js and public/tv/styles.css');
