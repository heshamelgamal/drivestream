import express from 'express';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, createReadStream, renameSync } from 'node:fs';
import { networkInterfaces, cpus, setPriority } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStorage } from './lib/storage/index.js';
import { scanCategory, buildIndex, nextEpisode } from './lib/library.js';
import { createTmdb } from './lib/tmdb.js';
import { jsonStore, mapLimit } from './lib/store.js';
import { createAccounts } from './lib/accounts.js';
import { createSegments } from './lib/segments.js';
import { fixRtlVtt } from './lib/rtl.js';
import { createUploader } from './lib/uploader.js';
import { createDeviceLogin, prettyCode } from './lib/devicelogin.js';
import { checkCredit } from './lib/credit.js';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // 127.0.0.1 when behind a reverse proxy
const PUBLIC_URL = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '') || ''; // the address viewers use, for cast links
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const RESCAN_MINUTES = Number(process.env.RESCAN_MINUTES) || 30;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

// Where the media lives: Google Drive (STORAGE=drive) or a folder on this server (STORAGE=local).
const storage = await createStorage(process.env).catch((e) => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});

// "Movies|movie|<folder>, TV Series|tv|<folder>, Animation|auto|<folder>"
// <folder> is a Drive folder link or id, or a sub-folder of LOCAL_MEDIA_DIR.
function parseCategories(spec = '') {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, type, ref] = part.split('|').map((t) => t?.trim());
      return { name, type, ref };
    });
  // Local storage without CATEGORIES: every sub-folder of LOCAL_MEDIA_DIR is a category.
  return (parts.length ? parts : storage.defaultCategories()).map(({ name, type, ref }) => ({
    name,
    type: ['movie', 'tv', 'auto'].includes(type) ? type : 'auto',
    folderId: storage.resolveRef(ref),
    slug: (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }));
}

const CATEGORIES = parseCategories(process.env.CATEGORIES);

// ---------- startup checks ----------

const problems = [...storage.problems];
if (!problems.length && !CATEGORIES.length) {
  problems.push(storage.name === 'local' ? 'LOCAL_MEDIA_DIR has no sub-folders and CATEGORIES is not set' : 'CATEGORIES is not set in .env');
}
for (const c of CATEGORIES) if (!c.name || !c.folderId) problems.push(`Bad CATEGORIES entry for "${c.name}"`);
if (problems.length) {
  console.error('\nDriveStream is not configured yet:\n  - ' + problems.join('\n  - '));
  console.error('\nSee README.md → "Setup".\n');
  process.exit(1);
}

const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const hasFfprobe = spawnSync(FFPROBE, ['-version']).status === 0;
const tmdb = createTmdb({
  key: process.env.TMDB_API_KEY?.trim(),
  language: process.env.TMDB_LANGUAGE || 'en-US',
  cacheFile: path.join(DATA, 'tmdb-cache.json'),
});

// ---------- library state ----------

const library = jsonStore(path.join(DATA, 'library.json'), { items: [], scannedAt: 0 });
const accounts = createAccounts(DATA);
// First start: the admin profile gets APP_PASSWORD (or a generated password, printed below).
const bootstrap = accounts.ensureAdmin({ username: process.env.ADMIN_USERNAME || 'admin', password: APP_PASSWORD });
let index = buildIndex(library.data.items);
let scanning = null;
let lastScanError = null;

