import { Platform } from 'react-native';

export const isTV = Platform.isTV;

export const colors = {
  bg: '#141414',
  panel: '#1f1f1f',
  panel2: '#2b2b2b',
  text: '#ffffff',
  muted: '#a3a3a3',
  red: '#e50914',
  green: '#46d369',
  focus: '#ffffff',
};

// Brand display font, embedded at build time by the expo-font plugin (app.json).
export const display = 'BebasNeue-Regular';
// Arabic subtitles (embedded by expo-font, see app.json).
export const arabicFont = 'ThmanyahSans-Bold';

// TVs are viewed from across the room: everything a bit larger.
export const s = (n: number) => (isTV ? Math.round(n * 1.35) : n);

export function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

// 1.2 GB, 700 MB (same as the website's fmtSize).
export function fmtSize(bytes: number | null | undefined) {
  const b = Number(bytes);
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i > 2 ? 1 : 0)} ${u[i]}`;
}

export const fmtRuntime = (min: number | null) => (!min ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

export const qualityBadge = (h: number | null) => (!h ? null : h >= 2000 ? '4K' : h >= 700 ? 'HD' : 'SD');
