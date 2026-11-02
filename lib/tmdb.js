// Title metadata from The Movie Database (https://www.themoviedb.org).
// Results are cached on disk, so each title is looked up only once.

import { jsonStore } from './store.js';

const API = 'https://api.themoviedb.org/3';
const MISS_RETRY_MS = 7 * 24 * 3600_000;
const SEASON_TTL_MS = 3 * 24 * 3600_000;

export function createTmdb({ key, language = 'en-US', cacheFile }) {
  if (!key) return null;
  const cache = jsonStore(cacheFile, {});
  const bearer = key.length > 40; // v4 "read access token" vs v3 api key
  let genreMap;

  async function get(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
    url.searchParams.set('language', language);
    if (!bearer) url.searchParams.set('api_key', key);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const err = new Error(`TMDB ${res.status} for ${path}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
  }

  async function genres() {
    if (!genreMap) {
      const [m, t] = await Promise.all([get('/genre/movie/list'), get('/genre/tv/list')]);
      genreMap = new Map([...m.genres, ...t.genres].map((g) => [g.id, g.name]));
    }
    return genreMap;
  }

  async function normalize(r) {
    const g = await genres();
    return {
      tmdbId: r.id,
      title: r.title || r.name,
      year: Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null,
      overview: r.overview || '',
      poster: r.poster_path || null,
      backdrop: r.backdrop_path || null,
      rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
      genres: r.genres ? r.genres.map((x) => x.name) : (r.genre_ids || []).map((id) => g.get(id)).filter(Boolean),
    };
  }

  async function match(item) {
    const type = item.kind === 'show' ? 'tv' : 'movie';
    const key = item.tmdbId ? `${type}:id:${item.tmdbId}` : `${type}:${item.title.toLowerCase()}:${item.year || ''}`;
    const hit = cache.data[key];
    if (hit && (hit.v || Date.now() - hit.at < MISS_RETRY_MS)) return hit.v;

    let meta = null;
    if (item.tmdbId) {
      meta = await normalize(await get(`/${type}/${item.tmdbId}`));
    } else {
      const yearParam = type === 'tv' ? 'first_air_date_year' : 'year';
      let { results } = await get(`/search/${type}`, { query: item.title, [yearParam]: item.year, include_adult: 'false' });
      if (!results.length && item.year) ({ results } = await get(`/search/${type}`, { query: item.title, include_adult: 'false' }));
      if (results.length) meta = await normalize(results[0]);
    }
    cache.data[key] = { at: Date.now(), v: meta };
    cache.save();
    return meta;
  }

  // Episode names, plots and stills for one season.
  async function season(tvId, number) {
    const key = `season:${tvId}:${number}`;
    const hit = cache.data[key];
    if (hit && Date.now() - hit.at < SEASON_TTL_MS) return hit.v;
    let v = {};
    try {
      const s = await get(`/tv/${tvId}/season/${number}`);
      for (const e of s.episodes || []) {
        v[e.episode_number] = { name: e.name, overview: e.overview, still: e.still_path, runtime: e.runtime, airDate: e.air_date };
      }
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    cache.data[key] = { at: Date.now(), v };
    cache.save();
    return v;
  }

  return { match, season };
}
