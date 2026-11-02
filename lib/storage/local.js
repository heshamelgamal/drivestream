// Local folder storage: the library is a directory on this server's disk.
//
//   LOCAL_MEDIA_DIR=/srv/media
//     Movies/…          each sub-folder is a category (or list them in CATEGORIES)
//     TV Series/…
//
// A file's id is its path inside LOCAL_MEDIA_DIR, base64url-encoded with an "L" in
// front, so ids survive restarts without a database. Only ids the library scan
// produced are ever served (server.js checks), and every id is checked again here
// so it can't point outside LOCAL_MEDIA_DIR.

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { FOLDER } from './index.js';

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.srt': 'application/x-subrip', '.vtt': 'text/vtt',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// Category type from a folder name, for when CATEGORIES isn't set.
const guessType = (name) => (/\b(tv|series|shows?)\b/i.test(name) ? 'tv' : /\b(movies?|films?)\b/i.test(name) ? 'movie' : 'auto');

export function createLocalStorage(env) {
  const root = path.resolve(env.LOCAL_MEDIA_DIR || './media');
  const problems = [];
  if (!env.LOCAL_MEDIA_DIR) problems.push('LOCAL_MEDIA_DIR is not set in .env');
  else if (!existsSync(root) || !statSync(root).isDirectory()) problems.push(`LOCAL_MEDIA_DIR not found: ${root}`);

  const idOf = (rel) => 'L' + Buffer.from(rel.split(path.sep).join('/'), 'utf8').toString('base64url');

  function pathOf(id) {
    if (typeof id !== 'string' || !/^L[\w-]*$/.test(id)) throw Object.assign(new Error('Bad id'), { status: 404 });
    const rel = Buffer.from(id.slice(1), 'base64url').toString('utf8');
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) throw Object.assign(new Error('Bad id'), { status: 404 });
    return full;
  }

  async function entry(dir, name) {
    const full = path.join(dir, name);
    const st = await stat(full).catch(() => null); // follows symlinks; broken ones are skipped
    if (!st || (!st.isDirectory() && !st.isFile())) return null;
    // "Added" = when the file arrived here: copies keep an old mtime but get a new birth time.
    const added = new Date(Math.max(st.birthtimeMs || 0, st.mtimeMs)).toISOString();
    return {
      id: idOf(path.relative(root, full)),
      name,
      mimeType: st.isDirectory() ? FOLDER : mimeOf(name),
      size: st.isDirectory() ? 0 : st.size,
      createdTime: added,
      modifiedTime: new Date(st.mtimeMs).toISOString(),
    };
  }

  return {
    name: 'local',
    label: `local folder ${root}`,
    supportsUploads: false,
    problems,

    // A sub-folder of LOCAL_MEDIA_DIR ("Movies", "Media/Films"), or "." for the folder itself.
    resolveRef: (ref) => {
      if (!ref) return null;
      const full = path.resolve(root, ref);
      if (full !== root && !full.startsWith(root + path.sep)) return null;
      return idOf(path.relative(root, full));
    },

    defaultCategories() {
      if (problems.length) return [];
      return readdirNames(root)
        .filter((n) => statSync(path.join(root, n)).isDirectory())
        .map((n) => ({ name: n, type: guessType(n), ref: n }));
    },

    async listFolder(id) {
      const dir = pathOf(id);
      const names = (await readdir(dir)).filter((n) => !n.startsWith('.'));
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      const out = (await Promise.all(names.map((n) => entry(dir, n)))).filter(Boolean);
      // Folders first, like Drive's orderBy=folder,name_natural.
      return [...out.filter((f) => f.mimeType === FOLDER), ...out.filter((f) => f.mimeType !== FOLDER)];
    },

    async open(id, { range } = {}) {
      const file = pathOf(id);
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) throw Object.assign(new Error('Not found'), { status: 404 });
      const size = st.size;
      const headers = {
        'content-type': mimeOf(file),
        'last-modified': st.mtime.toUTCString(),
        etag: `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      };
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] || m[2])) {
        let start, end;
        if (m[1]) {
          start = Number(m[1]);
          end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        } else {
          start = Math.max(0, size - Number(m[2])); // "bytes=-500": the last 500 bytes
          end = size - 1;
        }
        if (start >= size || start > end) {
          return { status: 416, headers: { 'content-range': `bytes */${size}` }, body: null };
        }
        headers['content-range'] = `bytes ${start}-${end}/${size}`;
        headers['content-length'] = String(end - start + 1);
        return { status: 206, headers, body: createReadStream(file, { start, end }) };
      }
      headers['content-length'] = String(size);
      return { status: 200, headers, body: createReadStream(file) };
    },

    readFile: async (id) => readFile(pathOf(id)),

    // Posters/cover images are served as they are; videos get a frame grabbed by
    // server.js (with ffmpeg), so return null for them.
    async thumbnail(id) {
      const file = pathOf(id);
      const type = mimeOf(file);
      if (!type.startsWith('image/')) return null;
      return { contentType: type, body: createReadStream(file) };
    },
  };
}

function readdirNames(dir) {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
