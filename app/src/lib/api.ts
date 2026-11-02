// Talks to the DriveStream server with a bearer token (same API the website uses).
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Pre-filled on the sign-in screen. Set DRIVESTREAM_SERVER when building (see app.config.js);
// empty means people type their server's address on the sign-in screen.
export const DEFAULT_SERVER: string = (Constants.expoConfig?.extra?.serverUrl as string | undefined) || '';

let server = DEFAULT_SERVER;
let token: string | null = null;

export const getServer = () => server;
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
export const mediaUrl = (path: string) => `${server}${path}`;

export async function loadSession() {
  server = (await SecureStore.getItemAsync('server')) || DEFAULT_SERVER;
  token = await SecureStore.getItemAsync('token');
  return { server, token };
}

async function saveSession() {
  await SecureStore.setItemAsync('server', server);
  if (token) await SecureStore.setItemAsync('token', token);
  else await SecureStore.deleteItemAsync('token');
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) {
    super(message);
  }
}

let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (fn: () => void) => (onSignedOut = fn);

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${server}${path}`, {
    method: init.method || 'GET',
    headers: { ...authHeaders(), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    token = null;
    await saveSession();
    onSignedOut();
  }
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body.field);
  return body as T;
}

export async function login(serverUrl: string, username: string, password: string) {
  server = serverUrl.trim().replace(/\/+$/, '') || DEFAULT_SERVER;
  const r = await api<{ user: User; token: string }>('/api/login', { method: 'POST', body: { username, password } });
  token = r.token;
  await saveSession();
  return r.user;
}

// ---------- sign in with a code ----------
// The device shows a code + QR; someone signed in approves it on the website or phone app.
export type DeviceCode = { code: string; display: string; secret: string; qr: string; url: string; expiresIn: number };

export async function deviceStart(serverUrl: string, device: string) {
  server = serverUrl.trim().replace(/\/+$/, '') || DEFAULT_SERVER;
  return api<DeviceCode>('/api/device/start', { method: 'POST', body: { device } });
}

// 'pending' | 'expired', or the signed-in user once approved.
export async function devicePoll(secret: string): Promise<'pending' | 'expired' | User> {
  const r = await api<{ status: string; user?: User; token?: string }>('/api/device/poll', { method: 'POST', body: { secret } });
  if (r.status !== 'approved' || !r.user || !r.token) return r.status === 'expired' ? 'expired' : 'pending';
  token = r.token;
  await saveSession();
  return r.user;
}

// Pull the code out of what a QR scan gives (…/#/link?code=ABC123) or what was typed.
export const codeFrom = (text: string) => (text.match(/[?&]code=([A-Za-z0-9-]+)/)?.[1] || text).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Changing the password signs the profile out everywhere; the server hands this device a new session.
export async function changePassword(current: string, next: string) {
  const r = await api<{ ok: boolean; token?: string }>('/api/me/password', { method: 'POST', body: { current, next } });
  if (r.token) {
    token = r.token;
    await saveSession();
  }
}

export async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  token = null;
  await saveSession();
}

export const saveProgress = (fileId: string, t: number, d: number, done = false) =>
  api('/api/progress', { method: 'POST', body: { fileId, t: done ? 0 : t, d, done } }).catch(() => {});

// ---------- types (mirror server.js) ----------

export type Lang = 'en' | 'ar';
export type User = { id: string; name: string; username: string; isAdmin: boolean; color: string; lang?: Lang; createdAt?: string };

export type Item = {
  id: string;
  kind: 'movie' | 'show';
  category: string;
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  rating: number | null;
  genres: string[];
  posterId: string | null;
  thumbId: string;
  addedAt: string;
  quality: number | null;
  durationMs: number | null;
  seasonCount: number | null;
  episodeCount: number | null;
};

export type ContinueEntry = { item: Item; fileId: string; t: number; d: number | null; label: string | null; upNext?: boolean };

export type Library = {
  categories: { name: string; slug: string; type: string }[];
  items: Item[];
  continue: ContinueEntry[];
};

export type Episode = {
  season: number; episode: number; fileId: string; name: string; overview: string; still: string | null;
  runtimeMin: number | null; quality: number | null; hasSubs: boolean; progress: number;
};

export type Title = Item & {
  versions?: { id: string; height: number | null; size: number }[];
  subs?: { id: string; label: string }[];
  seasons?: { season: number; name: string; episodes: Episode[] }[];
  resume: { fileId: string; t: number; label?: string };
};

export type PlayInfo = {
  fileId: string;
  item: Item;
  episodeLabel: string | null;
  episodeName: string | null;
  durationMs: number | null;
  versions: { id: string; height: number | null; size: number; ext: string }[];
  subs: { id: string; label: string }[];
  resumeAt: number;
  next: { fileId: string; label: string; name: string | null } | null;
  transcodeHeights: number[];
  segments: { intro: { start: number; end: number } | null; credits: { start: number; source?: 'audio' | 'black' } | null } | null;
};

// ---------- images ----------

const tmdb = (p: string | null, size: string) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

export type Img = { uri: string; headers?: Record<string, string> } | null;
const driveThumb = (id: string | null, s: number): Img => (id ? { uri: mediaUrl(`/thumb/${id}?s=${s}`), headers: authHeaders() } : null);

export const posterSource = (it: Item, big = false): Img =>
  it.poster ? { uri: tmdb(it.poster, big ? 'w780' : 'w342')! } : driveThumb(it.posterId, big ? 1200 : 500);
export const backdropSource = (it: Item, big = false): Img =>
  it.backdrop ? { uri: tmdb(it.backdrop, big ? 'w1280' : 'w780')! } : driveThumb(it.thumbId, big ? 1280 : 780);
export const stillSource = (e: Episode): Img => (e.still ? { uri: tmdb(e.still, 'w300')! } : driveThumb(e.fileId, 400));
