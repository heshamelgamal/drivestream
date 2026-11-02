// Upload queue: download a link on this server, then upload it into the right
// Google Drive folder as the signed-in Google user, one job at a time.
//
// The service account that reads the library has no Drive storage of its own,
// so uploads use the owner's Google account (a one-time "Connect Google Drive").
// Files land inside the shared library folders, so the service account sees them.

import { OAuth2Client } from 'google-auth-library';
import { createWriteStream, existsSync, mkdirSync, statSync, statfsSync, unlinkSync, createReadStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { jsonStore } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const UPLOAD_CHUNK = 32 * 1024 * 1024; // must be a multiple of 256 KB
const FOLDER = 'application/vnd.google-apps.folder';

// ---------- link safety ----------
// The server fetches whatever URL it's given, so never let that reach this machine
// or the local network (e.g. http://127.0.0.1:8090 or the cloud metadata address).
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(raw, allowPrivate = false) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Not a valid link');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https links are supported');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!allowPrivate && addrs.some((a) => isPrivate(a.address))) throw new Error('Links to private or local addresses are not allowed');
  return u;
}

// Follow redirects ourselves so every hop is checked.
async function safeFetch(url, init = {}, allowPrivate = false, hops = 0) {
  if (hops > 10) throw new Error('Too many redirects');
  await assertPublicUrl(url, allowPrivate);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
    res.body?.cancel().catch(() => {});
    return safeFetch(new URL(res.headers.get('location'), url).toString(), init, allowPrivate, hops + 1);
  }
  return res;
}

