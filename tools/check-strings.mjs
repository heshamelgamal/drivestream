// Checks that the website and the Android app say the same thing in Arabic.
//
// The two keep their own dictionaries: public/i18n.js is keyed by the English text,
// app/src/lib/i18n.tsx by ids with an English and an Arabic table. For every phrase whose
// English appears in both, and every category/genre name, the Arabic must match.
//
//   node tools/check-strings.mjs      (exits 1 and lists the differences if any)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// The 'key': 'value' lines of the object literal that starts with `start`.
function table(src, start) {
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`Not found: ${start}`);
  const body = src.slice(from, src.indexOf('\n};', from));
  const out = {};
  const re = /^\s*'((?:[^'\\]|\\.)+)':\s*'((?:[^'\\]|\\.)*)',?\s*(?:\/\/.*)?$/gm;
  for (const m of body.matchAll(re)) out[m[1].replace(/\\'/g, "'")] = m[2].replace(/\\'/g, "'").replace(/\\n/g, '\n');
  return out;
}

const web = read('public/i18n.js');
const app = read('app/src/lib/i18n.tsx');
const webAR = table(web, 'const AR = {');
const webNames = table(web, 'const AR_NAMES = {');
const appEN = table(app, 'const en = {');
const appAR = table(app, 'const ar: Record<Key, string> = {');
const appNames = { ...table(app, 'const CATEGORIES: Record<string, string> = {'), ...table(app, 'const GENRES: Record<string, string> = {') };

const problems = [];
for (const [key, english] of Object.entries(appEN)) {
  const webArabic = webAR[english];
  if (webArabic !== undefined && webArabic !== appAR[key]) problems.push(`"${english}"\n    website: ${webArabic}\n    app:     ${appAR[key]}  (${key})`);
}
for (const [name, arabic] of Object.entries(appNames)) {
  if (webNames[name] === undefined) problems.push(`name "${name}" is missing on the website (app: ${arabic})`);
  else if (webNames[name] !== arabic) problems.push(`name "${name}"\n    website: ${webNames[name]}\n    app:     ${arabic}`);
}
for (const name of Object.keys(webNames)) {
  if (appNames[name] === undefined) problems.push(`name "${name}" is missing in the app (website: ${webNames[name]})`);
}

const shared = Object.values(appEN).filter((e) => webAR[e] !== undefined).length;
if (problems.length) {
  console.log(`${problems.length} difference(s) between the website and the app:\n`);
  console.log(problems.join('\n\n'));
  process.exit(1);
}
console.log(`Website and app agree (${shared} shared phrases, ${Object.keys(appNames).length} names).`);
