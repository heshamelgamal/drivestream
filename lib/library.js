// Turns the storage folders (Google Drive or a local folder) into a library of movies and shows.
//
// Recognised layouts (all optional, mix freely):
//   Movies/Inception (2010).mkv                     loose movie file
//   Movies/Inception (2010)/Inception.1080p.mkv     movie folder; extra video files = other qualities
//   Movies/Inception (2010)/Inception.720p.mp4
//   Movies/Inception (2010)/Inception.en.srt        subtitles (also in a "Subs" sub-folder)
//   Movies/Nolan Collection/<movie folders>         collections are flattened
//   TV Series/Dark/Season 1/Dark.S01E01.mkv         season folders
//   TV Series/Dark/Dark.S01E01.mkv                  or SxxEyy names directly in the show folder
//   Animation/...                                   either of the above; detected per folder
// Add {tmdb-12345} to a folder or file name to force a TMDB match.

import { FOLDER } from './storage/index.js';
import { mapLimit } from './store.js';

const VIDEO_EXT = /\.(mkv|mp4|m4v|webm|mov|avi|ts|m2ts|wmv|mpg|mpeg)$/i;
const SUB_EXT = /\.(srt|vtt)$/i;
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const KNOWN_EXT = /\.(mkv|mp4|m4v|webm|mov|avi|ts|m2ts|wmv|mpg|mpeg|srt|vtt|jpe?g|png|webp)$/i;
const EPISODE_RE = /S(\d{1,2})[ ._-]?E(\d{1,3})|\b(\d{1,2})x(\d{2,3})\b/i;
const JUNK_RE =
  /[\s([]*\b(2160p|1080p|720p|576p|480p|4k|uhd|web[- ]?dl|web[- ]?rip|webrip|bluray|blu[- ]ray|brrip|bdrip|dvdrip|hdrip|hdtv|remux|x26[45]|h[ .]?26[45]|hevc|avc|aac\d?|ac3|dts|ddp?\d?|atmos|10bit|hdr10?|proper|repack|extended|unrated|imax|multi|dual[- ]audio|egydead|[a-z0-9-]+[ .](?:com|net|org|co|tv))\b.*$/i;
const EXTRA_RE = /\b(sample|trailer|featurette|behind the scenes|deleted scenes?)\b/i;

const isFolder = (f) => f.mimeType === FOLDER;
const isVideo = (f) => !isFolder(f) && (VIDEO_EXT.test(f.name) || f.mimeType.startsWith('video/'));
const isSub = (f) => SUB_EXT.test(f.name);
const isImage = (f) => !isFolder(f) && (IMG_EXT.test(f.name) || f.mimeType.startsWith('image/'));
export const stripExt = (name) => name.replace(KNOWN_EXT, '');

export function parseTitle(raw) {
  let s = stripExt(raw);
  const tmdbId = s.match(/[[{(]tmdb(?:id)?[-=: ](\d+)[\]})]/i)?.[1] || null;
  s = s.replace(/[[{(]tmdb(?:id)?[-=: ]\d+[\]})]/gi, ' ');
  // Scene-style "The.Matrix.1999.1080p [720p]": more dots than spaces means dots are separators.
  const dots = (s.match(/\./g) || []).length;
  if (dots >= 2 && dots > (s.match(/ /g) || []).length) s = s.replace(/[._]+/g, ' ');
  s = s.replace(/_/g, ' ');
  s = s.replace(new RegExp(EPISODE_RE.source + '.*$', 'i'), '');

  let year = null;
  const years = [...s.matchAll(/(?:^|[\s.([])((?:19|20)\d{2})(?=$|[\s.)\]])/g)].filter((m) => m.index > 0);
  if (years.length) {
    const m = years.at(-1);
    year = Number(m[1]);
    s = s.slice(0, m.index);
  }
  s = s.replace(JUNK_RE, '').replace(/[[(][^\])]*$/, '');
  s = s.replace(/[\s\-–:._[(]+$/, '').replace(/\s{2,}/g, ' ').trim();
  return { title: s || stripExt(raw), year, tmdbId };
}

export function parseEpisode(name) {
  const s = stripExt(name);
  let m = s.match(EPISODE_RE);
  if (m) return { season: Number(m[1] ?? m[3]), episode: Number(m[2] ?? m[4]) };
  m = s.replace(JUNK_RE, '').match(/\b(?:E|EP|Episode)[ ._-]?(\d{1,3})\b|\s-\s(\d{1,3})(?:\s|$)/i);
  return m ? { season: null, episode: Number(m[1] ?? m[2]) } : null;
}

function seasonFromFolder(name) {
  if (/^specials?$/i.test(name.trim())) return 0;
  const m = name.match(/\b(?:season|series|saison|temporada|staffel)[ ._-]*(\d{1,2})\b|^s(\d{1,2})$/i);
  return m ? Number(m[1] ?? m[2]) : null;
}

function heightOf(f) {
  const h = Number(f.videoMediaMetadata?.height);
  if (h) return h;
  // A bracketed tag like "[720p]" usually states the real encode, so it wins over the source tag.
  const m = f.name.match(/\[(2160|1440|1080|720|576|480|360)p\]/i) || f.name.match(/\b(2160|1440|1080|720|576|480|360)p\b/i);
  if (m) return Number(m[1]);
  return /\b(4k|uhd)\b/i.test(f.name) ? 2160 : null;
}

const fileRef = (f) => ({
  id: f.id,
  name: f.name,
  size: Number(f.size) || 0,
  height: heightOf(f),
  durationMs: Number(f.videoMediaMetadata?.durationMillis) || null,
  mimeType: f.mimeType,
});

const byQuality = (a, b) => (b.height || 0) - (a.height || 0) || b.size - a.size;
const newest = (files) => files.reduce((t, f) => (f.createdTime > t ? f.createdTime : t), files[0]?.createdTime || '');

const LANGS = {
  en: 'English', eng: 'English', ar: 'Arabic', ara: 'Arabic', fr: 'French', fre: 'French', fra: 'French',
  es: 'Spanish', spa: 'Spanish', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian', tr: 'Turkish', tur: 'Turkish',
  ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', hi: 'Hindi',
  nl: 'Dutch', pl: 'Polish', sv: 'Swedish', fa: 'Persian', he: 'Hebrew', id: 'Indonesian',
};

function subLabel(subName, videoStem) {
  let s = stripExt(subName);
  if (videoStem && s.toLowerCase().startsWith(videoStem.toLowerCase())) s = s.slice(videoStem.length);
  else s = s.split(/[._]/).at(-1);
  s = s.replace(/^[\s._-]+/, '').replace(/[._]+/g, ' ').trim();
  const parts = s.split(' ').map((p) => LANGS[p.toLowerCase()] || p);
  const label = parts.join(' ').trim();
  return label && label.length <= 24 ? label : 'Subtitles';
}

function subRefs(subs, videoStem) {
  const seen = new Map();
  return subs.map((s) => {
    let label = subLabel(s.name, videoStem);
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    if (n > 1) label += ` ${n}`;
    return { id: s.id, label };
  });
}

const posterImage = (images, stems = []) =>
  (
    images.find((i) => /^(poster|folder|cover)$/i.test(stripExt(i.name))) ||
    images.find((i) => stems.some((s) => stripExt(i.name).toLowerCase() === s.toLowerCase()))
  )?.id || null;

const looksLikeShowFile = (f) => EPISODE_RE.test(f.name);

// ---------- builders ----------

function buildMovie({ id, nameSource, videos, subs, images, category }) {
  const mains = videos.filter((v) => !EXTRA_RE.test(v.name));
  const versions = (mains.length ? mains : videos).map(fileRef).sort(byQuality);
  const { title, year, tmdbId } = parseTitle(nameSource);
  const stems = videos.map((v) => stripExt(v.name));
  return {
    id,
    kind: 'movie',
    category,
    title,
    year,
    tmdbId,
    posterId: posterImage(images, stems),
    thumbId: versions[0].id,
    addedAt: newest(videos),
    versions,
    subs: subRefs(subs, stems.find((s) => subs.some((x) => x.name.toLowerCase().startsWith(s.toLowerCase())))),
  };
}

async function buildShow({ folder, kids, category, listFolder }) {
  const episodes = new Map(); // "s-e" -> episode
  const add = (video, seasonHint, subsPool, autoNumber) => {
    const p = parseEpisode(video.name) || {};
    const season = p.season ?? seasonHint ?? 1;
    const episode = p.episode ?? autoNumber;
    const key = `${season}-${episode}`;
    let ep = episodes.get(key);
    if (!ep) episodes.set(key, (ep = { season, episode, versions: [], subs: [], addedAt: '' }));
    ep.versions.push(fileRef(video));
    if (video.createdTime > ep.addedAt) ep.addedAt = video.createdTime;
    const stem = stripExt(video.name).toLowerCase();
    const mine = subsPool.filter((s) => {
      const sp = parseEpisode(s.name);
      return stripExt(s.name).toLowerCase().startsWith(stem) || (sp && sp.episode === episode && (sp.season ?? season) === season);
    });
    for (const r of subRefs(mine, stripExt(video.name))) if (!ep.subs.some((x) => x.id === r.id)) ep.subs.push(r);
  };

  const addAll = (files, seasonHint) => {
    const videos = files.filter(isVideo).filter((v) => !EXTRA_RE.test(v.name));
    const subs = files.filter(isSub);
    videos.forEach((v, i) => add(v, seasonHint, subs, i + 1));
  };

  addAll(kids, null);
  const subfolders = kids.filter(isFolder);
  const seasonDirs = subfolders.filter((f) => seasonFromFolder(f.name) !== null);
  const dirs = seasonDirs.length ? seasonDirs : subfolders;
  await mapLimit(dirs, 4, async (dir, i) => {
    const files = await listFolder(dir.id);
    const nested = files.filter(isFolder).filter((f) => /^subs?(titles)?$/i.test(f.name));
    for (const n of nested) files.push(...(await listFolder(n.id)));
    addAll(files, seasonFromFolder(dir.name) ?? i + 1);
  });

  const list = [...episodes.values()].map((e) => ({ ...e, versions: e.versions.sort(byQuality) }));
  if (!list.length) return null;
  const seasons = [...new Set(list.map((e) => e.season))].sort((a, b) => (a || 99) - (b || 99));
  const { title, year, tmdbId } = parseTitle(folder.name);
  const first = list.sort((a, b) => a.season - b.season || a.episode - b.episode).find((e) => e.season > 0) || list[0];
  return {
    id: folder.id,
    kind: 'show',
    folderName: folder.name,
    category,
    title,
    year,
    tmdbId,
    posterId: posterImage(kids.filter(isImage)),
    thumbId: first.versions[0].id,
    addedAt: list.reduce((t, e) => (e.addedAt > t ? e.addedAt : t), ''),
    seasons: seasons.map((s) => ({
      season: s,
      episodes: list.filter((e) => e.season === s).sort((a, b) => a.episode - b.episode),
    })),
  };
}

async function scanFolder(folder, cat, depth, listFolder) {
  const kids = await listFolder(folder.id);
  const subfolders = kids.filter(isFolder);
  const videos = kids.filter(isVideo);
  const hasSeasonDirs = subfolders.some((f) => seasonFromFolder(f.name) !== null);
  const showish =
    hasSeasonDirs ||
    videos.some(looksLikeShowFile) ||
    videos.filter((v) => parseEpisode(v.name)).length >= 3; // "Naruto - 01.mkv" style

  // In a TV category every top-level folder is a show (its sub-folders are seasons).
  if ((cat.type === 'tv' && depth === 0) || (cat.type !== 'movie' && showish)) {
    const show = await buildShow({ folder, kids, category: cat.slug, listFolder });
    return show ? [show] : [];
  }

  if (!videos.length) {
    // Collection folder ("Marvel", "Studio Ghibli"): scan each child as its own title.
    if (depth >= 2) return [];
    return (await mapLimit(subfolders, 4, (f) => scanFolder(f, cat, depth + 1, listFolder))).flat();
  }

  const subDir = subfolders.find((f) => /^subs?(titles)?$/i.test(f.name));
  const subs = kids.filter(isSub);
  if (subDir) subs.push(...(await listFolder(subDir.id)).filter(isSub));
  return [buildMovie({ id: folder.id, nameSource: folder.name, videos, subs, images: kids.filter(isImage), category: cat.slug })];
}

export async function scanCategory(cat, storage) {
  const listFolder = (id) => storage.listFolder(id);
  const kids = await listFolder(cat.folderId);
  const items = [];

  // Loose video files directly in the category folder.
  const loose = kids.filter(isVideo);
  const subs = kids.filter(isSub);
  const images = kids.filter(isImage);
  const groups = new Map();
  for (const v of loose) {
    const { title, year } = parseTitle(v.name);
    const show = cat.type !== 'movie' && looksLikeShowFile(v);
    const key = show ? `show:${title.toLowerCase()}` : `movie:${title.toLowerCase()}:${year}`;
    if (!groups.has(key)) groups.set(key, { show, files: [] });
    groups.get(key).files.push(v);
  }
  for (const { show, files } of groups.values()) {
    if (show) {
      const fake = { id: files[0].id, name: parseTitle(files[0].name).title };
      const item = await buildShow({ folder: fake, kids: [...files, ...subs], category: cat.slug, listFolder });
      if (item) items.push(item);
    } else {
      const stems = files.map((f) => stripExt(f.name).toLowerCase());
      const mySubs = subs.filter((s) => stems.some((st) => stripExt(s.name).toLowerCase().startsWith(st)));
      items.push(buildMovie({ id: files[0].id, nameSource: files[0].name, videos: files, subs: mySubs, images, category: cat.slug }));
    }
  }

  const folders = kids.filter(isFolder);
  items.push(...(await mapLimit(folders, 6, (f) => scanFolder(f, cat, 0, listFolder))).flat());
  return items;
}

// fileId -> where it lives, plus the set of storage ids clients may fetch.
export function buildIndex(items) {
  const byId = new Map();
  const files = new Map();
  const allowed = new Set();
  for (const item of items) {
    byId.set(item.id, item);
    if (item.posterId) allowed.add(item.posterId);
    if (item.kind === 'movie') {
      for (const v of item.versions) files.set(v.id, { item, versions: item.versions, subs: item.subs });
      item.subs.forEach((s) => allowed.add(s.id));
    } else {
      const eps = item.seasons.flatMap((s) => s.episodes);
      eps.forEach((ep, i) => {
        for (const v of ep.versions) files.set(v.id, { item, ep, versions: ep.versions, subs: ep.subs, index: i, eps });
        ep.subs.forEach((s) => allowed.add(s.id));
      });
    }
  }
  for (const id of files.keys()) allowed.add(id);
  return { byId, files, allowed };
}

// The episode that follows, skipping specials unless we're in them.
export function nextEpisode(loc) {
  if (!loc?.ep) return null;
  const rest = loc.eps.slice(loc.index + 1);
  return rest.find((e) => e.season > 0 || loc.ep.season === 0) || null;
}
