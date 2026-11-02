// Profiles, sign-in sessions and per-profile watch history.
//
// Sessions are random tokens. The web app keeps one in an HttpOnly cookie; the
// future phone/TV apps send it as "Authorization: Bearer <token>". Only a hash of
// each token is stored, so a leaked data/ folder can't be used to sign in.

import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { jsonStore } from './store.js';

const SESSION_TTL_MS = 90 * 24 * 3600_000;
const COLORS = ['#e50914', '#2e86de', '#f39c12', '#27ae60', '#8e44ad', '#16a085', '#d35400', '#c0392b'];

const fail = (status, message) => Object.assign(new Error(message), { status });
const sha = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(pw, salt, 64).toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(String(pw), Buffer.from(salt, 'base64'), 64);
  return got.length === want.length && timingSafeEqual(got, want);
}

const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex')); // keeps unknown-user logins as slow as real ones

function validate({ name, username, password }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw fail(400, 'Name must be 1–40 characters.');
  }
  if (!partial || username !== undefined) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      throw fail(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
    }
  }
  if (!partial || password !== undefined) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) throw fail(400, 'Password must be at least 6 characters.');
  }
}

export function createAccounts(dataDir) {
  const users = jsonStore(path.join(dataDir, 'users.json'), { users: [] });
  const sessions = jsonStore(path.join(dataDir, 'sessions.json'), {});
  const progress = jsonStore(path.join(dataDir, 'progress.json'), {});

  // Before profiles existed, progress.json was one flat { fileId: entry } map.
  if (!progress.data.version) {
    progress.data = { version: 2, users: {}, legacy: progress.data };
    progress.save();
  }

  const list = () => users.data.users;
  const byId = (id) => list().find((u) => u.id === id);
  const byUsername = (name) => list().find((u) => u.username.toLowerCase() === String(name).toLowerCase());
  const adminCount = () => list().filter((u) => u.isAdmin).length;

  const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, isAdmin: !!u.isAdmin, color: u.color, lang: u.lang === 'ar' ? 'ar' : 'en', createdAt: u.createdAt });

  function createUser({ name, username, password, isAdmin = false }) {
    validate({ name, username, password });
    if (byUsername(username)) throw fail(409, 'That username is already taken.');
    const u = {
      id: randomUUID(),
      name: name.trim(),
      username,
      passwordHash: hashPassword(password),
      isAdmin: !!isAdmin,
      color: COLORS[list().length % COLORS.length],
      createdAt: new Date().toISOString(),
    };
    list().push(u);
    users.save();
    return u;
  }

  // On first start, turn the old single-password setup into an admin profile.
  function ensureAdmin({ username = 'admin', password }) {
    if (list().length) return null;
    let generated = null;
    if (!password || password.length < 6) password = generated = randomBytes(9).toString('base64url');
    const admin = createUser({ name: 'Admin', username, password, isAdmin: true });
    if (progress.data.legacy && Object.keys(progress.data.legacy).length) {
      progress.data.users[admin.id] = { files: progress.data.legacy, hidden: {} };
    }
    delete progress.data.legacy;
    progress.save();
    users.flush();
    return { username: admin.username, generatedPassword: generated };
  }

  function updateUser(id, patch, actingUser) {
    const u = byId(id);
    if (!u) throw fail(404, 'Profile not found.');
    const { name, username, password, isAdmin, lang } = patch;
    if (lang !== undefined && lang !== 'en' && lang !== 'ar') throw fail(400, 'Unknown language.');
    validate({ name, username, password }, { partial: true });
    if (username !== undefined && username.toLowerCase() !== u.username.toLowerCase() && byUsername(username)) {
      throw fail(409, 'That username is already taken.');
    }
    if (isAdmin === false && u.isAdmin && adminCount() === 1) throw fail(400, 'There must be at least one admin.');
    if (isAdmin === false && u.id === actingUser?.id) throw fail(400, 'You can’t remove your own admin rights.');
    if (name !== undefined) u.name = name.trim();
    if (username !== undefined) u.username = username;
    if (isAdmin !== undefined) u.isAdmin = !!isAdmin;
    if (lang !== undefined) u.lang = lang;
    if (password !== undefined) {
      u.passwordHash = hashPassword(password);
      endSessions(u.id); // signs the profile out everywhere
    }
    users.save();
    return u;
  }

  function deleteUser(id, actingUser) {
    const u = byId(id);
    if (!u) throw fail(404, 'Profile not found.');
    if (u.id === actingUser?.id) throw fail(400, 'You can’t delete your own profile.');
    if (u.isAdmin && adminCount() === 1) throw fail(400, 'There must be at least one admin.');
    users.data.users = list().filter((x) => x.id !== id);
    endSessions(id);
    delete progress.data.users[id];
    users.save();
    progress.save();
  }

  function login(username, password) {
    const u = byUsername(username || '');
    const ok = verifyPassword(password || '', u ? u.passwordHash : DUMMY_HASH);
    return ok && u ? u : null;
  }

  // Which field was wrong, for the sign-in screen's message.
  const loginProblem = (username) => (byUsername(username || '') ? 'password' : 'username');

  function startSession(userId, agent = '') {
    const token = randomBytes(32).toString('base64url');
    sessions.data[sha(token)] = { userId, createdAt: Date.now(), lastSeen: Date.now(), agent: String(agent).slice(0, 120) };
    sessions.save();
    return token;
  }

  function userForToken(token) {
    if (!token) return null;
    const key = sha(token);
    const s = sessions.data[key];
    if (!s) return null;
    if (Date.now() - s.lastSeen > SESSION_TTL_MS) {
      delete sessions.data[key];
      sessions.save();
      return null;
    }
    const u = byId(s.userId);
    if (!u) return null;
    if (Date.now() - s.lastSeen > 3600_000) {
      s.lastSeen = Date.now();
      sessions.save();
    }
    return u;
  }

  function endSession(token) {
    if (!token) return;
    delete sessions.data[sha(token)];
    sessions.save();
  }

  function endSessions(userId, keepToken) {
    const keep = keepToken && sha(keepToken);
    for (const [k, s] of Object.entries(sessions.data)) if (s.userId === userId && k !== keep) delete sessions.data[k];
    sessions.save();
  }

  // { files: { fileId: {t, d, done, at} }, hidden: { itemId: time removed from Continue Watching } }
  function historyOf(userId) {
    return (progress.data.users[userId] ??= { files: {}, hidden: {} });
  }

  return {
    list: () => list().map(publicUser),
    publicUser,
    byId,
    createUser,
    ensureAdmin,
    updateUser,
    deleteUser,
    login,
    loginProblem,
    startSession,
    userForToken,
    endSession,
    endSessions,
    historyOf,
    saveHistory: () => progress.save(),
    resetHistory(userId) {
      progress.data.users[userId] = { files: {}, hidden: {} };
      progress.save();
    },
    flush() {
      users.flush();
      sessions.flush();
      progress.flush();
    },
  };
}