function filenameFrom(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  let name = '';
  let m = cd.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
  if (m) name = decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
  else if ((m = cd.match(/filename\s*=\s*"?([^";]+)"?/i))) name = m[1].trim();
  if (!name) {
    try {
      name = decodeURIComponent(path.posix.basename(new URL(url).pathname));
    } catch {}
  }
  return name.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'download';
}

export function createUploader({ dataDir, publicUrl, categories, onUploaded, log = console.log, driveApi = 'https://www.googleapis.com', oauthBase = null, allowPrivate = false }) {
  const settings = jsonStore(path.join(dataDir, 'google-oauth.json'), {}); // { clientId, clientSecret, refreshToken, email }
  const jobs = jsonStore(path.join(dataDir, 'uploads.json'), { jobs: [] });
  const incoming = path.join(dataDir, 'incoming');
  mkdirSync(incoming, { recursive: true });
  const pendingStates = new Map(); // OAuth state -> expiry
  let active = null; // { job, controller }

  // Jobs interrupted by a restart start over.
  for (const j of jobs.data.jobs) if (['downloading', 'uploading'].includes(j.status)) Object.assign(j, { status: 'queued', note: 'Restarted' });

  const redirectUri = () => `${publicUrl}/api/google/callback`;
  const client = () => {
    const endpoints = oauthBase ? { oauth2AuthBaseUrl: `${oauthBase}/auth`, oauth2TokenUrl: `${oauthBase}/token`, tokenInfoUrl: `${oauthBase}/tokeninfo` } : undefined;
    const c = new OAuth2Client({ clientId: settings.data.clientId, clientSecret: settings.data.clientSecret, redirectUri: redirectUri(), endpoints });
    if (settings.data.refreshToken) c.setCredentials({ refresh_token: settings.data.refreshToken });
    return c;
  };
  const token = async () => (await client().getAccessToken()).token;

  async function driveJson(pathAndQuery, init = {}) {
    const res = await fetch(`${driveApi}${pathAndQuery}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) throw await driveError(res);
    return res.json();
  }

  async function driveError(res) {
    const text = await res.text();
    if (res.status === 403 && /insufficient.*scope/i.test(text)) {
      // A connection without Drive access is useless: drop it so the dashboard asks to connect again.
      settings.data = { clientId: settings.data.clientId, clientSecret: settings.data.clientSecret };
      settings.flush();
      return new Error('Google Drive permission was missing. Connect Google Drive again and tick the Google Drive box, then press Retry.');
    }
    return new Error(`Google Drive ${res.status}: ${text.slice(0, 200)}`);
  }

  const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findInFolder(parentId, name, mimeType) {
    const query = `'${parentId}' in parents and name = '${q(name)}' and trashed = false` + (mimeType ? ` and mimeType = '${mimeType}'` : '');
    const r = await driveJson(`/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id,name,size)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`);
    return r.files[0] || null;
  }

  async function ensureFolder(parentId, name) {
    const found = await findInFolder(parentId, name, FOLDER);
    if (found) return found.id;
    const made = await driveJson('/drive/v3/files?supportsAllDrives=true', {
      method: 'POST',
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return made.id;
  }

  async function uploadFile(file, size, name, parentId, job, signal) {
    const start = await fetch(`${driveApi}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
      signal,
    });
    if (!start.ok) throw await driveError(start);
    const session = start.headers.get('location');
    let offset = 0;
    while (offset < size) {
      const end = Math.min(offset + UPLOAD_CHUNK, size) - 1;
      let res;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await fetch(session, {
            method: 'PUT',
            headers: { 'Content-Length': String(end - offset + 1), 'Content-Range': `bytes ${offset}-${end}/${size}` },
            body: Readable.toWeb(createReadStream(file, { start: offset, end })),
            duplex: 'half',
            signal,
          });
          if (res.status >= 500) throw new Error(`Google Drive ${res.status}`);
          break;
        } catch (e) {
          if (signal.aborted || attempt >= 5) throw e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          // Ask Drive how much it has, then carry on from there.
          const probe = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
          const range = probe.headers.get('range');
          if (probe.status === 200 || probe.status === 201) return;
          offset = range ? Number(range.split('-')[1]) + 1 : 0;
        }
      }
      if (res.status === 200 || res.status === 201) {
        job.uploaded = size;
        return;
      }
      if (res.status !== 308) throw await driveError(res);
      const range = res.headers.get('range');
      offset = range ? Number(range.split('-')[1]) + 1 : 0;
      job.uploaded = offset;
    }
  }

  async function download(job, signal, alreadyThere) {
    let res;
    for (let attempt = 1; !res; attempt++) {
      try {
        res = await safeFetch(job.url, { signal, headers: { 'User-Agent': 'Mozilla/5.0 (DriveStream uploader)' } }, allowPrivate);
      } catch (e) {
        if (signal.aborted || attempt >= 4 || /not allowed|not supported|valid link/.test(e.message)) throw e;
        log(`Upload queue: retrying ${job.url}: ${e.cause?.message || e.message}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (!res.ok) throw new Error(`The link answered ${res.status}`);
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.startsWith('text/html') || ctype.startsWith('application/xhtml')) {
      res.body?.cancel().catch(() => {});
      const e = new Error('The link opens a web page, not a file');
      e.skip = true;
      throw e;
    }
    job.name = filenameFrom(res, res.url || job.url);
    job.size = Number(res.headers.get('content-length')) || null;
    const finalUrl = res.url || job.url;
    if (await alreadyThere()) {
      res.body?.cancel().catch(() => {});
      throw Object.assign(new Error('Already in Drive'), { skip: true });
    }

    const { bavail, bsize } = statfsSync(incoming);
    if (job.size && job.size > bavail * bsize - 2 * 1024 ** 3) throw new Error('Not enough free disk space on the server');

    const file = path.join(incoming, `${job.id}.part`);
    for (let attempt = 1; ; attempt++) {
      try {
        let have = existsSync(file) ? statSync(file).size : 0;
        if (attempt > 1 || have) {
          res.body?.cancel().catch(() => {});
          res = await safeFetch(finalUrl, { signal, headers: have ? { Range: `bytes=${have}-` } : {} }, allowPrivate);
          if (have && res.status !== 206) have = 0;
          if (!res.ok) throw new Error(`The link answered ${res.status}`);
        }
        job.downloaded = have;
        const counter = new TransformStream({
          transform(chunk, ctl) {
            job.downloaded += chunk.byteLength;
            ctl.enqueue(chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), createWriteStream(file, { flags: have ? 'a' : 'w' }));
        const got = statSync(file).size;
        if (job.size && got < job.size) throw new Error(`Download incomplete (${got} of ${job.size} bytes)`);
        job.size = got;
        return file;
      } catch (e) {
        if (signal.aborted || e.skip || attempt >= 4) throw e;
        log(`Upload queue: retrying download of ${job.name}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }

  async function runJob(job) {
    const controller = new AbortController();
    active = { job, controller };
    const cat = categories.find((c) => c.slug === job.category);
    let file;
    try {
      if (!cat) throw new Error('Unknown category');
      job.status = 'downloading';
      job.startedAt = Date.now();
      jobs.save();
      // The show folder is made (if needed) once the link proves to be a file.
      let parent;
      const alreadyThere = async () => {
        parent = job.show ? await ensureFolder(cat.folderId, job.show) : cat.folderId;
        const existing = await findInFolder(parent, job.name);
        return !!existing && !!job.size && Number(existing.size) === job.size;
      };
      file = await download(job, controller.signal, alreadyThere);

      job.status = 'uploading';
      job.uploaded = 0;
      jobs.save();
      if (await alreadyThere()) {
        Object.assign(job, { status: 'skipped', note: 'Already in Drive' });
      } else {
        await uploadFile(file, job.size, job.name, parent, job, controller.signal);
        Object.assign(job, { status: 'done', note: null });
        onUploaded?.();
      }
    } catch (e) {
      if (controller.signal.aborted) Object.assign(job, { status: 'cancelled', note: null });
      else Object.assign(job, { status: e.skip ? 'skipped' : 'failed', note: e.message.slice(0, 200) });
      log(`Upload queue: ${job.status} ${job.name || job.url}: ${job.note || ''}`);
    } finally {
      job.finishedAt = Date.now();
      if (file && existsSync(file)) unlinkSync(file);
      const leftover = path.join(incoming, `${job.id}.part`);
      if (existsSync(leftover)) unlinkSync(leftover);
      active = null;
      jobs.save();
    }
  }

  async function pump() {
    if (active || !settings.data.refreshToken) return;
    const next = jobs.data.jobs.find((j) => j.status === 'queued');
    if (!next) return;
    await runJob(next);
    setImmediate(pump);
  }

  const publicJob = (j) => ({
    id: j.id, url: j.url, category: j.category, show: j.show || null, status: j.status, note: j.note || null,
    name: j.name || null, size: j.size || null, downloaded: j.downloaded || 0, uploaded: j.uploaded || 0,
    createdAt: j.createdAt, finishedAt: j.finishedAt || null,
  });

  return {
    status() {
      const s = settings.data;
      return { configured: !!(s.clientId && s.clientSecret), connected: !!s.refreshToken, email: s.email || null, redirectUri: redirectUri() };
    },
    saveClient({ clientId, clientSecret }) {
      if (!clientId?.endsWith('.apps.googleusercontent.com') || !clientSecret) throw Object.assign(new Error('That doesn’t look like a Google OAuth client ID and secret.'), { status: 400 });
      settings.data = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
      settings.flush();
    },
    authUrl() {
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, Date.now() + 10 * 60_000);
      return client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [SCOPE, 'email'], state });
    },
    async finishAuth(code, state) {
      const exp = pendingStates.get(state);
      pendingStates.delete(state);
      if (!exp || exp < Date.now()) throw new Error('This sign-in link expired. Start again from the dashboard.');
      const c = client();
      const { tokens } = await c.getToken(code);
      if (tokens.scope && !tokens.scope.split(' ').includes(SCOPE)) {
        throw new Error('Google Drive access wasn’t granted. Connect again and tick “See, edit, create and delete all of your Google Drive files”.');
      }
      if (!tokens.refresh_token) throw new Error('Google didn’t return a long-term token. Remove DriveStream from your Google account’s third-party access and connect again.');
      let email = null;
      try {
        const info = await c.getTokenInfo(tokens.access_token);
        email = info.email || null;
      } catch {}
      settings.data = { ...settings.data, refreshToken: tokens.refresh_token, email };
      settings.flush();
      pump();
    },
    disconnect() {
      settings.data = { clientId: settings.data.clientId, clientSecret: settings.data.clientSecret };
      settings.flush();
    },
    async add(items, userId) {
      const added = [];
      for (const it of items) {
        const url = String(it.url || '').trim();
        if (!url) continue;
        await assertPublicUrl(url, allowPrivate).catch((e) => { throw Object.assign(e, { status: 400 }); });
        if (!categories.some((c) => c.slug === it.category)) throw Object.assign(new Error(`Unknown category: ${it.category}`), { status: 400 });
        const show = String(it.show || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || null;
        const job = { id: randomUUID(), url, category: it.category, show, status: 'queued', createdAt: Date.now(), by: userId };
        jobs.data.jobs.push(job);
        added.push(publicJob(job));
      }
      jobs.data.jobs = jobs.data.jobs.slice(-200); // keep the history short
      jobs.save();
      setImmediate(pump);
      return added;
    },
    list: () => jobs.data.jobs.slice().reverse().map(publicJob),
    remove(id) {
      const j = jobs.data.jobs.find((x) => x.id === id);
      if (!j) return false;
      if (active?.job === j) active.controller.abort();
      else if (j.status === 'queued') j.status = 'cancelled';
      else jobs.data.jobs = jobs.data.jobs.filter((x) => x !== j); // finished: clear it from the list
      jobs.save();
      return true;
    },
    retry(id) {
      const j = jobs.data.jobs.find((x) => x.id === id);
      if (!j || !['failed', 'cancelled'].includes(j.status)) return false;
      Object.assign(j, { status: 'queued', note: null, downloaded: 0, uploaded: 0 });
      jobs.save();
      setImmediate(pump);
      return true;
    },
    start: () => pump(),
    flush: () => jobs.flush(),
  };
}