function rescan() {
  scanning ??= (async () => {
    const started = Date.now();
    const items = (await Promise.all(CATEGORIES.map((c) => scanCategory(c, storage)))).flat();
    if (tmdb) {
      await mapLimit(items, 4, async (item) => {
        item.meta = await tmdb.match(item).catch((e) => {
          console.warn(`TMDB lookup failed for "${item.title}": ${e.message}`);
          return null;
        });
      });
    }
    // Keep durations we probed earlier.
    const old = index.files;
    for (const [id, loc] of buildIndex(items).files) {
      const v = loc.versions.find((x) => x.id === id);
      const prev = old.get(id)?.versions.find((x) => x.id === id);
      if (v && !v.durationMs && prev?.durationMs) v.durationMs = prev.durationMs;
    }
    library.data = { items, scannedAt: Date.now() };
    library.save();
    index = buildIndex(items);
    lastScanError = null;
    console.log(`Library scanned: ${items.length} titles in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    detectSegments().catch((e) => console.error('Intro detection:', e.message));
  })()
    .catch((e) => {
      lastScanError = e.message;
      console.error('Scan failed:', e.message);
    })
    .finally(() => (scanning = null));
  return scanning;
}

// Uploads finish one by one; rescan once they've settled for a bit.
let uploadRescan;
function rescanSoon() {
  clearTimeout(uploadRescan);
  uploadRescan = setTimeout(() => (scanning || Promise.resolve()).then(rescan), 20_000);
}

// "Add to Google Drive" (admins) only exists with Drive storage.
const uploader = storage.supportsUploads
  ? createUploader({
      dataDir: DATA,
      publicUrl: PUBLIC_URL || `http://localhost:${PORT}`,
      categories: CATEGORIES,
      onUploaded: rescanSoon,
      driveApi: process.env.DRIVE_API_URL || undefined, // tests point these at a fake Google
      oauthBase: process.env.GOOGLE_OAUTH_URL || undefined,
    })
  : null;

// ---------- shaping data for the UI ----------

const maxHeight = (versions) => Math.max(0, ...versions.map((v) => v.height || 0)) || null;

function summary(item) {
  const m = item.meta || {};
  const eps = item.kind === 'show' ? item.seasons.flatMap((s) => s.episodes) : null;
  return {
    id: item.id,
    kind: item.kind,
    category: item.category,
    title: m.title || item.title,
    year: m.year || item.year,
    overview: m.overview || '',
    poster: m.poster || null,
    backdrop: m.backdrop || null,
    rating: m.rating || null,
    genres: m.genres || [],
    posterId: item.posterId,
    thumbId: item.thumbId,
    addedAt: item.addedAt,
    quality: maxHeight(eps ? eps.flatMap((e) => e.versions) : item.versions),
    durationMs: item.kind === 'movie' ? item.versions[0].durationMs : null,
    seasonCount: eps ? item.seasons.filter((s) => s.season > 0).length || item.seasons.length : null,
    episodeCount: eps ? eps.length : null,
  };
}

const epLabel = (ep) => (ep ? `S${ep.season}:E${ep.episode}` : null);

// Latest progress entry across all versions (qualities) of one movie/episode,
// from one profile's history.
function progressOf(history, versions) {
  let best = null;
  for (const v of versions) {
    const p = history.files[v.id];
    if (p && (!best || p.at > best.at)) best = { ...p, fileId: v.id };
  }
  return best;
}

function continueWatching(history) {
  const latest = new Map();
  for (const [fileId, p] of Object.entries(history.files)) {
    const loc = index.files.get(fileId);
    if (!loc) continue;
    const hiddenAt = history.hidden[loc.item.id];
    if (hiddenAt && p.at <= hiddenAt) continue; // removed from the row; comes back if watched again
    const cur = latest.get(loc.item.id);
    if (!cur || p.at > cur.p.at) latest.set(loc.item.id, { fileId, p, loc });
  }
  const out = [];
  for (const { fileId, p, loc } of latest.values()) {
    if (p.done) {
      const nx = nextEpisode(loc);
      if (nx) out.push({ item: summary(loc.item), fileId: nx.versions[0].id, t: 0, d: null, at: p.at, label: epLabel(nx), upNext: true });
    } else if (p.t > 30 || p.t / p.d > 0.02) {
      out.push({ item: summary(loc.item), fileId, t: p.t, d: p.d, at: p.at, label: epLabel(loc.ep) });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 20);
}

async function seasonMeta(item, season) {
  if (!tmdb || !item.meta?.tmdbId) return {};
  return tmdb.season(item.meta.tmdbId, season).catch(() => ({}));
}

// ffmpeg/ffprobe read files through our own /stream endpoint (which handles
// storage access and range requests), so no Google token or disk path appears
// in a process command line. This per-run key lets them past sign-in.
const INTERNAL_KEY = randomBytes(24).toString('hex');
const localStream = (id) => [
  '-headers', `X-Internal: ${INTERNAL_KEY}\r\n`,
  '-i', `http://127.0.0.1:${PORT}/stream/${encodeURIComponent(id)}`,
];

function probeDuration(id) {
  if (!hasFfprobe) return null;
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ...localStream(id)]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 20000);
    p.on('close', () => {
      clearTimeout(timer);
      const s = parseFloat(out);
      resolve(Number.isFinite(s) ? Math.round(s * 1000) : null);
    });
    p.on('error', () => resolve(null));
  });
}

// ---------- intro / credits detection ----------

const segments = hasFfmpeg
  ? createSegments({ dataDir: DATA, ffmpeg: FFMPEG, inputArgs: localStream, log: (m) => console.log(m) })
  : null;

// After each scan: fingerprint any new episodes (one at a time, lowest CPU priority).
async function detectSegments() {
  if (!segments) return;
  const shows = [];
  for (const item of library.data.items) {
    if (item.kind !== 'show') continue;
    const eps = item.seasons.flatMap((s) => s.episodes).filter((e) => e.season > 0);
    for (const e of eps) {
      const v = e.versions[0];
      if (!v.durationMs) v.durationMs = await probeDuration(v.id);
    }
    shows.push({ title: item.title, episodes: eps.map((e) => ({ fileId: e.versions[0].id, durationSec: e.versions[0].durationMs / 1000 || null })) });
  }
  library.save();
  await segments.run(shows);
}

