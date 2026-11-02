// Google Drive storage: the library folders are shared with a service account,
// which reads them (read-only scope). See README → "Google Drive".

import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { initDrive, drive, getFile, listFolder, mediaUrl, token } from './drive-api.js';

const REL_HEADERS = ['content-type', 'content-length', 'content-range', 'etag', 'last-modified'];

export function createDriveStorage(env) {
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
  const problems = existsSync(keyFile) ? [] : [`Service-account key not found at ${keyFile}`];
  if (!problems.length) initDrive(keyFile);

  const thumbLinks = new Map(); // id -> { link, at }; Drive thumbnail links expire after a few hours

  return {
    name: 'drive',
    label: 'Google Drive',
    supportsUploads: true,
    problems,

    // "<folder id>", "https://drive.google.com/drive/folders/<id>" or "…?id=<id>"
    resolveRef: (ref) => ref?.match(/folders\/([\w-]+)/)?.[1] || ref?.match(/[?&]id=([\w-]+)/)?.[1] || ref,
    defaultCategories: () => [],

    listFolder,

    // Byte-range proxy: ask Drive for the same range the viewer asked for.
    async open(id, { range, signal } = {}) {
      const headers = range ? { Range: range } : {};
      const upstream = await drive(mediaUrl(id), { headers, signal });
      if (!upstream.ok) {
        const err = new Error(await upstream.text());
        err.status = upstream.status;
        throw err;
      }
      const out = {};
      for (const h of REL_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) out[h] = v;
      }
      return { status: upstream.status, headers: out, body: Readable.fromWeb(upstream.body) };
    },

    async readFile(id) {
      const upstream = await drive(mediaUrl(id));
      if (!upstream.ok) {
        const err = new Error(`Drive ${upstream.status}`);
        err.status = upstream.status;
        throw err;
      }
      return Buffer.from(await upstream.arrayBuffer());
    },

    async thumbnail(id, size) {
      let hit = thumbLinks.get(id);
      if (!hit || Date.now() - hit.at > 3600_000) {
        hit = { link: (await getFile(id)).thumbnailLink, at: Date.now() };
        thumbLinks.set(id, hit);
      }
      if (!hit.link) return null;
      const upstream = await fetch(hit.link.replace(/=s\d+$/, `=s${size}`), {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (!upstream.ok) {
        thumbLinks.delete(id);
        return null;
      }
      return { contentType: upstream.headers.get('content-type') || 'image/jpeg', body: Readable.fromWeb(upstream.body) };
    },
  };
}
