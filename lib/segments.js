// Intro and end-credits detection for TV episodes, by audio fingerprint.
//
// Episodes of a show share the same theme song and the same credits. We take
// Chromaprint fingerprints of the first INTRO_WINDOW and last CREDITS_WINDOW
// seconds of each episode and compare it with its neighbours: a stretch that
// matches another episode is the intro (near the start) or the credits (running
// to the end). Anything unique to one episode never matches, so real content is
// never marked as skippable. The player only offers a button; it never skips by itself.
//
// Some shows play a different song over each episode's credits, so their audio
// never matches. For those we fall back to the picture: end credits are white
// text on black, so a long unbroken stretch of near-black frames that runs to the
// end of the file marks where they start.

import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { jsonStore } from './store.js';

const VERSION = 2; // bump to re-analyse everything after algorithm changes
const FP_VERSION = 2; // bump when the fingerprint windows change (forces re-reading the files)
const SEC_PER_ITEM = 0.1238; // one Chromaprint item covers ~0.1238 s of audio
const INTRO_WINDOW = 900; // cold opens can run 8+ minutes before the titles
const CREDITS_WINDOW = 480;
const INTRO_MIN = 15, INTRO_MAX = 150;
const CREDITS_MIN = 15;
const BLACK_MIN = 20; // seconds of unbroken black-with-text needed to call it credits
const BLACK_MAX_GAP = 1.5; // a brighter credit card shorter than this doesn't break the run
const BLACK_END_SLACK = 15; // the run must reach (nearly) the end of the file
// Two fingerprint items "match" when at most 4 of their 32 bits differ: ~97% of items in a
// truly shared stretch do, against ~2% of unrelated audio.
const MAX_BIT_DIFF = 4;
const WINDOW = Math.round(2 / SEC_PER_ITEM); // judge matching by density over ~2 s, not single items
const MIN_DENSITY = 0.5;
const MAX_GAP = Math.round(2 / SEC_PER_ITEM); // tolerate short dropouts inside a matching stretch