// Segments are found on the main version; other qualities of the same episode share them.
function segmentsFor(loc) {
  if (!segments || !loc.ep) return null;
  return segments.get(loc.versions[0].id);
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use('/api/uploads', express.json({ limit: '256kb' })); // long link lists
app.use(express.json({ limit: '10kb' }));

// The app shell (HTML/JS/CSS) holds no library data, so it's public; it shows
// the sign-in screen when /api/me says nobody is signed in.
app.use(express.static(path.join(__dirname, 'public')));

// ---------- app downloads ----------
// APKs live in downloads/ (kept apart from public/ so site updates never touch them),
// named DriveStream.<Platform>.<version>.apk. They contain no library data or secrets,
// so like the app shell they're public: the "Download App" buttons work before sign-in.
const DOWNLOADS = path.join(__dirname, 'downloads');
app.use('/downloads', express.static(DOWNLOADS, {
  setHeaders: (res, file) => {
    if (file.endsWith('.apk')) {
      res.set('Content-Type', 'application/vnd.android.package-archive');
      res.set('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    }
  },
}));

const versionKey = (v) => v.split('.').map((n) => n.padStart(5, '0')).join('.');
function latestApps() {
  let files = [];
  try {
    files = readdirSync(DOWNLOADS);
  } catch {}
  const latest = {};
  for (const f of files) {
    const m = f.match(/^DriveStream\.(\w+)\.(\d+(?:\.\d+)*)\.apk$/);
    if (!m) continue;
    const [, platform, version] = m;
    if (!latest[platform] || versionKey(version) > versionKey(latest[platform].version)) {
      latest[platform] = { version, url: `/downloads/${f}`, size: statSync(path.join(DOWNLOADS, f)).size };
    }
  }
  // What's new in each version, shown by the apps' update prompt:
  // downloads/releases.json = { "1.5.2": { "en": ["…"], "ar": ["…"] }, … }
  let notes = {};
  try {
    notes = JSON.parse(readFileSync(path.join(DOWNLOADS, 'releases.json'), 'utf8'));
  } catch {}
  for (const app of Object.values(latest)) app.notes = notes[app.version] || null;
  return latest; // e.g. { Phone: {version, url, size, notes}, TV: {…} }
}
app.get('/api/apps', (req, res) => res.json(latestApps()));

// Short, permanent links to the newest build (/tv.apk, /phone.apk), for typing
// into the Downloader app on a TV or a Downloader code that never needs updating.
app.get('/:platform.apk', (req, res, next) => {
  const hit = Object.entries(latestApps()).find(([p]) => p.toLowerCase() === req.params.platform.toLowerCase());
  if (!hit) return next();
  res.set('Cache-Control', 'no-store');
  res.redirect(302, hit[1].url);
});

// ---------- sign-in ----------

const COOKIE = 'ds_session';
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

function tokenOf(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function sessionCookie(req, token, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Behind nginx the real client is the last X-Forwarded-For entry (the one nginx added).
const clientIp = (req) =>
  LOOPBACK.includes(req.socket.remoteAddress) && req.headers['x-forwarded-for']
    ? req.headers['x-forwarded-for'].split(',').at(-1).trim()
    : req.socket.remoteAddress;

// Slow down password guessing: 10 failed sign-ins per IP per 15 minutes.
const failedLogins = new Map();
const LOGIN_WINDOW_MS = 15 * 60_000;

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  const rec = failedLogins.get(ip);
  if (rec && Date.now() - rec.first < LOGIN_WINDOW_MS && rec.count >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { username, password } = req.body || {};
  const user = accounts.login(username, password);
  if (!user) {
    const r = rec && Date.now() - rec.first < LOGIN_WINDOW_MS ? rec : { first: Date.now(), count: 0 };
    r.count++;
    failedLogins.set(ip, r);
    const field = accounts.loginProblem(username);
    return res.status(401).json({ error: field === 'username' ? 'There’s no profile with that username.' : 'Wrong password.', field });
  }
  failedLogins.delete(ip);
  const token = accounts.startSession(user.id, req.headers['user-agent']);
  res.set('Set-Cookie', sessionCookie(req, token, 90 * 24 * 3600));
  res.json({ user: accounts.publicUser(user), token }); // token is for the phone/TV apps
});

// ---------- Samsung TV home-bar rows (Smart Hub Preview) ----------
// The Samsung app shows Continue Watching and Recently Added above the TV's app bar. That
// part of the app can't use the site's sign-in, so each TV app makes a random key; the site
// links it to whoever signs in on that TV (POST /api/tv/register), and the app fetches its
// rows with it. The key only reads these two rows.
const tvKeys = jsonStore(path.join(DATA, 'tv-keys.json'), {});
const validTvKey = (k) => typeof k === 'string' && /^[a-f0-9]{32,64}$/.test(k);
const PREVIEW_TEXT = {
  en: { cont: 'Continue Watching', recent: 'Recently Added', next: 'Up next' },
  ar: { cont: 'متابعة المشاهدة', recent: 'أُضيف مؤخرًا', next: 'التالي' },
};

function previewImage(req, tmdbPath, size, driveId) {
  if (tmdbPath) return `https://image.tmdb.org/t/p/${size}${tmdbPath}`;
  return driveId ? signedMediaUrl(req, 'thumb', driveId) : null;
}

app.get('/api/tv/preview', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); // the TV app's own page is a local file
  res.set('Cache-Control', 'no-store');
  const key = String(req.query.key || '');
  const user = validTvKey(key) && tvKeys.data[key] ? accounts.byId(tvKeys.data[key].userId) : null;
  if (!user) return res.status(404).json({ error: 'Unknown TV.' });
  const tx = PREVIEW_TEXT[user.lang] || PREVIEW_TEXT.en;
  const sections = [];
  const cont = continueWatching(accounts.historyOf(user.id)).slice(0, 10).map((c) => ({
    title: c.item.title,
    subtitle: c.label ? (c.upNext ? `${tx.next} · ${c.label}` : c.label) : undefined,
    image_ratio: '16by9',
    image_url: previewImage(req, c.item.backdrop, 'w780', c.item.thumbId),
    action_data: JSON.stringify({ path: `#/w/${c.fileId}`, via: `#/t/${c.item.id}` }),
    is_playable: true,
  })).filter((t) => t.image_url);
  if (cont.length) sections.push({ title: tx.cont, tiles: cont });
  const recent = library.data.items.map(summary)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
    .map((it) => ({
      title: it.title,
      image_ratio: '16by9',
      image_url: previewImage(req, it.backdrop, 'w780', it.thumbId),
      action_data: JSON.stringify({ path: `#/t/${it.id}` }),
      is_playable: false,
    }))
    .filter((t) => t.image_url).slice(0, 12);
  if (recent.length) sections.push({ title: tx.recent, tiles: recent });
  res.json({ sections });
});

// ---------- sign in with a code (TVs and apps) ----------
// The device shows a code + QR; a signed-in person approves it on the website or phone app.
const deviceLogin = createDeviceLogin();
const codeStarts = new Map(); // ip -> { first, count }
const linkUrl = (req, code) => `${PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`}/#/link?code=${code}`;

app.post('/api/device/start', (req, res) => {
  const ip = clientIp(req);
  const rec = codeStarts.get(ip);
  const r = rec && Date.now() - rec.first < LOGIN_WINDOW_MS ? rec : { first: Date.now(), count: 0 };
  if (++r.count > 40) return res.status(429).json({ error: 'Too many codes requested. Try again in a few minutes.' });
  codeStarts.set(ip, r);
  const d = deviceLogin.start(req.body?.device);
  res.json({ ...d, display: prettyCode(d.code), url: linkUrl(req, d.code), qr: `/api/device/qr.png?code=${d.code}` });
});

app.post('/api/device/poll', (req, res) => {
  const r = deviceLogin.poll(req.body?.secret);
  if (r.status !== 'approved') return res.json({ status: r.status });
  const user = accounts.byId(r.userId);
  if (!user) return res.json({ status: 'expired' });
  const token = accounts.startSession(user.id, req.headers['user-agent']);
  res.set('Set-Cookie', sessionCookie(req, token, 90 * 24 * 3600));
  res.json({ status: 'approved', user: accounts.publicUser(user), token });
});

app.get('/api/device/qr.png', async (req, res) => {
  const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) return res.status(400).end();
  res.type('png').set('Cache-Control', 'no-store');
  res.send(await QRCode.toBuffer(linkUrl(req, code), { width: 420, margin: 2, errorCorrectionLevel: 'M' }));
});

