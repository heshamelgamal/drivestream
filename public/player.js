// Full-screen player with custom controls.
//
// Two playback modes:
//   direct    – the original file, streamed with byte ranges (instant seeking)
//   transcode – converted by ffmpeg on the server to a chosen height; the stream
//               starts at `offset`, so every seek restarts it from the new time.
// Subtitles are drawn by us (not <track>) so they stay in sync in both modes.

import { h, icon, api, fmtTime, fmtSize, prefs, tmdbImg, img } from './ui.js';
import { tvMode } from './tv.js';
import { t, tName, epLabel } from './i18n.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

export function openPlayer(info, { startAt = 0, onBack, onNext }) {
  const video = h('video', { playsinline: true, preload: 'auto' });
  const subsLayer = h('div', { class: 'subs', 'aria-live': 'off' });
  const spinner = h('div', { class: 'spinner', hidden: true });
  const toast = h('div', { class: 'toast', hidden: true });
  const nextCard = h('div', { class: 'next-card', hidden: true });
  const skipBtn = h('button', { class: 'skip-btn', hidden: true, onclick: () => skipIntro() }, t('Skip Intro'));
  const skipIntro = () => {
    if (!segs.intro) return;
    seekTo(segs.intro.end);
    skipBtn.hidden = true;
  };

  // ---------- quality options ----------
  const versions = info.versions;
  const sourceH = Math.max(0, ...versions.map((v) => v.height || 0)) || 1080;
  const options = [
    ...versions.map((v) => ({
      key: `v:${v.id}`, mode: 'direct', fileId: v.id, height: v.height,
      label: v.height ? `${v.height}p` : t('Original'),
      note: [t('Original'), versions.length > 1 ? v.ext.toUpperCase() : '', fmtSize(v.size)].filter(Boolean).join(' · '),
    })),
    ...info.transcodeHeights
      .filter((th) => th <= Math.max(sourceH, 360))
      .map((th) => ({
        key: `t:${th}`, mode: 'transcode', fileId: versions[0].id, height: th, label: `${th}p`,
        note: th >= Math.min(sourceH, 1080) ? t('Converted · use if the original won’t play') : t('Converted · saves data'),
      })),
  ].sort((a, b) => (b.height || 0) - (a.height || 0) || (a.mode === 'direct' ? -1 : 1));

  const savedQ = prefs.get('quality');
  let cur =
    (savedQ && options.find((o) => o.mode === 'direct' && o.height === savedQ)) ||
    (savedQ && options.find((o) => o.height === savedQ && savedQ < sourceH)) ||
    options.find((o) => o.fileId === info.fileId && o.mode === 'direct');

  let offset = 0;
  let introPlaying = startAt < 1; // the DriveStream logo intro runs only when a title starts from the beginning
  let pendingSeek = 0;
  const knownDuration = info.durationMs ? info.durationMs / 1000 : null;
  const time = () => (cur.mode === 'direct' ? video.currentTime : offset + video.currentTime);
  const duration = () => (cur.mode === 'direct' && Number.isFinite(video.duration) ? video.duration : knownDuration || offset + (video.duration || 0));

  // On TVs the video is fetched by the TV's own media player, which doesn't send the
  // sign-in cookie: use signed addresses there (fetched once per file, valid for hours).
  const sigs = new Map();
  const signed = async (kind, id, url) => {
    if (!tvMode) return url;
    if (!sigs.has(id)) sigs.set(id, await api(`/api/media-sig/${id}`).catch(() => null));
    const sg = sigs.get(id);
    return sg ? `${url}${url.includes('?') ? '&' : '?'}exp=${sg.exp}&sig=${sg[kind]}` : url;
  };
  let loadSeq = 0;
  async function load(opt, at) {
    cur = opt;
    at = Math.max(0, at || 0);
    const seq = ++loadSeq;
    let src;
    if (opt.mode === 'direct') {
      offset = 0;
      pendingSeek = at;
      src = await signed('stream', opt.fileId, `/stream/${opt.fileId}`);
    } else {
      offset = at;
      pendingSeek = 0;
      src = await signed('transcode', opt.fileId, `/transcode/${opt.fileId}?h=${opt.height}&t=${at.toFixed(1)}`);
    }
    if (seq !== loadSeq) return; // a newer load (seek, quality change) took over
    video.src = src;
    spinner.hidden = false;
    video.defaultPlaybackRate = video.playbackRate = speed;
    if (!introPlaying) video.play().catch(() => {});
    updateLabels();
    renderTime();
  }

  video.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0) video.currentTime = pendingSeek;
    pendingSeek = 0;
  });

  function seekTo(t) {
    // Seeking forward during the logo intro leaves it for that point in the title;
    // back to the start replays it.
    if (introPlaying) {
      if (t > 0) return endIntro(t);
      intro.currentTime = 0;
      return poke();
    }
    const d = duration();
    t = Math.max(0, d ? Math.min(t, d - 1) : t);
    if (cur.mode === 'direct') video.currentTime = t;
    else load(cur, t);
    renderTime();
    poke();
  }

  // ---------- subtitles ----------
  let cues = [];
  let subOn = null;
  async function setSub(sub, remember = true) {
    subOn = sub;
    cues = [];
    subsLayer.replaceChildren();
    if (remember) prefs.set('subLang', sub ? sub.label : 'off');
    updateLabels();
    if (!sub) return;
    try {
      const text = await (await fetch(`/subs/${sub.id}`)).text();
      if (subOn === sub) cues = parseVtt(text);
    } catch {
      showToast(t('Couldn’t load subtitles'));
    }
  }
  let lastCueText = null;
  function renderSubs() {
    const t = time();
    const active = cues.filter((c) => t >= c.start && t <= c.end).map((c) => c.text).join('\n');
    if (active === lastCueText) return;
    lastCueText = active;
    subsLayer.replaceChildren(...(active ? active.split('\n').map((l) => h('span', {}, l)) : []));
  }

  // ---------- controls ----------
  // Same layout as the phone and TV apps (Netflix style): back + title on top,
  // back 10 · play/pause · forward 10 in the middle, the seek bar and
  // Speed / Episodes / Subtitles / Quality / Next Episode along the bottom.
  const btn = (name, label, onclick, cls = '') => h('button', { class: `ctl ${cls}`, 'aria-label': label, title: label, onclick }, icon(name));
  const playBtn = btn('play', t('Play (Space)'), () => togglePlay(), 'big-play');
  const backBtn = btn('back10', t('Back 10 seconds (←)'), () => seekTo(time() - 10), 'jump');
  const fwdBtn = btn('fwd10', t('Forward 10 seconds (→)'), () => seekTo(time() + 10), 'jump');
  const muteBtn = btn('volume', t('Mute (M)'), () => { video.muted = !video.muted; });
  const volume = h('input', { type: 'range', class: 'volume', min: '0', max: '1', step: '0.05', 'aria-label': t('Volume') });
  const fsBtn = btn('fullscreen', t('Full screen (F)'), () => toggleFullscreen());
  // On Android, hand a signed link to the Web Video Cast app (Chromecast, Fire TV, Roku, DLNA…).
  const castBtn = /Android/i.test(navigator.userAgent)
    ? h('button', { class: 'ctl text', title: t('Cast with Web Video Cast'), 'aria-label': t('Cast with Web Video Cast'), onclick: () => castNow() }, t('Cast'))
    : null;
  async function castNow() {
    const fileId = cur.mode === 'direct' ? cur.fileId : versions[0].id;
    const r = await fetch(`/api/cast/${fileId}`);
    const c = await r.json().catch(() => ({}));
    if (!r.ok) return showToast(c.error || t('Couldn’t prepare the cast link'));
    video.pause();
    save();
    const pkg = 'com.instantbits.cast.webvideo';
    const target = new URL(c.url);
    const sub = c.subtitles.find((x) => x.label === subOn?.label) || (subOn ? c.subtitles[0] : null);
    const extras = [`S.title=${encodeURIComponent(c.title)}`, sub ? `S.subtitle=${encodeURIComponent(sub.url)}` : '', c.poster ? `S.poster=${encodeURIComponent(c.poster)}` : '']
      .filter(Boolean).join(';');
    // If Web Video Cast isn't installed, Android opens its Play Store page instead.
    const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${pkg}`);
    location.href = `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${target.protocol.slice(0, -1)};action=android.intent.action.VIEW;type=${c.mimeType};package=${pkg};${extras};S.browser_fallback_url=${fallback};end`;
  }

  let speed = 1;
  const barBtn = (glyph, onclick) => h('button', { class: 'bar-btn', onclick }, h('span', { class: 'bar-icon' }, glyph), h('span', { class: 'bar-label' }));
  const speedBtn = barBtn('⏲', () => openPanel('speed'));
  const epBtn = info.episodeLabel ? barBtn('☰', () => openPanel('episodes')) : null;
  const ccBtn = info.subs.length ? barBtn('CC', () => openPanel('subs')) : null;
  const qualityBtn = barBtn('HD', () => openPanel('quality'));
  const nextBtn = info.next ? barBtn('⏭', () => onNext(info.next)) : null;
  function updateLabels() {
    speedBtn.lastChild.textContent = t('Speed ({n}x)', { n: speed });
    if (epBtn) epBtn.lastChild.textContent = t('Episodes');
    if (ccBtn) ccBtn.lastChild.textContent = subOn ? t('Subtitles · {label}', { label: subOn.label }) : t('Subtitles');
    if (cur) qualityBtn.lastChild.textContent = t('Quality · {label}', { label: cur.label });
    if (nextBtn) nextBtn.lastChild.textContent = t('Next Episode');
  }

  const seek = h('input', { type: 'range', class: 'seek', min: '0', max: '100', step: '1', value: '0', 'aria-label': t('Seek') });
  const timeLabel = h('span', { class: 'time' }, '0:00');
  const scrubTip = h('span', { class: 'scrub-tip', hidden: true }); // the target time while scrubbing
  const panelBox = h('div', { class: 'player-panel', role: 'dialog' });
  const panel = h('div', { class: 'player-backdrop', hidden: true, onclick: (e) => { if (e.target === panel) closeMenus(); } }, panelBox);

  const titleText = info.episodeLabel
    ? [h('strong', {}, info.item.title), ` ${epLabel(info.episodeLabel)}`, info.episodeName ? h('span', { class: 'muted' }, ` · ${info.episodeName}`) : null]
    : [h('strong', {}, info.item.title)];

  const root = h('div', { class: 'watch', tabindex: '-1' },
    video, subsLayer, spinner,
    h('div', { class: 'watch-top' },
      h('button', { class: 'ctl', 'aria-label': t('Back'), title: t('Back'), onclick: () => onBack() }, icon('back')),
      h('div', { class: 'watch-title' }, titleText),
      h('div', { class: 'ctl-group right' }, castBtn, h('div', { class: 'vol-wrap' }, muteBtn, volume), fsBtn)),
    h('div', { class: 'watch-center' }, backBtn, playBtn, fwdBtn),
    h('div', { class: 'watch-bottom' },
      h('div', { class: 'seek-row' }, h('div', { class: 'seek-wrap' }, seek, scrubTip), timeLabel),
      h('div', { class: 'bar-row' }, speedBtn, epBtn, ccBtn, qualityBtn, nextBtn)),
    skipBtn, nextCard, panel, toast);

  // ---------- panels (Speed, Subtitles, Quality, Episodes) ----------
  const closeBtn = () => h('button', { class: 'btn info small panel-close', onclick: () => closeMenus() }, t('Close'));
  const choice = (on, label, note, onclick) => h('button', { class: `menu-item${on ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': String(on), onclick },
    h('span', { class: 'menu-check' }, on ? icon('check') : null), h('span', {}, h('strong', {}, label), note ? h('small', {}, note) : null));

  let openMenu = null;
  let episodes = null;
  let epSeason = Number(info.episodeLabel?.match(/^S(\d+)/)?.[1] ?? 1);
  function openPanel(kind) {
    openMenu = kind;
    panelBox.className = `player-panel${kind === 'episodes' ? ' episodes' : ''}`;
    if (kind === 'quality') {
      panelBox.replaceChildren(h('div', { class: 'menu-title' }, t('Quality')),
        h('div', { class: 'panel-list' }, options.map((o) => choice(o === cur, o.label, o.note, () => {
          prefs.set('quality', o.height);
          closeMenus();
          if (o !== cur) {
            showToast(o.mode === 'transcode' ? t('Switching to {label} (converted)…', { label: o.label }) : t('Switching to {label}…', { label: o.label }));
            load(o, time());
          }
        }))),
        info.transcodeHeights.length ? null : h('p', { class: 'menu-note' }, t('Lower resolutions need ffmpeg on the server.')),
        closeBtn());
    } else if (kind === 'subs') {
      panelBox.replaceChildren(h('div', { class: 'menu-title' }, t('Subtitles')),
        h('div', { class: 'panel-list' }, [null, ...info.subs].map((x) => choice(subOn === x, x ? x.label : t('Off'), null, () => { closeMenus(); setSub(x); }))),
        closeBtn());
    } else if (kind === 'speed') {
      panelBox.replaceChildren(h('div', { class: 'menu-title' }, t('Playback speed')),
        h('div', { class: 'panel-list' }, SPEEDS.map((v) => choice(v === speed, v === 1 ? t('1x (Normal)') : `${v}x`, null, () => {
          closeMenus();
          speed = v;
          video.defaultPlaybackRate = video.playbackRate = v;
          updateLabels();
        }))),
        closeBtn());
    } else if (kind === 'episodes') {
      renderEpisodes();
      if (!episodes) {
        api(`/api/title/${info.item.id}`)
          .then((t) => { episodes = t.seasons || []; })
          .catch(() => { episodes = []; })
          .then(() => { if (openMenu === 'episodes') renderEpisodes(); });
      }
    }
    panel.hidden = false;
    root.classList.remove('idle');
    panelBox.querySelector('.menu-item.on, .ep-row.current, .menu-item, button')?.focus();
  }
  function renderEpisodes() {
    const head = h('div', { class: 'panel-head' }, h('div', { class: 'menu-title' }, info.item.title), closeBtn());
    if (!episodes) return panelBox.replaceChildren(head, h('div', { class: 'spinner inline' }));
    const season = episodes.find((x) => x.season === epSeason) || episodes[0];
    const tabs = episodes.length > 1
      ? h('div', { class: 'season-tabs' }, episodes.map((x) => h('button', { class: `season-tab${x === season ? ' on' : ''}`, onclick: () => { epSeason = x.season; renderEpisodes(); } }, tName(x.name))))
      : null;
    const playing = (e) => info.versions.some((v) => v.id === e.fileId);
    const list = h('div', { class: 'panel-list' }, (season?.episodes || []).map((e) => h('button', { class: `ep-row${playing(e) ? ' current' : ''}`, onclick: () => {
      closeMenus();
      if (!playing(e)) onNext({ fileId: e.fileId });
    } },
      h('div', { class: 'ep-img' }, img(tmdbImg(e.still, 'w300') || `/thumb/${e.fileId}?s=400`, '', null, () => null),
        e.progress ? h('div', { class: 'ep-bar' }, h('span', { style: `width:${Math.round(e.progress * 100)}%` })) : null),
      h('div', { class: 'ep-info' }, h('strong', {}, `${e.episode}. ${e.name}${playing(e) ? `  ${t('(now playing)')}` : ''}`), e.overview ? h('small', {}, e.overview) : null))));
    panelBox.replaceChildren(head, tabs || '', list);
    list.querySelector('.ep-row.current')?.scrollIntoView({ block: 'center' });
  }
  function closeMenus() {
    panel.hidden = true;
    openMenu = null;
    poke();
  }

  // During the logo intro, the controls drive the intro: it plays as the opening of the title.
  const playing = () => (introPlaying ? !intro.paused : !video.paused);
  function togglePlay() {
    const v = introPlaying ? intro : video;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  }
  const onFs = () => fsBtn.replaceChildren(icon(document.fullscreenElement ? 'exitFullscreen' : 'fullscreen'));
  document.addEventListener('fullscreenchange', onFs);

  let scrubbing = false;
  function renderTime() {
    const d = duration();
    const t = scrubbing ? Number(seek.value) : time();
    if (d) {
      seek.max = String(Math.floor(d));
      if (!scrubbing) seek.value = String(Math.floor(t));
      let buf = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime + 1) buf = Math.max(buf, video.buffered.end(i));
      }
      const bufAbs = (cur.mode === 'direct' ? 0 : offset) + buf;
      seek.style.setProperty('--pct', `${(t / d) * 100}%`);
      seek.style.setProperty('--buf', `${Math.min(100, (bufAbs / d) * 100)}%`);
      if (scrubbing) {
        scrubTip.textContent = fmtTime(t);
        scrubTip.style.left = `${(t / d) * 100}%`;
      }
    }
    if (scrubTip.hidden === scrubbing) scrubTip.hidden = !scrubbing;
    timeLabel.textContent = d ? fmtTime(d - t) : fmtTime(t); // time left, as in the apps
  }

  seek.addEventListener('input', () => { scrubbing = true; renderTime(); poke(); });
  seek.addEventListener('change', () => { scrubbing = false; seekTo(Number(seek.value)); });

  volume.value = String(prefs.get('volume', 1));
  video.volume = Number(volume.value);
  volume.addEventListener('input', () => { video.volume = Number(volume.value); video.muted = false; prefs.set('volume', video.volume); });
  video.addEventListener('volumechange', () => {
    muteBtn.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'volume'));
    volume.style.setProperty('--pct', `${(video.muted ? 0 : video.volume) * 100}%`);
  });
  volume.style.setProperty('--pct', `${video.volume * 100}%`);

  // ---------- idle / show controls ----------
  let idleTimer;
  function poke() {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (playing() && !openMenu && !scrubbing) root.classList.add('idle');
    }, 4000);
  }
  root.addEventListener('mousemove', poke);
  // A tap toggles the controls, so note whether they were showing before this touch brought them up.
  let lastTouch = 0;
  let idleAtTouch = false;
  root.addEventListener('touchstart', () => { lastTouch = Date.now(); idleAtTouch = root.classList.contains('idle'); poke(); }, { passive: true });

  // One tap shows or hides the controls (one mouse click plays or pauses); a double tap on
  // the left or right half jumps 10 s, and every further quick tap adds another 10 s
  // (as on Netflix and YouTube).
  const tapFx = h('div', { class: 'tap-seek', hidden: true });
  let tapTimer = null;
  let lastTap = 0;
  let tapSide = 0;
  let tapTotal = 0;
  video.addEventListener('click', (e) => {
    if (openMenu) return closeMenus();
    const box = video.getBoundingClientRect();
    const side = e.clientX - box.left < box.width / 2 ? -1 : 1;
    const now = Date.now();
    const quick = now - lastTap < 350 && side === tapSide;
    lastTap = now;
    tapSide = side;
    if (!quick) {
      tapTotal = 0;
      clearTimeout(tapTimer);
      const touch = now - lastTouch < 1000;
      const wasIdle = idleAtTouch;
      tapTimer = setTimeout(() => {
        tapTimer = null;
        if (!touch) togglePlay();
        else if (wasIdle) poke();
        else { clearTimeout(idleTimer); root.classList.add('idle'); }
      }, 350);
      return;
    }
    clearTimeout(tapTimer);
    tapTimer = null;
    tapTotal += 10;
    seekTo(time() + side * 10);
    const secs = t('{n}s', { n: tapTotal });
    tapFx.textContent = side < 0 ? `« ${secs}` : `${secs} »`;
    tapFx.className = `tap-seek ${side < 0 ? 'left' : 'right'}`;
    tapFx.hidden = false;
    clearTimeout(tapFx.t);
    tapFx.t = setTimeout(() => (tapFx.hidden = true), 700);
  });
  root.append(tapFx);

  // ---------- playback events ----------
  video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); poke(); });
  video.addEventListener('pause', () => {
    if (introPlaying) return; // the title sits paused, buffered, behind the intro
    playBtn.replaceChildren(icon('play'));
    root.classList.remove('idle');
    save();
  });
  video.addEventListener('waiting', () => (spinner.hidden = false));
  video.addEventListener('playing', () => (spinner.hidden = true));
  video.addEventListener('canplay', () => (spinner.hidden = true));

  let raf;
  const tick = () => {
    renderTime();
    renderSubs();
    updateSkipIntro();
    maybeShowNext();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // If the browser can't decode the original file, fall back to conversion.
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    spinner.hidden = true;
    if (cur.mode === 'direct' && info.transcodeHeights.length) {
      const fallback = options.find((o) => o.mode === 'transcode' && o.height <= Math.min(sourceH, 1080));
      if (fallback) {
        showToast(t('This file’s format isn’t supported by your browser. Converting it…'), 5000);
        load(fallback, time() || pendingSeek || startAt);
        return;
      }
    }
    showToast(cur.mode === 'transcode' ? t('Conversion failed. Check the server log.') : t('This browser can’t play this file. Install ffmpeg on the server to convert it.'), 8000);
  });

  // ---------- progress ----------
  let lastSave = 0;
  function save(done = false) {
    const t = time();
    const d = duration();
    if (!d || (!done && t < 5)) return;
    const body = JSON.stringify({ fileId: cur.fileId, t: done ? 0 : t, d, done });
    // Some TV browsers (Chrome 59–80, e.g. 2021 Samsung TVs) throw on a JSON beacon instead
    // of returning false; an uncaught throw here would break leaving the player.
    let sent = false;
    try { sent = !!navigator.sendBeacon?.('/api/progress', new Blob([body], { type: 'application/json' })); } catch {}
    if (!sent) {
      fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
    lastSave = Date.now();
  }
  video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 10_000) save(); });
  window.addEventListener('pagehide', onPageHide);
  function onPageHide() { save(); }

  // ---------- skip intro / next episode ----------
  // info.segments comes from the server: the intro and credits are only marked
  // where they match other episodes (or, for credits, a long black-with-text
  // ending), so these buttons never cover real content. Nothing is skipped
  // unless the viewer presses.
  let segs = info.segments || {};
  // An episode that's still being analysed: check back until its results are in.
  let segPoll = info.segments || !info.episodeLabel ? null : setInterval(async () => {
    const r = await fetch(`/api/segments/${info.fileId}`).then((x) => x.json()).catch(() => null);
    if (r?.segments) {
      segs = r.segments;
      clearInterval(segPoll);
    }
  }, 30_000);
  function updateSkipIntro() {
    const t = time();
    const show = !!segs.intro && t >= segs.intro.start && t < segs.intro.end - 1;
    if (skipBtn.hidden === show) skipBtn.hidden = !show;
  }

  let nextShown = false;
  let creditsReached = false;
  let countdown;
  function maybeShowNext() {
    const t = time();
    const d = duration();
    // Any point inside the credits counts, including after a seek past their start.
    if (segs.credits && !creditsReached && t >= segs.credits.start) {
      creditsReached = true;
      save(true); // the episode counts as watched once the credits roll
      // Auto-advance only when the credits were confirmed by audio; a black ending might be a dark final scene.
      if (info.next && !nextShown) showNext(segs.credits.source !== 'black', 10);
      return;
    }
    if (!info.next || nextShown) return;
    if (!segs.credits && d && d - t < 25 && t > 60) showNext(false);
  }
  function showNext(auto, seconds = 5) {
    nextShown = true;
    const label = h('span', {}, t('Next: {label}', { label: `${epLabel(info.next.label)}${info.next.name ? ` · ${info.next.name}` : ''}` }));
    const play = h('button', { class: 'btn play small', onclick: () => onNext(info.next) }, icon('next'), t('Next episode'));
    nextCard.replaceChildren(label, play, h('button', { class: 'btn info small', onclick: () => { clearInterval(countdown); nextCard.hidden = true; } },
      segs.credits && creditsReached ? t('Watch credits') : t('Hide')));
    nextCard.hidden = false;
    play.focus();
    if (auto) {
      let n = seconds;
      const tickDown = () => {
        play.lastChild.textContent = t('Next episode in {n}', { n });
        if (n-- <= 0) { clearInterval(countdown); onNext(info.next); }
      };
      tickDown();
      countdown = setInterval(tickDown, 1000);
    }
  }
  video.addEventListener('ended', () => {
    save(true);
    if (info.next) showNext(true);
    else onBack();
  });

  // ---------- keyboard / TV remote ----------
  function onKey(e) {
    poke();
    const onControl = e.target.closest?.('button, input, select');
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack') {
      if (e.key === 'Backspace' && onControl?.tagName === 'INPUT') return;
      e.preventDefault();
      if (openMenu) closeMenus();
      else if (document.fullscreenElement) document.exitFullscreen();
      else onBack();
      return;
    }
    if (onControl && ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    switch (e.key) {
      case ' ': case 'k': case 'MediaPlayPause': e.preventDefault(); togglePlay(); break;
      case 'Enter': togglePlay(); break;
      case 'ArrowLeft': case 'j': case 'MediaRewind': e.preventDefault(); seekTo(time() - 10); break;
      case 'ArrowRight': case 'l': case 'MediaFastForward': e.preventDefault(); seekTo(time() + 10); break;
      case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); volume.value = video.volume; break;
      case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); volume.value = video.volume; break;
      case 'f': toggleFullscreen(); break;
      case 'm': video.muted = !video.muted; break;
      case 'c': if (info.subs.length) setSub(subOn ? null : info.subs[0]); break;
      case 'n': if (info.next) onNext(info.next); break;
      case 's': if (!skipBtn.hidden) skipIntro(); break;
    }
  }
  document.addEventListener('keydown', onKey);

  function showToast(text, ms = 2500) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => (toast.hidden = true), ms);
  }

  // ---------- start ----------
  const subPref = prefs.get('subLang');
  const firstSub = subPref === 'off' ? null : info.subs.find((s) => s.label === subPref) || info.subs[0] || null;
  setSub(firstSub, false);
  // The title buffers behind the intro. Some TVs can only run one video at a time: there,
  // loading the title freezes the intro. The player then goes straight to the title and
  // remembers (prefs.oneVideo) to wait for the intro's end on this TV from then on, waking
  // the server up during the intro instead so the title still starts quickly.
  let deferLoad = tvMode && introPlaying && prefs.get('oneVideo', false);
  if (!deferLoad) load(cur, startAt);
  else if (cur.mode === 'direct') {
    signed('stream', cur.fileId, `/stream/${cur.fileId}`)
      .then((src) => fetch(src, { headers: { Range: 'bytes=0-262143' } }))
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }

  // ---------- logo intro ----------
  // The opening of every title started from the beginning (resuming skips it): it plays
  // under the normal controls as if it were part of the file. Play/Pause pauses it, the
  // seek bar and time show the title from 0:00, and seeking or jumping leaves it for
  // that point in the title. When it ends, the title (already buffered) carries on.
  const intro = h('video', { class: 'intro', src: introPlaying ? '/brand/intro.mp4' : null, playsinline: true, preload: 'auto' });
  function endIntro(at = startAt) {
    if (!introPlaying) return;
    introPlaying = false;
    clearTimeout(introGuard);
    intro.pause();
    intro.removeAttribute('src');
    intro.load(); // frees the TV's video decoder for the title
    intro.remove();
    if (deferLoad) {
      spinner.hidden = false;
      load(cur, at);
    } else {
      if (at > 0) seekTo(at);
      video.play().catch(() => {});
    }
    poke();
  }
  // Never let the intro hold the title back (a stalled clip would otherwise never end).
  let introGuard = null;
  const guardIntro = () => { clearTimeout(introGuard); introGuard = setTimeout(() => endIntro(), 10000); };
  intro.addEventListener('ended', () => endIntro());
  intro.addEventListener('error', () => endIntro());
  // A TV that froze the intro once the title started loading can only run one video.
  if (tvMode && !deferLoad) {
    let lastT = -1;
    let still = 0;
    const watchIntro = setInterval(() => {
      if (!introPlaying) return clearInterval(watchIntro);
      if (intro.paused || intro.currentTime < 0.3) return; // not started yet: normal buffering
      still = intro.currentTime === lastT ? still + 1 : 0;
      lastT = intro.currentTime;
      if (still >= 3) { // ~1.5 s without moving
        clearInterval(watchIntro);
        prefs.set('oneVideo', true);
        deferLoad = true; // reload the title once the intro has let go of the decoder
        endIntro();
      }
    }, 500);
  }
  intro.addEventListener('play', () => { guardIntro(); playBtn.replaceChildren(icon('pause')); poke(); });
  intro.addEventListener('pause', () => {
    if (!introPlaying) return;
    clearTimeout(introGuard); // paused on purpose: wait for the viewer
    playBtn.replaceChildren(icon('play'));
    root.classList.remove('idle');
  });
  if (introPlaying) {
    video.after(intro); // over the title's video, under the subtitles and controls
    // Browsers block sound when playback wasn't started by a click (e.g. a shared link): play it muted then.
    intro.play().catch(() => {
      intro.muted = true;
      intro.play().catch(() => endIntro());
    });
  }
  poke();

  return {
    el: root,
    destroy() {
      save();
      cancelAnimationFrame(raf);
      clearTimeout(tapTimer);
      intro.pause();
      intro.removeAttribute('src');
      clearInterval(segPoll);
      clearInterval(countdown);
      clearTimeout(idleTimer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('pagehide', onPageHide);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      video.pause();
      video.removeAttribute('src');
      video.load(); // closes the network stream (and stops the server-side conversion)
    },
  };
}

function parseVtt(text) {
  const toSec = (s) => {
    const p = s.replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->').map((s) => toSec(s.trim().split(/\s+/)[0]));
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body && Number.isFinite(a) && Number.isFinite(b)) cues.push({ start: a, end: b, text: body });
  }
  return cues;
}
