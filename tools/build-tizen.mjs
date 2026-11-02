// Prepares the Samsung TV (Tizen) app for your server in tizen/build/.
//
// Settings come from tizen/tizen.config.json (copy tizen.config.example.json):
//   server      your DriveStream address, e.g. https://stream.example.com (HTTPS strongly advised)
//   packageId   10 letters/digits, unique to your app (Tizen Studio can generate one)
//   wideIcon    true to use icon-wide.png as the app icon instead of icon.png
//
//   node tools/build-tizen.mjs
//
// Then sign and package tizen/build/ with your own Samsung certificate in Tizen Studio
// (or: tizen package -t wgt -s <your-profile> -- tizen/build). See README → "Samsung TV".

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tizen');
const out = path.join(src, 'build');
const cfgFile = path.join(src, 'tizen.config.json');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(cfgFile)) fail('Missing tizen/tizen.config.json: copy tizen/tizen.config.example.json and fill it in.');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));

let server;
try {
  server = new URL(cfg.server);
} catch {
  fail(`"server" is not a valid address: ${cfg.server}`);
}
if (!['http:', 'https:'].includes(server.protocol)) fail('"server" must start with https:// (or http://)');
if (/example\.com$/i.test(server.hostname)) fail('Set "server" to your own DriveStream address.');
if (!/^[A-Za-z0-9]{10}$/.test(cfg.packageId || '') || cfg.packageId === 'AbCdE12345') {
  fail('"packageId" must be your own 10 letters/digits (e.g. from Tizen Studio\'s new-project wizard).');
}

const values = {
  __DRIVESTREAM_SERVER__: server.origin,
  __SERVER_HOST__: server.hostname,
  __WIDGET_ID__: `${server.protocol}//${server.hostname}/tizen`,
  __TIZEN_PACKAGE_ID__: cfg.packageId,
};
const fill = (text) => text.replace(/__[A-Z_]+__/g, (k) => values[k] ?? k);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'launcher.css', 'logo.svg', 'service']) cpSync(path.join(src, f), path.join(out, f), { recursive: true });
cpSync(path.join(src, cfg.wideIcon ? 'icon-wide.png' : 'icon.png'), path.join(out, 'icon.png'));
for (const f of ['config.xml', 'launcher.js', 'service/service.js']) {
  writeFileSync(path.join(out, f), fill(readFileSync(path.join(src, f), 'utf8')));
}
console.log(`Samsung app prepared in tizen/build for ${server.origin} (package ${cfg.packageId}).`);