app.post('/api/logout', (req, res) => {
  accounts.endSession(tokenOf(req));
  res.set('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

// ---------- cast links ----------
// Casting apps (Web Video Cast) fetch the video themselves and can't sign in, so a
// signed-in viewer can ask for a link to one video (and its subtitles) that works
// on its own for a few hours. The signature covers the path and expiry time.
const CAST_KEY_FILE = path.join(DATA, 'cast.key');
if (!existsSync(CAST_KEY_FILE)) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(CAST_KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
}
const CAST_KEY = readFileSync(CAST_KEY_FILE, 'utf8').trim();
const CAST_HOURS = 8;
const castSig = (kind, id, exp) => createHmac('sha256', CAST_KEY).update(`${kind}/${id}/${exp}`).digest('base64url');

function signedMediaUrl(req, kind, id) {
  const exp = Math.floor(Date.now() / 1000) + CAST_HOURS * 3600;
  // nginx drops the port from Host, so behind a proxy set PUBLIC_URL (e.g. https://example.com:8443).
  const base = PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
  return `${base}/${kind}/${encodeURIComponent(id)}?exp=${exp}&sig=${castSig(kind, id, exp)}`;
}

app.use((req, res, next) => {
  const m = req.path.match(/^\/(stream|transcode|subs|thumb)\/([\w-]+)$/);
  const { exp, sig } = req.query;
  if (m && exp && sig && Number(exp) > Date.now() / 1000) {
    const want = Buffer.from(castSig(m[1], m[2], exp));
    const got = Buffer.from(String(sig));
    if (got.length === want.length && timingSafeEqual(got, want)) req.signedMedia = true;
  }
  next();
});

// Everything below needs a signed-in profile (ffmpeg's internal reads and signed cast links excepted).
app.use((req, res, next) => {
  if (req.headers['x-internal'] === INTERNAL_KEY && LOOPBACK.includes(req.socket.remoteAddress)) return next();
  if (req.signedMedia) return next();
  const user = accounts.userForToken(tokenOf(req));
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  req.history = accounts.historyOf(user.id);
  next();
});

const adminOnly = (req, res, next) => (req.user?.isAdmin ? next() : res.status(403).json({ error: 'Admins only.' }));
const needsUploader = (req, res, next) => (uploader ? next() : res.status(404).json({ error: 'Uploads need Google Drive storage.' }));

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status && e.status < 500) res.status(e.status).json({ error: e.message });
    else next(e);
  }
};