function fromB64(s) {
  const b = Buffer.from(s, 'base64');
  return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// Longest stretch where a and b line up. Returns positions in items, or null.
export function longestMatch(a, b, minItems) {
  const n = a.length, m = b.length;
  const shifts = [];
  for (let s = -(m - 1); s < n; s++) {
    const i0 = Math.max(0, s), i1 = Math.min(n, m + s);
    if (i1 - i0 < minItems) continue;
    let hits = 0;
    for (let i = i0; i < i1; i++) if (popcount(a[i] ^ b[i - s]) <= MAX_BIT_DIFF) hits++;
    if (hits >= minItems * 0.6) shifts.push([hits, s]);
  }
  shifts.sort((x, y) => y[0] - x[0]);

  let best = null;
  for (const [, s] of shifts.slice(0, 4)) {
    const i0 = Math.max(0, s), i1 = Math.min(n, m + s);
    const hit = new Uint8Array(i1 - i0);
    for (let i = i0; i < i1; i++) hit[i - i0] = popcount(a[i] ^ b[i - s]) <= MAX_BIT_DIFF ? 1 : 0;
    // dense[k]: the ~2 s window centred on k is mostly matching
    const half = WINDOW >> 1;
    const dense = new Uint8Array(hit.length);
    let sum = 0;
    for (let k = 0; k < Math.min(hit.length, half); k++) sum += hit[k];
    for (let k = 0; k < hit.length; k++) {
      if (k + half < hit.length) sum += hit[k + half];
      if (k - half - 1 >= 0) sum -= hit[k - half - 1];
      const width = Math.min(hit.length, k + half + 1) - Math.max(0, k - half);
      dense[k] = sum >= width * MIN_DENSITY ? 1 : 0;
    }
    let runStart = -1, last = -1;
    const close = () => {
      if (runStart < 0) return;
      // tighten to the first and last real matches inside the dense stretch
      let a0 = runStart, a1 = last;
      while (a0 < a1 && !hit[a0]) a0++;
      while (a1 > a0 && !hit[a1]) a1--;
      if (a1 - a0 + 1 >= minItems && (!best || a1 - a0 > best.aEnd - best.aStart)) {
        best = { aStart: a0 + i0, aEnd: a1 + i0 + 1, bStart: a0 + i0 - s, bEnd: a1 + i0 + 1 - s };
      }
    };
    for (let k = 0; k < dense.length; k++) {
      if (!dense[k]) continue;
      if (runStart < 0 || k - last > MAX_GAP) {
        close();
        runStart = k;
      }
      last = k;
    }
    close();
  }
  return best;
}

export function createSegments({ dataDir, ffmpeg, inputArgs, log = console.log }) {
  const store = jsonStore(path.join(dataDir, 'segments.json'), {});
  const fpDir = path.join(dataDir, 'fingerprints');
  mkdirSync(fpDir, { recursive: true });
  let running = null;
  let progress = { done: 0, total: 0 };

  function fingerprint(fileId, start, length) {
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(length),
        ...inputArgs(fileId), '-vn', '-ac', '1', '-f', 'chromaprint', '-fp_format', 'raw', 'pipe:1']);
      try { setPriority(p.pid, 19); } catch {}
      const chunks = [];
      let err = '';
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => (err = (err + d).slice(-500)));
      const timer = setTimeout(() => p.kill('SIGKILL'), 15 * 60_000);
      p.on('error', reject);
      p.on('close', (code) => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (code !== 0 || buf.length < 400) return reject(new Error(err.trim().split('\n').at(-1) || `ffmpeg exited ${code}`));
        resolve(new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4))));
      });
    });
  }

  // Near-black stretches [start, end] (seconds, relative to `start`) in a window of the video.
  function blackRuns(fileId, start, length) {
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-ss', String(start), '-t', String(length), ...inputArgs(fileId),
        '-an', '-vf', 'fps=2,scale=160:-2,blackdetect=d=0.5:pic_th=0.85:pix_th=0.12', '-f', 'null', '-']);
      try { setPriority(p.pid, 19); } catch {}
      let out = '';
      p.stderr.on('data', (d) => (out += d)); // blackdetect reports on stderr
      const timer = setTimeout(() => p.kill('SIGKILL'), 15 * 60_000);
      p.on('error', reject);
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(out.trim().split('\n').at(-1) || `ffmpeg exited ${code}`));
        const runs = [...out.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        resolve(runs);
      });
    });
  }

  // Credits start from the picture: the last near-black run, if it's long and reaches the end.
  function creditsFromBlack(runs, windowStart, dur) {
    const merged = [];
    for (const [s, e] of runs) {
      const last = merged.at(-1);
      if (last && s - last[1] <= BLACK_MAX_GAP) last[1] = e;
      else merged.push([s, e]);
    }
    const last = merged.at(-1);
    if (!last) return null;
    const start = windowStart + last[0], end = windowStart + last[1];
    return dur - end <= BLACK_END_SLACK && end - start >= BLACK_MIN ? start : null;
  }

  // Fingerprints are cached on disk so new episodes can be compared with old ones cheaply.
  async function prints(ep) {
    const file = path.join(fpDir, `${ep.fileId}.json`);
    if (existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      if (j.v === FP_VERSION) {
        return { intro: fromB64(j.intro), credits: j.credits ? fromB64(j.credits) : null, creditsFrom: j.creditsFrom, introSpi: j.introSpi, creditsSpi: j.creditsSpi, blackCredits: j.blackCredits };
      }
    }
    const dur = ep.durationSec;
    const introLen = Math.min(INTRO_WINDOW, dur || INTRO_WINDOW);
    const intro = await fingerprint(ep.fileId, 0, introLen);
    let credits = null, creditsFrom = null;
    if (dur && dur > CREDITS_WINDOW + 60) {
      creditsFrom = dur - CREDITS_WINDOW;
      credits = await fingerprint(ep.fileId, creditsFrom, CREDITS_WINDOW);
    }
    let blackCredits = null;
    if (creditsFrom !== null) blackCredits = creditsFromBlack(await blackRuns(ep.fileId, creditsFrom, CREDITS_WINDOW), creditsFrom, dur);
    // Seconds per item, measured on this file (the nominal 0.1238 drifts by a few seconds over 10 minutes).
    const introSpi = dur && dur < INTRO_WINDOW ? SEC_PER_ITEM : introLen / intro.length;
    const creditsSpi = credits ? CREDITS_WINDOW / credits.length : null;
    const b64 = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
    writeFileSync(file, JSON.stringify({ v: FP_VERSION, intro: b64(intro), credits: credits && b64(credits), creditsFrom, introSpi, creditsSpi, blackCredits }));
    return { intro, credits, creditsFrom, introSpi, creditsSpi, blackCredits };
  }

  function analysePair(pa, pb) {
    const out = { intro: null, credits: null };
    const im = longestMatch(pa.intro, pb.intro, Math.round(INTRO_MIN / SEC_PER_ITEM));
    if (im) {
      const start = im.aStart * pa.introSpi, end = im.aEnd * pa.introSpi;
      if (end - start <= INTRO_MAX) out.intro = { start: start < 3 ? 0 : start, end };
    }
    if (pa.credits && pb.credits) {
      const cm = longestMatch(pa.credits, pb.credits, Math.round(CREDITS_MIN / SEC_PER_ITEM));
      // Credits run to the end of the file; a shared stretch earlier on (a recap, a song) doesn't count.
      if (cm && (pa.credits.length - cm.aEnd) * pa.creditsSpi < 20) out.credits = { start: pa.creditsFrom + cm.aStart * pa.creditsSpi, source: 'audio' };
    }
    return out;
  }

  // shows: [{ title, episodes: [{ fileId, durationSec }] }] in watch order
  async function analyse(shows) {
    const todo = [];
    for (const show of shows) {
      const eps = show.episodes;
      if (eps.length < 2) continue;
      eps.forEach((ep, i) => {
        const r = store.data[ep.fileId];
        // Redo if never analysed, the algorithm changed, or new episodes arrived to compare with.
        if (!r || r.v !== VERSION || r.peers < eps.length) todo.push({ show, ep, i });
      });
    }
    if (!todo.length) return;
    progress = { done: 0, total: todo.length };
    log(`Intro/credits detection: analysing ${todo.length} episode(s)…`);
    for (const { show, ep, i } of todo) {
      try {
        const eps = show.episodes;
        const neighbours = [eps[i - 1], eps[i + 1], eps[i - 2], eps[i + 2]].filter(Boolean);
        const mine = await prints(ep);
        let intro = null, credits = null;
        for (const other of neighbours) {
          const r = analysePair(mine, await prints(other));
          if (r.intro && (!intro || r.intro.end - r.intro.start > intro.end - intro.start)) intro = r.intro;
          if (r.credits && (!credits || r.credits.start < credits.start)) credits = r.credits;
        }
        if (!credits && mine.blackCredits) credits = { start: mine.blackCredits, source: 'black' };
        store.data[ep.fileId] = { v: VERSION, intro, credits, peers: eps.length, at: Date.now() };
        store.save();
      } catch (e) {
        log(`Intro/credits detection skipped an episode of "${show.title}": ${e.message}`);
        store.data[ep.fileId] = { v: VERSION, intro: null, credits: null, peers: show.episodes.length, failed: true, at: Date.now() };
      }
      progress.done++;
    }
    store.flush();
    log('Intro/credits detection finished.');
  }

  return {
    // Runs one analysis at a time in the background; safe to call after every library scan.
    run(shows) {
      if (running) return running;
      running = analyse(shows).catch((e) => log(`Intro/credits detection failed: ${e.message}`)).finally(() => (running = null));
      return running;
    },
    get(fileId) {
      const r = store.data[fileId];
      return r && r.v === VERSION ? { intro: r.intro, credits: r.credits } : null;
    },
    status: () => (running ? { ...progress } : null),
  };
}