app.get('/api/me', (req, res) => res.json({ user: accounts.publicUser(req.user) }));
// Each profile's own settings (for now just the interface language: 'en' or 'ar').
app.patch('/api/me', handle((req, res) => {
  const { lang } = req.body || {};
  res.json({ user: accounts.publicUser(accounts.updateUser(req.user.id, { lang }, req.user)) });
}));

// The Samsung app's key (see /api/tv/preview) now belongs to whoever is signed in on that TV.
app.post('/api/tv/register', (req, res) => {
  const { key } = req.body || {};
  if (!validTvKey(key)) return res.status(400).json({ error: 'Bad key.' });
  if (tvKeys.data[key]?.userId !== req.user.id) {
    tvKeys.data[key] = { userId: req.user.id, at: Date.now() };
    tvKeys.save();
  }
  res.json({ ok: true });
});

// Approving a device code signs that device in as the person approving.
app.get('/api/device/lookup', (req, res) => {
  const d = deviceLogin.lookup(req.query.code);
  d ? res.json(d) : res.status(404).json({ error: 'That code isn’t valid or has expired. Check the code on the TV.' });
});
app.post('/api/device/approve', (req, res) => {
  deviceLogin.approve(req.body?.code, req.user.id)
    ? res.json({ ok: true })
    : res.status(404).json({ error: 'That code isn’t valid or has expired. Check the code on the TV.' });
});

app.post('/api/me/password', handle((req, res) => {
  const { current, next: newPassword } = req.body || {};
  if (!accounts.login(req.user.username, current)) return res.status(400).json({ error: 'Current password is wrong.' });
  accounts.updateUser(req.user.id, { password: newPassword }, req.user);
  // updateUser signed the profile out everywhere; give this device a fresh session.
  const token = accounts.startSession(req.user.id, req.headers['user-agent']);
  res.set('Set-Cookie', sessionCookie(req, token, 90 * 24 * 3600));
  res.json({ ok: true, token });
}));

// ---------- profile management (admins) ----------

function profileStats(id) {
  const h = accounts.historyOf(id);
  const entries = Object.values(h.files);
  return { watched: entries.length, lastWatched: entries.reduce((t, p) => Math.max(t, p.at || 0), 0) || null };
}

app.get('/api/users', adminOnly, (req, res) => {
  res.json({ users: accounts.list().map((u) => ({ ...u, ...profileStats(u.id) })) });
});

app.post('/api/users', adminOnly, handle((req, res) => {
  const { name, username, password, isAdmin } = req.body || {};
  const u = accounts.createUser({ name, username, password, isAdmin: !!isAdmin });
  res.status(201).json({ user: accounts.publicUser(u) });
}));

app.patch('/api/users/:uid', adminOnly, handle((req, res) => {
  const { name, username, password, isAdmin } = req.body || {};
  const patch = { name, username, isAdmin };
  if (password) patch.password = password; // blank = keep the current password
  const u = accounts.updateUser(req.params.uid, patch, req.user);
  res.json({ user: accounts.publicUser(u) });
}));

app.delete('/api/users/:uid', adminOnly, handle((req, res) => {
  accounts.deleteUser(req.params.uid, req.user);
  res.json({ ok: true });
}));

app.post('/api/users/:uid/reset-history', adminOnly, handle((req, res) => {
  if (!accounts.byId(req.params.uid)) return res.status(404).json({ error: 'Profile not found.' });
  accounts.resetHistory(req.params.uid);
  res.json({ ok: true });
}));

// ---------- uploads to Google Drive (admins) ----------
// Links are downloaded on this server and uploaded into the category's Drive folder
// as the connected Google account. The local copy is deleted as soon as each job ends.

app.get('/api/google/status', adminOnly, needsUploader, (req, res) => res.json(uploader.status()));

app.post('/api/google/config', adminOnly, needsUploader, handle((req, res) => {
  uploader.saveClient(req.body || {});
  res.json(uploader.status());
}));

app.get('/api/google/connect', adminOnly, needsUploader, (req, res) => {
  if (!uploader.status().configured) return res.status(400).json({ error: 'Add the Google client ID and secret first.' });
  res.redirect(uploader.authUrl());
});

app.get('/api/google/callback', adminOnly, needsUploader, async (req, res) => {
  const { code, state, error } = req.query;
  try {
    if (error) throw new Error(`Google said: ${error}`);
    await uploader.finishAuth(String(code || ''), String(state || ''));
    res.redirect('/#/admin?drive=connected');
  } catch (e) {
    res.redirect(`/#/admin?drive_error=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
});

app.post('/api/google/disconnect', adminOnly, needsUploader, (req, res) => {
  uploader.disconnect();
  res.json(uploader.status());
});

app.get('/api/uploads', adminOnly, (req, res) => {
  if (!uploader) return res.json({ available: false });
  const shows = Object.fromEntries(CATEGORIES.map((c) => [c.slug, library.data.items.filter((i) => i.category === c.slug && i.kind === 'show').map((i) => i.folderName || i.title).sort()]));
  res.json({ available: true, google: uploader.status(), categories: CATEGORIES.map(({ name, slug, type }) => ({ name, slug, type })), jobs: uploader.list(), shows });
});

app.post('/api/uploads', adminOnly, needsUploader, handle(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
  if (!items.length) return res.status(400).json({ error: 'No links given.' });
  res.status(201).json({ jobs: await uploader.add(items, req.user.id) });
}));

app.post('/api/uploads/:id/retry', adminOnly, needsUploader, (req, res) =>
  uploader.retry(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Nothing to retry.' }));

app.delete('/api/uploads/:id', adminOnly, needsUploader, (req, res) =>
  uploader.remove(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found.' }));

// Remove a title from this profile's Continue Watching row.
app.post('/api/continue/hide', (req, res) => {
  const { itemId } = req.body || {};
  if (!index.byId.has(itemId)) return res.status(404).json({ error: 'Title not found' });
  req.history.hidden[itemId] = Date.now();
  accounts.saveHistory();
  res.json({ ok: true });
});

// Only files that are part of the scanned library can be fetched.
const allowed = (req, res, next) =>
  index.allowed.has(req.params.id) ? next() : res.status(404).json({ error: 'Not in library' });

app.get('/api/library', (req, res) => {
  res.json({
    categories: CATEGORIES.map(({ name, slug, type }) => ({ name, slug, type })),
    items: library.data.items.map(summary),
    continue: continueWatching(req.history),
    status: {
      scanning: !!scanning, scannedAt: library.data.scannedAt, error: lastScanError, tmdb: !!tmdb, ffmpeg: hasFfmpeg,
      storage: storage.name, uploads: !!uploader,
      analysing: segments?.status() || null,
    },
  });
});

app.post('/api/rescan', async (req, res) => {
  rescan();
  res.json({ ok: true });
});

app.get('/api/title/:id', async (req, res, next) => {
  try {
    const item = index.byId.get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Title not found' });
    const out = summary(item);
    if (item.kind === 'movie') {
      const p = progressOf(req.history, item.versions);
      out.versions = item.versions.map(({ id, height, size }) => ({ id, height, size }));
      out.subs = item.subs;
      out.resume = { fileId: p?.fileId || item.versions[0].id, t: p && !p.done ? p.t : 0, d: p?.d || null };
    } else {
      out.seasons = await Promise.all(
        item.seasons.map(async (s) => {
          const tm = await seasonMeta(item, s.season);
          return {
            season: s.season,
            name: s.season === 0 ? 'Specials' : `Season ${s.season}`,
            episodes: s.episodes.map((e) => {
              const p = progressOf(req.history, e.versions);
              const m = tm[e.episode] || {};
              return {
                season: e.season,
                episode: e.episode,
                fileId: e.versions[0].id,
                name: m.name || `Episode ${e.episode}`,
                overview: m.overview || '',
                still: m.still || null,
                runtimeMin: m.runtime || (e.versions[0].durationMs ? Math.round(e.versions[0].durationMs / 60000) : null),
                quality: maxHeight(e.versions),
                hasSubs: e.subs.length > 0,
                progress: p ? (p.done ? 1 : p.d ? p.t / p.d : 0) : 0,
              };
            }),
          };
        }),
      );
      // "Resume" / "Play" target: where you left off, else the first episode.
      const eps = item.seasons.flatMap((s) => s.episodes);
      let best = null;
      eps.forEach((e, i) => {
        const p = progressOf(req.history, e.versions);
        if (p && (!best || p.at > best.p.at)) best = { e, i, p };
      });
      let target = eps.find((e) => e.season > 0) || eps[0];
      let t = 0;
      if (best && !best.p.done) ({ e: target } = best), (t = best.p.t);
      else if (best) target = nextEpisode({ ep: best.e, eps, index: best.i }) || target;
      out.resume = { fileId: target.versions[0].id, t, label: epLabel(target) };
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get('/api/play/:id', allowed, async (req, res, next) => {
  try {
    const loc = index.files.get(req.params.id);
    if (!loc) return res.status(404).json({ error: 'Not a video in the library' });
    const file = loc.versions.find((v) => v.id === req.params.id);
    if (!file.durationMs) {
      file.durationMs = await probeDuration(file.id);
      if (file.durationMs) library.save();
    }
    const p = progressOf(req.history, loc.versions);
    const nx = nextEpisode(loc);
    let episodeName = null, nextName = null;
    if (loc.ep) {
      episodeName = (await seasonMeta(loc.item, loc.ep.season))[loc.ep.episode]?.name || null;
      if (nx) nextName = (await seasonMeta(loc.item, nx.season))[nx.episode]?.name || null;
    }
    res.json({
      fileId: file.id,
      item: summary(loc.item),
      episodeLabel: epLabel(loc.ep),
      episodeName,
      durationMs: file.durationMs,
      versions: loc.versions.map(({ id, height, size, name }) => ({ id, height, size, ext: path.extname(name).slice(1).toLowerCase() })),
      subs: loc.subs,
      resumeAt: p && !p.done && p.d && p.t < p.d - 30 ? p.t : 0,
      next: nx ? { fileId: nx.versions[0].id, label: epLabel(nx), name: nextName } : null,
      transcodeHeights: hasFfmpeg ? [1080, 720, 480, 360] : [],
      // { intro: {start, end} | null, credits: {start} | null }, in seconds; null if not analysed yet
      segments: segmentsFor(loc),
    });
  } catch (e) {
    next(e);
  }
});

// A self-contained link to one video (plus subtitles) for casting apps.
app.get('/api/cast/:id', allowed, (req, res) => {
  const loc = index.files.get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Not a video in the library' });
  const file = loc.versions.find((v) => v.id === req.params.id);
  const m = loc.item.meta || {};
  const ep = loc.ep ? ` S${loc.ep.season}:E${loc.ep.episode}` : '';
  res.json({
    url: signedMediaUrl(req, 'stream', file.id),
    title: `${m.title || loc.item.title}${ep}`,
    mimeType: file.mimeType?.startsWith('video/') ? file.mimeType : 'video/*',
    poster: m.poster ? `https://image.tmdb.org/t/p/w500${m.poster}` : null,
    subtitles: loc.subs.map((s) => ({ label: s.label, url: signedMediaUrl(req, 'subs', s.id) })),
    expiresInHours: CAST_HOURS,
  });
});

// TV players (Samsung/Tizen) fetch video with the TV's own media player, which doesn't
// send the sign-in cookie, so they ask for signed addresses instead (same scheme as Cast).
app.get('/api/media-sig/:id', allowed, (req, res) => {
  const exp = Math.floor(Date.now() / 1000) + CAST_HOURS * 3600;
  const id = req.params.id;
  res.json({ exp, stream: castSig('stream', id, exp), transcode: castSig('transcode', id, exp) });
});

// Players poll this when an episode is still waiting for intro/credits detection.
app.get('/api/segments/:id', allowed, (req, res) => {
  const loc = index.files.get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Not a video in the library' });
  res.json({ segments: segmentsFor(loc) });
});

app.post('/api/progress', (req, res) => {
  const { fileId, t, d, done } = req.body || {};
  if (!index.files.has(fileId) || !Number.isFinite(t)) return res.status(400).json({ error: 'Bad progress' });
  const files = req.history.files;
  files[fileId] = {
    t: Math.max(0, t),
    d: Number.isFinite(d) ? d : files[fileId]?.d || 0,
    done: !!done || (Number.isFinite(d) && d > 0 && t / d > 0.95),
    at: Date.now(),
  };
  accounts.saveHistory();
  res.json({ ok: true });
});

// Byte-range streaming: the browser asks for a range, we ask the storage for the
// same range and pipe it straight through. That's what makes seeking instant.
app.get('/stream/:id', allowed, async (req, res) => {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const upstream = await storage.open(req.params.id, { range: req.headers.range, signal: ac.signal });
    res.status(upstream.status);
    for (const [h, v] of Object.entries(upstream.headers)) res.set(h, v);
    res.set('Accept-Ranges', 'bytes');
    if (!upstream.body) return void res.end();
    res.set('Cache-Control', 'private, max-age=3600');
    await pipeline(upstream.body, res, { signal: ac.signal });
  } catch (e) {
    if (e.name === 'AbortError' || e.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // viewer seeked or left
    if (e.status && !res.headersSent) return void res.status(e.status).send(e.message);
    console.error('stream error', e.message);
    if (!res.headersSent) res.status(502).send('Stream failed');
    else res.destroy();
  }
});

// Live conversion to a lower resolution (or to a browser-friendly codec).
// ?h=720 picks the height, ?t=seconds starts mid-file (each seek starts a new conversion).
const BITRATES = { 1080: '5000k', 720: '2800k', 480: '1400k', 360: '800k' };
// Conversions are CPU-heavy, so they run at the lowest priority (other sites on
// the machine always win) and only MAX_TRANSCODES run at once. When the cap is
// hit the oldest one is stopped: usually that's the same viewer's previous
// stream, still closing after a seek or a quality switch.
const MAX_TRANSCODES = Math.max(1, Number(process.env.MAX_TRANSCODES) || Math.floor(cpus().length / 2));
const transcodes = [];
app.get('/transcode/:id', allowed, async (req, res) => {
  if (!hasFfmpeg) return res.status(501).send('ffmpeg is not installed');
  const h = BITRATES[req.query.h] ? Number(req.query.h) : 720;
  const t = Math.max(0, Number(req.query.t) || 0);
  const rate = BITRATES[h];
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(t),
    ...localStream(req.params.id),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale=-2:'trunc(min(${h},ih)/2)*2'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-maxrate', rate, '-bufsize', `${parseInt(rate) * 2}k`, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-sn', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
  while (transcodes.length >= MAX_TRANSCODES) transcodes.shift().kill('SIGKILL');
  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  transcodes.push(ff);
  try {
    setPriority(ff.pid, 19);
  } catch {}
  let errText = '';
  ff.stderr.on('data', (d) => (errText = (errText + d).slice(-2000)));
  res.set({ 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
  ff.stdout.pipe(res);
  res.on('close', () => ff.kill('SIGKILL'));
  ff.on('close', (code) => {
    const i = transcodes.indexOf(ff);
    if (i >= 0) transcodes.splice(i, 1);
    if (code && !res.writableEnded && errText) console.error('ffmpeg:', errText.trim().split('\n').at(-1));
    res.end();
  });
});

// Local storage has no ready-made thumbnails, so grab a frame from the video with
// ffmpeg (10% in, past most cold opens) and keep it in data/thumbs.
const THUMBS = path.join(DATA, 'thumbs');
const frameJobs = new Map(); // file -> Promise<boolean>
const frameQueue = [];
let framesRunning = 0;

function grabFrame(id, width, file) {
  if (frameJobs.has(file)) return frameJobs.get(file);
  const job = (async () => {
    while (framesRunning >= 2) await new Promise((r) => frameQueue.push(r));
    framesRunning++;
    try {
      mkdirSync(THUMBS, { recursive: true });
      const durMs = index.files.get(id)?.versions.find((v) => v.id === id)?.durationMs || (await probeDuration(id));
      for (const at of durMs ? [durMs / 10000, 0] : [30, 0]) {
        const tmp = `${file}.tmp.jpg`;
        const ok = await new Promise((resolve) => {
          const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), ...localStream(id),
            '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-y', tmp], { stdio: 'ignore' });
          try {
            setPriority(ff.pid, 19);
          } catch {}
          const timer = setTimeout(() => ff.kill('SIGKILL'), 30000);
          ff.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0 && existsSync(tmp) && statSync(tmp).size > 0);
          });
          ff.on('error', () => resolve(false));
        });
        if (ok) {
          renameSync(tmp, file);
          return true;
        }
      }
      return false;
    } finally {
      framesRunning--;
      frameQueue.shift()?.();
      frameJobs.delete(file);
    }
  })();
  frameJobs.set(file, job);
  return job;
}

app.get('/thumb/:id', allowed, async (req, res) => {
  try {
    const size = Math.min(Number(req.query.s) || 480, 1600);
    const thumb = await storage.thumbnail(req.params.id, size);
    if (!thumb && (storage.name !== 'local' || !hasFfmpeg || !index.files.has(req.params.id))) return res.status(404).end();
    let body, type;
    if (thumb) {
      ({ body, contentType: type } = thumb);
    } else {
      const width = size > 500 ? 1280 : 480;
      const file = path.join(THUMBS, `${req.params.id.slice(0, 180)}-${width}.jpg`);
      if (!existsSync(file) && !(await grabFrame(req.params.id, width, file))) return res.status(404).end();
      body = createReadStream(file);
      type = 'image/jpeg';
    }
    res.set('Content-Type', type);
    res.set('Cache-Control', 'private, max-age=86400');
    await pipeline(body, res);
  } catch {
    if (!res.headersSent) res.status(404).end();
  }
});

// Subtitles: .srt is converted to WebVTT.
app.get('/subs/:id', allowed, async (req, res, next) => {
  try {
    let buf;
    try {
      buf = await storage.readFile(req.params.id);
    } catch (e) {
      if (e.status) return res.status(e.status).end();
      throw e;
    }
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1256').decode(buf); // common for Arabic .srt
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!text.startsWith('WEBVTT')) text = 'WEBVTT\n\n' + text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    text = fixRtlVtt(text); // put Arabic/Hebrew punctuation back where it belongs
    res.type('text/vtt; charset=utf-8').send(text);
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  console.log(`\nDriveStream is running`);
  console.log(`  This computer:   http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const url of lan) console.log(`  On your network: ${url}`);
  console.log(`\n  Storage: ${storage.label}`);
  console.log(`  Categories: ${CATEGORIES.map((c) => `${c.name} (${c.type})`).join(', ')}`);
  console.log(`  TMDB metadata: ${tmdb ? 'on' : 'off (set TMDB_API_KEY)'}`);
  console.log(`  Resolution switching / conversion: ${hasFfmpeg ? 'on' : 'off (install ffmpeg)'}`);
  const noCredit = checkCredit(__dirname);
  if (noCredit.length) {
    console.warn(`\n  WARNING: the "Developed by" credit was removed from: ${noCredit.join(', ')}.`);
    console.warn('  Keeping it visible is a condition of the DriveStream license (LICENSE §3, NOTICE).');
  }
  if (bootstrap) {
    console.log(`\n  Created the admin profile. Sign in with username "${bootstrap.username}" and ` +
      (bootstrap.generatedPassword ? `password: ${bootstrap.generatedPassword}` : 'your APP_PASSWORD.'));
    console.log('  Add more profiles under your profile menu → Manage profiles.');
  }
  console.log('');
  const stale = Date.now() - library.data.scannedAt > RESCAN_MINUTES * 60_000;
  if (stale) rescan();
  else detectSegments().catch((e) => console.error('Intro detection:', e.message));
  setInterval(rescan, RESCAN_MINUTES * 60_000).unref();
  uploader?.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    accounts.flush();
    library.flush();
    uploader?.flush();
    process.exit(0);
  });
}
