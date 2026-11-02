// Full-screen player.
//   direct    – the original file, streamed with byte ranges. The native player
//               (ExoPlayer) handles MKV, HEVC, AC3 and more, so this is the norm.
//   transcode – the server converts to a chosen height; the stream starts at
//               `offset`, so each seek restarts it from the new time.
// Subtitles are drawn by the app so they work the same in both modes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, findNodeHandle, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useTVEventHandler, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEventListener } from 'expo';
import { setStatusBarHidden } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { Image } from 'expo-image';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { router, useLocalSearchParams } from 'expo-router';
import { api, authHeaders, mediaUrl, saveProgress, stillSource, type Episode, type PlayInfo, type Title } from '../../lib/api';
import { activeCue, parseVtt, type Cue } from '../../lib/vtt';
import { useI18n } from '../../lib/i18n';
import { arabicFont, colors, fmtSize, fmtTime, isTV, s } from '../../lib/theme';
import { Focusable, focusInk } from '../../components/ui';
import { BackIcon, SkipIcon } from '../../components/PlayerIcons';

const WEB_VIDEO_CAST = 'com.instantbits.cast.webvideo';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

type Menu = null | 'quality' | 'subs' | 'speed' | 'episodes';
type Option = { key: string; mode: 'direct' | 'transcode'; fileId: string; height: number | null; label: string; note: string };

// Remembered on this device, as on the website: the chosen quality (a height) and the
// subtitle language (a track label, or 'off'). Speed isn't remembered.
type Prefs = { quality: number | null; subLang: string | null };
let prefsCache: Prefs | null = null;
async function loadPrefs(): Promise<Prefs> {
  if (prefsCache) return prefsCache;
  const [q, sub] = await Promise.all([SecureStore.getItemAsync('prefQuality').catch(() => null), SecureStore.getItemAsync('prefSubLang').catch(() => null)]);
  prefsCache = { quality: q ? Number(q) || null : null, subLang: sub };
  return prefsCache;
}
function savePref(key: 'quality' | 'subLang', value: string) {
  if (prefsCache) prefsCache = { ...prefsCache, [key]: key === 'quality' ? Number(value) || null : value };
  SecureStore.setItemAsync(key === 'quality' ? 'prefQuality' : 'prefSubLang', value).catch(() => {});
}

export default function Watch() {
  const { fileId, from } = useLocalSearchParams<{ fileId: string; from?: string }>();
  const [info, setInfo] = useState<PlayInfo | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(prefsCache);
  const [error, setError] = useState('');
  const { f } = useI18n();

  useEffect(() => {
    api<PlayInfo>(`/api/play/${fileId}`).then(setInfo).catch((e) => setError(e.message));
  }, [fileId]);
  useEffect(() => { loadPrefs().then(setPrefs); }, []);

  // Full screen while watching: hide Android's status bar and navigation buttons
  // (a swipe from the edge shows them for a moment), and bring them back on the way out.
  useEffect(() => {
    if (Platform.OS !== 'android' || isTV) return;
    setStatusBarHidden(true, 'fade');
    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    return () => {
      setStatusBarHidden(false, 'fade');
      NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, []);

  if (!info || !prefs) {
    return (
      <View style={styles.black}>
        {error ? <Text style={[styles.msg, f('regular')]}>{error}</Text> : <ActivityIndicator color={colors.red} size="large" />}
      </View>
    );
  }
  return <Player key={info.fileId} info={info} prefs={prefs} startAt={from !== undefined ? Number(from) || 0 : info.resumeAt} />;
}

function Player({ info, prefs, startAt }: { info: PlayInfo; prefs: Prefs; startAt: number }) {
  const { t: tr, f, ta, isRTL, season: tSeason, episodeLabel } = useI18n();
  // The controls (seek bar, ±10, time) stay left-to-right in Arabic so the bar fills the same
  // way and ◀/▶ on the remote match; text areas (top bar, buttons, menus) flip back to RTL.
  const rtl = isRTL ? styles.rtl : null;
  // Every original, then conversions at each standard height up to the source's (as on the
  // website); the top conversion is the fallback for an original this device can't play.
  const sourceH = Math.max(0, ...info.versions.map((v) => v.height || 0)) || 1080;
  const options = useMemo<Option[]>(() => [
    ...info.versions.map((v) => ({
      key: `v:${v.id}`, mode: 'direct' as const, fileId: v.id, height: v.height,
      label: v.height ? `${v.height}p` : tr('player.original'),
      note: [tr('player.original'), info.versions.length > 1 ? v.ext.toUpperCase() : '', fmtSize(v.size)].filter(Boolean).join(' · '),
    })),
    ...info.transcodeHeights.filter((h) => h <= Math.max(sourceH, 360)).map((h) => ({
      key: `t:${h}`, mode: 'transcode' as const, fileId: info.versions[0].id, height: h, label: `${h}p`,
      note: h >= Math.min(sourceH, 1080) ? tr('player.convertedFallback') : tr('player.convertedSaves'),
    })),
  ].sort((a, b) => (b.height || 0) - (a.height || 0) || (a.mode === 'direct' ? -1 : 1)), [info, sourceH, tr]);

  // The remembered quality if this title has it (an original at that height, or a smaller
  // conversion), otherwise the file that was opened.
  const [cur, setCur] = useState<Option>(() => {
    const q = prefs.quality;
    return (q && options.find((o) => o.mode === 'direct' && o.height === q))
      || (q && q < sourceH && options.find((o) => o.height === q))
      || options.find((o) => o.mode === 'direct' && o.fileId === info.fileId) || options[0];
  });
  const offset = useRef(cur.mode === 'transcode' ? startAt : 0); // a conversion starts at `offset`
  const pendingSeek = useRef(cur.mode === 'direct' ? startAt : 0);
  const [t, setT] = useState(startAt);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [speed, setSpeed] = useState(1);
  const [episodes, setEpisodes] = useState<Title['seasons'] | null>(null);
  // The Episodes panel opens on the season being watched ("S2:E1" -> 2).
  const [epSeason, setEpSeason] = useState<number | null>(null);
  const shownSeason = epSeason ?? Number(info.episodeLabel?.match(/^S(\d+)/)?.[1] ?? 1);
  const [toast, setToast] = useState('');
  const [loadedCues, setLoadedCues] = useState<{ id: string; cues: Cue[] } | null>(null);
  // Subtitles: the remembered language, none if it was 'Off', otherwise the first track (as on the website).
  const [sub, setSub] = useState<{ id: string; label: string } | null>(() =>
    prefs.subLang === 'off' ? null : info.subs.find((x) => x.label === prefs.subLang) || info.subs[0] || null);
  const [nextShown, setNextShown] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const creditsReached = useRef(false);
  const lastSave = useRef(0);

  // The DriveStream logo intro plays first when a title starts from the beginning (not when
  // resuming), as the opening of the title: it sits in the video's place under the normal
  // controls, and the title loads and buffers (paused) behind it, then carries on when it ends.
  // The clip is streamed from the server, so it can be swapped without an app update.
  const win = useWindowDimensions();
  const tapRef = useRef<{ at: number; side: number; total: number; timer?: ReturnType<typeof setTimeout>; fxTimer?: ReturnType<typeof setTimeout> }>({ at: 0, side: 0, total: 0 });
  const [tapFx, setTapFx] = useState<{ side: number; total: number } | null>(null);
  const [logo, setLogo] = useState(startAt < 1);
  const logoRef = useRef(startAt < 1);
  // Paused on purpose (Play/Pause): the intro waits for the viewer, without the 10 s guard.
  const [logoPaused, setLogoPaused] = useState(false);
  const logoPausedRef = useRef(false);
  const [initialSource] = useState<VideoSource>(() => ({
    uri: mediaUrl(cur.mode === 'direct' ? `/stream/${cur.fileId}` : `/transcode/${cur.fileId}?h=${cur.height}&t=${startAt.toFixed(1)}`),
    headers: authHeaders(),
  }));
  const player = useVideoPlayer(initialSource, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.keepScreenOnWhilePlaying = true;
    if (startAt >= 1) p.play();
  });
  // Its source goes to null once it's over, which frees the decoder for the title.
  const intro = useVideoPlayer(logo ? { uri: mediaUrl('/brand/intro.mp4') } : null, (p) => { if (logoRef.current) p.play(); });

  const durationOf = () => (cur.mode === 'direct' && player.duration > 0 ? player.duration : (info.durationMs || 0) / 1000);
  const timeNow = () => (cur.mode === 'direct' ? player.currentTime : offset.current + player.currentTime);

  const load = useCallback((opt: Option, at: number) => {
    at = Math.max(0, at || 0);
    const headers = authHeaders();
    let source: VideoSource;
    if (opt.mode === 'direct') {
      offset.current = 0;
      pendingSeek.current = at;
      source = { uri: mediaUrl(`/stream/${opt.fileId}`), headers };
    } else {
      offset.current = at;
      pendingSeek.current = 0;
      source = { uri: mediaUrl(`/transcode/${opt.fileId}?h=${opt.height}&t=${at.toFixed(1)}`), headers };
    }
    setCur(opt);
    setLoading(true);
    player.replaceAsync(source).then(() => { if (!logoRef.current) player.play(); });
  }, [player]);

  // ---------- subtitles ----------
  useEffect(() => {
    if (!sub) return;
    let live = true;
    fetch(mediaUrl(`/subs/${sub.id}`), { headers: authHeaders() })
      .then((r) => r.text())
      .then((txt) => live && setLoadedCues({ id: sub.id, cues: parseVtt(txt) }))
      .catch(() => live && flash(tr('player.subsFailed')));
    return () => { live = false; };
  }, [sub, tr]);
  const cues = sub && loadedCues?.id === sub.id ? loadedCues.cues : [];

  // ---------- player events ----------
  useEventListener(player, 'statusChange', ({ status, error: err }) => {
    if (status === 'readyToPlay') {
      setLoading(false);
      if (pendingSeek.current > 0) {
        player.currentTime = pendingSeek.current;
        pendingSeek.current = 0;
      }
    } else if (status === 'loading') setLoading(true);
    else if (status === 'error') {
      setLoading(false);
      // The original couldn't be decoded on this device: fall back to a server conversion.
      if (cur.mode === 'direct' && info.transcodeHeights.length) {
        const h = Math.min(Math.max(...info.versions.map((v) => v.height || 0)) || 1080, 1080);
        flash(tr('player.cantPlay'));
        load({ key: `t:${h}`, mode: 'transcode', fileId: info.versions[0].id, height: h, label: `${h}p`, note: tr('player.converted') }, timeNow() || startAt);
      } else flash(err?.message || tr('player.failed'));
    }
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setPlaying(isPlaying);
    if (!isPlaying) save();
  });
  useEventListener(player, 'timeUpdate', ({ currentTime, bufferedPosition }) => {
    const now = cur.mode === 'direct' ? currentTime : offset.current + currentTime;
    setT(now);
    setBuffered((cur.mode === 'direct' ? 0 : offset.current) + (bufferedPosition || 0));
    if (Date.now() - lastSave.current > 10_000 && now > 5) save();
    checkSegments(now);
  });
  useEventListener(player, 'playToEnd', () => {
    save(true);
    if (info.next) showNext(5);
    else router.back();
  });

  // Never below 5 s unless finished (the same rule as the 10 s save while playing).
  function save(done = false) {
    const d = durationOf();
    if (!d || (!done && timeNow() < 5)) return;
    lastSave.current = Date.now();
    saveProgress(cur.fileId, timeNow(), d, done);
  }
  useEffect(() => () => save(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- skip intro / next episode ----------
  // An episode that's still being analysed on the server: check back until its results are in.
  const [lateSegs, setLateSegs] = useState<PlayInfo['segments']>(null);
  useEffect(() => {
    if (info.segments || !info.episodeLabel) return;
    const id = setInterval(async () => {
      const r = await api<{ segments: PlayInfo['segments'] }>(`/api/segments/${info.fileId}`).catch(() => null);
      if (r?.segments) {
        setLateSegs(r.segments);
        clearInterval(id);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [info]);
  const segs = info.segments || lateSegs || { intro: null, credits: null };
  const segsRef = useRef(segs);
  segsRef.current = segs; // player event callbacks read the latest value
  const inIntro = !logo && !!segs.intro && t >= segs.intro.start && t < segs.intro.end - 1;

  function checkSegments(now: number) {
    const { credits } = segsRef.current;
    // Any point inside the credits counts, including after a seek past their start.
    if (credits && !creditsReached.current && now >= credits.start) {
      creditsReached.current = true;
      save(true); // counts as watched once the credits roll
      // Auto-advance only when the credits were confirmed by audio; a black ending might be a dark final scene.
      if (info.next) {
        if (credits.source === 'black') setNextShown(true);
        else showNext(10);
      }
      return;
    }
    const d = durationOf();
    if (!credits && info.next && !nextShown && d && d - now < 25 && now > 60) setNextShown(true);
  }
  function showNext(seconds: number) {
    setNextShown(true);
    setCountdown(seconds);
  }
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) return void goNext();
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps
  const goNext = () => info.next && router.replace(`/watch/${info.next.fileId}?from=0`);

  // ---------- cast ----------
  // Hands a signed, self-contained link to Web Video Cast, which casts to Chromecast,
  // Fire TV, Roku, DLNA and smart TVs. The link works for a few hours, for this video only.
  async function castNow() {
    let c: { url: string; title: string; mimeType: string; poster: string | null; subtitles: { label: string; url: string }[] };
    try {
      c = await api(`/api/cast/${cur.mode === 'direct' ? cur.fileId : info.versions[0].id}`);
    } catch (e: any) {
      return flash(e.message);
    }
    player.pause();
    save();
    const extra: Record<string, string> = { title: c.title };
    if (c.poster) extra.poster = c.poster;
    const subtitle = c.subtitles.find((x) => x.label === sub?.label) || (sub ? c.subtitles[0] : undefined);
    if (subtitle) extra.subtitle = subtitle.url;
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: c.url, type: c.mimeType, packageName: WEB_VIDEO_CAST, extra });
    } catch {
      flash(tr('player.installCast'));
      Linking.openURL(`market://details?id=${WEB_VIDEO_CAST}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${WEB_VIDEO_CAST}`));
    }
  }

  // ---------- speed / episodes ----------
  function changeSpeed(v: number) {
    setSpeed(v);
    player.playbackRate = v;
  }
  async function openEpisodes() {
    setMenu('episodes');
    if (!episodes) {
      const t = await api<Title>(`/api/title/${info.item.id}`).catch(() => null);
      setEpisodes(t?.seasons || []);
    }
  }

  // ---------- controls ----------
  // Controls appear on any interaction and hide after 4 s of quiet while playing;
  // they always show while paused or while a menu is open.
  const [activity, setActivity] = useState(0);
  const poke = useCallback(() => {
    setControls(true);
    setActivity((a) => a + 1);
  }, []);
  // During the logo intro, "playing" is the intro's state.
  const playingNow = logo ? !logoPaused : playing;
  useEffect(() => {
    if (!playingNow || menu || !controls) return;
    const id = setTimeout(() => {
      setControls(false);
      setPreferBar(false);
    }, 4000);
    return () => clearTimeout(id);
  }, [playingNow, menu, controls, activity]);
  const showControls = controls || !playingNow || !!menu;

  function seekTo(target: number) {
    const d = durationOf();
    target = Math.max(0, d ? Math.min(target, d - 1) : target);
    // During the logo intro, seeking forward leaves it for that point in the title;
    // back to the start replays it.
    if (logoRef.current) {
      if (target > 0) return endLogo(target);
      intro.currentTime = 0;
      return poke();
    }
    setT(target);
    if (cur.mode === 'direct') player.currentTime = target;
    else load(cur, target);
    poke();
  }
  function togglePlay() {
    if (!logoRef.current) return void (player.playing ? player.pause() : player.play());
    // During the logo intro, Play/Pause drives the intro.
    const pause = !logoPausedRef.current;
    logoPausedRef.current = pause;
    setLogoPaused(pause);
    if (pause) intro.pause();
    else intro.play();
  }

  // ---------- logo intro ----------
  // Ends the intro and carries on with the title (already buffered) from `at`.
  function endLogo(at = 0) {
    if (!logoRef.current) return;
    logoRef.current = false;
    setLogo(false);
    intro.pause();
    if (at > 0) seekTo(at);
    player.play();
    poke();
  }
  useEventListener(intro, 'playToEnd', () => endLogo());
  useEventListener(intro, 'statusChange', ({ status }) => { if (status === 'error') endLogo(); });
  const endLogoRef = useRef(endLogo);
  endLogoRef.current = endLogo;
  // Never let the intro hold the title back: it gives up after 10 s of playing (paused on
  // purpose doesn't count), or when it stops moving for ~1.5 s while it should be playing
  // (some TVs freeze it once the title starts loading behind it).
  useEffect(() => {
    if (!logo) return;
    let played = 0;
    let lastPos = -1;
    let moved = false;
    let still = 0;
    const id = setInterval(() => {
      if (intro.playing) played += 500;
      const pos = intro.currentTime;
      if (logoPausedRef.current) still = 0;
      else {
        still = pos === lastPos ? still + 500 : 0;
        if (pos > 0 && pos !== lastPos) moved = true;
      }
      lastPos = pos;
      // Before its first frame, allow the clip as long as the guard to start.
      if (played >= 10_000 || still >= (moved ? 1500 : 10_000)) endLogoRef.current();
    }, 500);
    return () => clearInterval(id);
  }, [logo, intro]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  // ---------- TV scrubbing ----------
  // On the progress bar, ◀/▶ move a scrub marker instead of seeking straight away.
  // Steps grow with quick repeated presses (presses 1–3: 10 s, 4–8: 30 s, 9–16: 1 min, then
  // 2 min), and holding a button repeats with the same steps. OK jumps there; otherwise it
  // jumps by itself 1.5 s after the last press.
  const [scrubT, setScrubT] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const [barFocused, setBarFocused] = useState(false);
  // ◀/▶ on the progress bar only scrub: point its left/right focus neighbours at itself,
  // or Android TV moves focus off the bar (to the Back button) on the first press.
  const barRef = useRef<React.ComponentRef<typeof View>>(null);
  const [barTag, setBarTag] = useState<number | undefined>(undefined);
  const [preferBar, setPreferBar] = useState(false);
  const streak = useRef({ last: 0, n: 0, dir: 0 });
  const holdTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function scrubStep(dir: -1 | 1, n: number) {
    const step = n < 3 ? 10 : n < 8 ? 30 : n < 16 ? 60 : 120;
    const d = durationOf();
    const next = Math.max(0, Math.min(d ? d - 1 : Infinity, (scrubRef.current ?? timeNow()) + dir * step));
    scrubRef.current = next;
    setScrubT(next);
    poke();
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commitScrub, 1500);
  }
  function scrubTap(dir: -1 | 1) {
    const now = Date.now();
    const st = streak.current;
    st.n = now - st.last < 600 && st.dir === dir ? st.n + 1 : 0;
    st.last = now;
    st.dir = dir;
    scrubStep(dir, st.n);
  }
  function scrubHold(dir: -1 | 1, down: boolean) {
    clearInterval(holdTimer.current);
    if (!down) return;
    let n = 0;
    scrubStep(dir, n);
    holdTimer.current = setInterval(() => scrubStep(dir, ++n), 180);
  }
  function commitScrub() {
    clearTimeout(commitTimer.current);
    clearInterval(holdTimer.current);
    const target = scrubRef.current;
    scrubRef.current = null;
    setScrubT(null);
    if (target !== null) seekTo(target);
  }
  useEffect(() => () => { clearInterval(holdTimer.current); clearTimeout(commitTimer.current); }, []);

  // TV remote. While the controls are hidden an invisible full-screen catcher holds focus
  // (without it Android TV has nothing to send key presses to, which is why the
  // controls used to never come back). OK on the catcher plays/pauses; ◀/▶ open the
  // controls straight into scrubbing on the progress bar; any key brings the controls back.
  // With controls showing, OK presses the focused button: the big Play/Pause by default.
  // Rewind / Fast-forward on the remote jump 10 s.
  useTVEventHandler((evt) => {
    if (!evt) return;
    const type = evt.eventType;
    if (type === 'blur' || type === 'focus') return;
    if (menu) return;
    const down = Number(evt.eventKeyAction) === 0; // long presses report down (start) and up (release)
    if (type === 'rewind' || type === 'fastForward') {
      if (Number(evt.eventKeyAction) !== 1) seekTo(timeNow() + (type === 'rewind' ? -10 : 10)); // not again on release
      return void poke();
    }
    const dir = type === 'left' || type === 'longLeft' ? -1 : type === 'right' || type === 'longRight' ? 1 : 0;
    if (dir && (!showControls || barFocused)) {
      if (!showControls) setPreferBar(true);
      if (type === 'longLeft' || type === 'longRight') scrubHold(dir, down);
      else scrubTap(dir);
    }
    // OK with the controls hidden plays/pauses (and brings the controls back); with them showing,
    // OK presses whichever button has focus instead.
    if (type === 'playPause' || (type === 'select' && !showControls)) togglePlay();
    poke();
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { setMenu(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [menu]);

  const d = durationOf();
  // Where the progress bar points: the scrub marker while scrubbing; the title's 0:00 during the logo intro.
  const shown = scrubT ?? (logo ? 0 : t);
  const caption = sub ? activeCue(cues, t) : '';
  const [barW, setBarW] = useState(1);
  const onBarPress = (e: GestureResponderEvent) => seekTo((e.nativeEvent.locationX / barW) * d);

  // One tap shows/hides the controls; a double tap on the left or right half jumps 10 s,
  // and every further quick tap adds another 10 s.
  const onSurfaceTap = (e: GestureResponderEvent) => {
    const side = e.nativeEvent.pageX < win.width / 2 ? -1 : 1;
    const now = Date.now();
    const tap = tapRef.current;
    const quick = now - tap.at < 350 && side === tap.side;
    tap.at = now;
    tap.side = side;
    clearTimeout(tap.timer);
    if (!quick) {
      tap.total = 0;
      tap.timer = setTimeout(() => (showControls ? setControls(false) : poke()), 350);
      return;
    }
    tap.total += 10;
    seekTo(timeNow() + side * 10);
    setTapFx({ side, total: tap.total });
    clearTimeout(tap.fxTimer);
    tap.fxTimer = setTimeout(() => setTapFx(null), 700);
  };

  const title = info.episodeLabel ? `${info.item.title}  ${episodeLabel(info.episodeLabel)}${info.episodeName ? ` · ${info.episodeName}` : ''}` : info.item.title;

  return (
    <View style={[styles.black, styles.ltr]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
      {logo ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <VideoView player={intro} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
        </View>
      ) : null}
      <Pressable style={StyleSheet.absoluteFill} onPress={onSurfaceTap} focusable={false} />
      {tapFx ? (
        <Text pointerEvents="none" style={[styles.tapSeek, tapFx.side < 0 ? { left: '12%' } : { right: '12%' }]}>
          {tapFx.side < 0 ? `« ${tr('player.seconds', { n: tapFx.total })}` : `${tr('player.seconds', { n: tapFx.total })} »`}
        </Text>
      ) : null}

      {caption ? (
        <View pointerEvents="none" style={[styles.subs, { bottom: showControls ? s(110) : s(36) }]}>
          {caption.split('\n').map((l, i) => <Text key={i} style={[styles.subLine, ARABIC.test(l) && styles.subLineArabic]}>{l}</Text>)}
        </View>
      ) : null}
      {loading && !logo ? <ActivityIndicator style={styles.spinner} color={colors.red} size="large" /> : null}
      {toast ? <Text style={[styles.toast, f('regular')]}>{toast}</Text> : null}

      {inIntro && !menu ? (
        <Focusable style={[styles.skip, isRTL ? { left: s(24) } : { right: s(24) }, { bottom: showControls ? s(110) : s(36) }]} hasTVPreferredFocus onPress={() => seekTo(segs.intro!.end)}>
          {(focused) => <Text style={[styles.skipText, f('medium'), focused && focusInk]}>{tr('player.skipIntro')}</Text>}
        </Focusable>
      ) : null}

      {nextShown && info.next && !menu ? (
        <View style={[styles.nextCard, rtl, isRTL ? { left: s(24) } : { right: s(24) }, { bottom: showControls ? s(110) : s(36) }]}>
          <Text style={[styles.nextLabel, f('medium'), ta]} numberOfLines={1}>{tr('player.next', { label: episodeLabel(info.next.label) })}{info.next.name ? ` · ${info.next.name}` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: s(8) }}>
            <Focusable style={styles.nextBtn} hasTVPreferredFocus onPress={goNext}>
              <Text style={[styles.nextBtnText, f('medium')]}>▶ {countdown !== null ? tr('player.nextIn', { n: countdown }) : tr('player.nextBtn')}</Text>
            </Focusable>
            <Focusable style={styles.ghostBtn} onPress={() => { setCountdown(null); setNextShown(false); }}>
              {(focused) => <Text style={[styles.ghostText, f('medium'), focused && focusInk]}>{creditsReached.current ? tr('player.watchCredits') : tr('player.hide')}</Text>}
            </Focusable>
          </View>
        </View>
      ) : null}

      {/* TV: invisible focus target while the controls are hidden (see the remote handler above). */}
      {isTV && !showControls && !inIntro && !nextShown ? (
        <Pressable style={StyleSheet.absoluteFill} focusable hasTVPreferredFocus />
      ) : null}

      {showControls ? (
        <>
          <View style={[styles.topBar, rtl]}>
            <Focusable style={styles.ctl} onPress={() => router.back()} accessibilityLabel={tr('player.back')}>{(focused) => <BackIcon size={s(30)} flip={isRTL} color={focused ? '#000' : '#fff'} />}</Focusable>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {!isTV ? <Focusable style={styles.ctl} onPress={castNow} accessibilityLabel={tr('player.castA11y')}>{(focused) => <Text style={[styles.castText, f('medium'), focused && styles.castTextFocus]}>{tr('player.cast')}</Text>}</Focusable> : <View style={styles.ctl} />}
          </View>

          {/* Middle of the screen: back 10 · play/pause · forward 10 */}
          <View style={styles.center} pointerEvents="box-none">
            <Focusable style={styles.jump} focusStyle={styles.roundFocus} onPress={() => seekTo(t - 10)} accessibilityLabel={tr('player.back10')}>
              {(focused) => <SkipIcon dir="back" size={s(52)} color={focused ? '#000' : '#fff'} />}
            </Focusable>
            <Focusable style={styles.bigPlay} focusStyle={styles.roundFocus} hasTVPreferredFocus={!inIntro && !nextShown && !preferBar}
              onPress={() => { togglePlay(); poke(); }} accessibilityLabel={playingNow ? tr('player.pause') : tr('player.play')}>
              {(focused) => <Text style={[styles.bigPlayText, !playingNow && { marginLeft: s(6) }, focused && focusInk]}>{playingNow ? '❚❚' : '▶'}</Text>}
            </Focusable>
            <Focusable style={styles.jump} focusStyle={styles.roundFocus} onPress={() => seekTo(t + 10)} accessibilityLabel={tr('player.fwd10')}>
              {(focused) => <SkipIcon dir="forward" size={s(52)} color={focused ? '#000' : '#fff'} />}
            </Focusable>
          </View>

          <View style={styles.bottom}>
            <View style={styles.seekRow}>
              {/* Phones: tap anywhere on the bar. TV: focus it, then ◀/▶ scrub and OK jumps. */}
              <Pressable ref={barRef} style={[styles.barHit, isTV && barFocused && styles.barFocused]} focusable={isTV} hasTVPreferredFocus={isTV && preferBar}
                nextFocusLeft={barTag} nextFocusRight={barTag}
                onFocus={() => setBarFocused(true)} onBlur={() => setBarFocused(false)}
                onPress={isTV ? () => (scrubRef.current !== null ? commitScrub() : togglePlay()) : onBarPress}
                onLayout={(e) => { setBarW(e.nativeEvent.layout.width); setBarTag(findNodeHandle(barRef.current) ?? undefined); }}>
                <View style={[styles.barTrack, isTV && barFocused && styles.barTrackFocused]}>
                  <View style={[styles.barBuf, { width: `${d ? Math.min(100, (buffered / d) * 100) : 0}%` }]} />
                  <View style={[styles.barPlayed, { width: `${d ? Math.min(100, (shown / d) * 100) : 0}%` }]} />
                </View>
                <View style={[styles.barKnob, isTV && barFocused && styles.barKnobFocused, { left: `${d ? Math.min(100, (shown / d) * 100) : 0}%` }]} />
                {scrubT !== null ? (
                  <Text style={[styles.scrubTime, { left: `${d ? Math.min(100, (scrubT / d) * 100) : 0}%` }]}>{fmtTime(scrubT)}</Text>
                ) : null}
              </Pressable>
              <Text style={styles.time}>{fmtTime(Math.max(0, d - shown))}</Text>
            </View>
            <View style={[styles.ctlRow, rtl]}>
              <BarButton icon="⏲" label={tr('player.speed', { v: speed })} onPress={() => setMenu('speed')} />
              {info.episodeLabel ? <BarButton icon="☰" label={tr('player.episodes')} onPress={openEpisodes} /> : null}
              {info.subs.length ? <BarButton icon="CC" label={sub ? tr('player.subtitlesOn', { label: sub.label }) : tr('player.subtitles')} onPress={() => setMenu('subs')} /> : null}
              <BarButton icon="HD" label={tr('player.qualityOn', { label: cur.label })} onPress={() => setMenu('quality')} />
              {info.next ? <BarButton icon="⏭" label={tr('player.nextEpisode')} onPress={goNext} /> : null}
            </View>
          </View>
        </>
      ) : null}

      {menu && menu !== 'episodes' ? (
        <View style={[styles.menuBackdrop, rtl]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} focusable={false} />
          <View style={styles.menu}>
            <Text style={[styles.menuTitle, f('bold')]}>{menu === 'quality' ? tr('player.quality') : menu === 'subs' ? tr('player.subtitles') : tr('player.playbackSpeed')}</Text>
            <ScrollView>
              {menu === 'quality'
                ? options.map((o) => (
                    <MenuItem key={o.key} on={o.key === cur.key} label={o.label} note={o.note}
                      onPress={() => {
                        setMenu(null);
                        savePref('quality', String(o.height ?? ''));
                        if (o.key !== cur.key) { flash(tr('player.switching', { label: o.label })); load(o, timeNow()); }
                      }} />
                  ))
                : menu === 'subs'
                  ? [null, ...info.subs].map((x) => (
                      <MenuItem key={x?.id || 'off'} on={x?.id === sub?.id} label={x ? x.label : tr('player.off')}
                        onPress={() => { setMenu(null); setSub(x); savePref('subLang', x ? x.label : 'off'); }} />
                    ))
                  : SPEEDS.map((v) => (
                      <MenuItem key={v} on={v === speed} label={v === 1 ? tr('player.normal') : `${v}x`}
                        onPress={() => { setMenu(null); changeSpeed(v); }} />
                    ))}
            </ScrollView>
            {menu === 'quality' && !info.transcodeHeights.length ? <Text style={[styles.menuNote, f('regular'), ta]}>{tr('player.noFfmpeg')}</Text> : null}
            <Focusable style={styles.ghostBtn} onPress={() => setMenu(null)}>{(focused) => <Text style={[styles.ghostText, f('medium'), focused && focusInk]}>{tr('common.close')}</Text>}</Focusable>
          </View>
        </View>
      ) : null}

      {menu === 'episodes' ? (
        <View style={[styles.menuBackdrop, rtl]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} focusable={false} />
          <View style={styles.episodes}>
            <View style={styles.episodesHead}>
              <Text style={styles.menuTitle}>{info.item.title}</Text>
              <Focusable style={styles.ghostBtn} onPress={() => setMenu(null)}>{(focused) => <Text style={[styles.ghostText, f('medium'), focused && focusInk]}>{tr('common.close')}</Text>}</Focusable>
            </View>
            {!episodes ? <ActivityIndicator color={colors.red} /> : (
              <>
                {episodes.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonTabs} contentContainerStyle={{ gap: s(8), paddingVertical: s(4), alignItems: 'center' }}>
                    {episodes.map((x) => (
                      <Focusable key={x.season} onPress={() => setEpSeason(x.season)}
                        style={[styles.seasonTab, x.season === shownSeason && styles.seasonTabOn]}>
                        {(focused) => <Text style={[styles.seasonTabText, f('medium'), (x.season === shownSeason || focused) && focusInk]}>{tSeason(x.name)}</Text>}
                      </Focusable>
                    ))}
                  </ScrollView>
                ) : null}
                <ScrollView>
                  {(episodes.find((x) => x.season === shownSeason) || episodes[0]).episodes.map((e) => (
                    <EpisodeRow key={e.fileId} e={e} current={info.versions.some((v) => v.id === e.fileId)}
                      onPress={() => { setMenu(null); if (!info.versions.some((v) => v.id === e.fileId)) router.replace(`/watch/${e.fileId}`); }} />
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function BarButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { f } = useI18n();
  return (
    <Focusable style={styles.barBtn} onPress={onPress}>
      {(focused) => (
        <>
          <Text style={[styles.barBtnIcon, focused && focusInk]}>{icon}</Text>
          <Text style={[styles.barBtnLabel, f('medium'), focused && focusInk]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Focusable>
  );
}

function EpisodeRow({ e, current, onPress }: { e: Episode; current: boolean; onPress: () => void }) {
  const { t, f, ta } = useI18n();
  const still = stillSource(e);
  return (
    <Focusable style={[styles.epRow, current && styles.epCurrent]} focusStyle={styles.rowFocus} onPress={onPress} hasTVPreferredFocus={current}>
      {(focused) => (<>
      <View style={styles.epImg}>
        {still ? <Image source={still} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {e.progress ? <View style={styles.epBar}><View style={[styles.epBarFill, { width: `${Math.round(e.progress * 100)}%` }]} /></View> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.epName, ta, focused && focusInk]} numberOfLines={1}>{e.episode}. {e.name}{current ? t('player.nowPlaying') : ''}</Text>
        {e.overview ? <Text style={[styles.epText, f('regular'), ta, focused && styles.inkMuted]} numberOfLines={2}>{e.overview}</Text> : null}
      </View>
      </>)}
    </Focusable>
  );
}

function MenuItem({ label, note, on, onPress }: { label: string; note?: string; on: boolean; onPress: () => void; first?: boolean }) {
  const { f } = useI18n();
  return (
    <Focusable style={styles.menuItem} focusStyle={styles.rowFocus} onPress={onPress} hasTVPreferredFocus={on}>
      {(focused) => (
        <>
          <Text style={[styles.menuCheck, focused && focusInk]}>{on ? '✓' : ''}</Text>
          <View>
            <Text style={[styles.menuLabel, f('medium'), on && { color: '#fff', fontWeight: '800' }, on && f('bold'), focused && focusInk]}>{label}</Text>
            {note ? <Text style={[styles.menuItemNote, f('regular'), focused && styles.inkMuted]}>{note}</Text> : null}
          </View>
        </>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  ltr: { direction: 'ltr' },
  rtl: { direction: 'rtl' },
  msg: { color: '#fff', fontSize: s(16), padding: 20, textAlign: 'center' },
  spinner: { position: 'absolute', alignSelf: 'center', top: '45%' },
  tapSeek: { position: 'absolute', top: '45%', color: '#fff', fontSize: s(20), fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: s(22), paddingVertical: s(12), borderRadius: s(40), overflow: 'hidden' },
  toast: { position: 'absolute', top: s(24), alignSelf: 'center', backgroundColor: 'rgba(38,38,38,0.95)', color: '#fff', paddingHorizontal: s(16), paddingVertical: s(8), borderRadius: 4, fontSize: s(14) },
  subs: { position: 'absolute', left: '6%', right: '6%', alignItems: 'center' },
  subLineArabic: { fontFamily: arabicFont, fontWeight: 'normal', writingDirection: 'rtl' }, // the font file is already bold
  subLine: { color: '#fff', fontSize: s(isTV ? 28 : 20), fontWeight: '600', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, textShadowColor: '#000', textShadowRadius: 4, writingDirection: 'auto' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: s(10), padding: s(14), backgroundColor: 'rgba(0,0,0,0.45)' },
  title: { color: '#fff', fontSize: s(16), fontWeight: '700', flex: 1, textAlign: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: s(18), paddingBottom: s(14), paddingTop: s(20), backgroundColor: 'rgba(0,0,0,0.55)' },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: s(12) },
  barHit: { flex: 1, height: s(26), justifyContent: 'center' },
  barFocused: { paddingVertical: s(4) },
  barTrackFocused: { height: s(8) },
  barKnobFocused: { width: s(22), height: s(22), borderRadius: s(11), marginLeft: -s(11), borderWidth: 3, borderColor: '#fff' },
  scrubTime: { position: 'absolute', bottom: s(26), width: s(80), marginLeft: -s(40), textAlign: 'center', color: '#fff', fontSize: s(16), fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 4, paddingVertical: 2 },
  barKnob: { position: 'absolute', width: s(14), height: s(14), borderRadius: s(7), marginLeft: -s(7), backgroundColor: colors.red },
  barTrack: { height: s(5), backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' },
  barBuf: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.4)' },
  barPlayed: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.red },
  time: { color: '#ddd', fontSize: s(13), fontVariant: ['tabular-nums'] },
  ctlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: s(isTV ? 18 : 6), marginTop: s(8) },
  ctl: { minWidth: s(46), height: s(42), paddingHorizontal: s(8), alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(isTV ? 70 : 48) },
  bigPlay: { width: s(84), height: s(84), borderRadius: s(42), alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  bigPlayText: { color: '#fff', fontSize: s(40), fontWeight: '800' },
  jump: { width: s(60), height: s(60), borderRadius: s(30), alignItems: 'center', justifyContent: 'center' },
  seasonTabs: { flexGrow: 0, flexShrink: 0, minHeight: s(46) },
  seasonTab: { paddingHorizontal: s(14), paddingVertical: s(6), borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  seasonTabOn: { backgroundColor: '#fff', borderColor: '#fff' },
  seasonTabText: { color: '#fff', fontWeight: '700', fontSize: s(14) },
  roundFocus: { transform: [{ scale: 1.1 }] },
  rowFocus: { transform: [{ scale: 1.02 }] }, // full-width rows only grow a little
  inkMuted: { color: '#333' },
  barBtn: { flexDirection: 'row', alignItems: 'center', gap: s(6), paddingHorizontal: s(10), paddingVertical: s(6), borderRadius: 6 },
  barBtnIcon: { color: '#fff', fontSize: s(14), fontWeight: '900' },
  barBtnLabel: { color: '#fff', fontSize: s(13), fontWeight: '600' },
  episodes: { width: '92%', maxWidth: s(640), maxHeight: '88%', backgroundColor: '#1c1c1c', borderRadius: 8, padding: s(16), gap: s(8) },
  episodesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s(10) },
  seasonName: { color: '#bbb', fontSize: s(14), fontWeight: '800', marginTop: s(10), marginBottom: s(4) },
  epRow: { flexDirection: 'row', alignItems: 'center', gap: s(12), padding: s(8), borderRadius: 6 },
  epCurrent: { backgroundColor: 'rgba(255,255,255,0.08)' },
  epImg: { width: s(120), aspectRatio: 16 / 9, borderRadius: 4, overflow: 'hidden', backgroundColor: '#333' },
  epBar: { position: 'absolute', left: 4, right: 4, bottom: 4, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  epBarFill: { height: '100%', backgroundColor: colors.red },
  epName: { color: '#fff', fontSize: s(14), fontWeight: '700' },
  epText: { color: '#aaa', fontSize: s(12), marginTop: 2 },
  ctlOn: { backgroundColor: 'rgba(255,255,255,0.18)' },
  ctlText: { color: '#fff', fontSize: s(20), fontWeight: '700' },
  qualityBtn: { borderColor: '#fff' },
  castText: { color: '#fff', fontWeight: '800', fontSize: s(14), borderWidth: 1.5, borderColor: '#fff', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  castTextFocus: { color: '#000', borderColor: '#000' },
  qualityText: { color: '#fff', fontWeight: '800', fontSize: s(14) },
  skip: { position: 'absolute', paddingHorizontal: s(24), paddingVertical: s(11), borderRadius: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(30,30,30,0.6)' },
  skipText: { color: '#fff', fontWeight: '800', fontSize: s(16) },
  nextCard: { position: 'absolute', maxWidth: s(460), backgroundColor: 'rgba(20,20,20,0.92)', borderRadius: 6, padding: s(14), gap: s(10) },
  nextLabel: { color: '#fff', fontWeight: '700', fontSize: s(14) },
  nextBtn: { backgroundColor: '#fff', paddingHorizontal: s(16), paddingVertical: s(9), borderRadius: 4, borderWidth: 2, borderColor: '#fff' },
  nextBtnText: { color: '#000', fontWeight: '800', fontSize: s(14) },
  ghostBtn: { paddingHorizontal: s(16), paddingVertical: s(9), borderRadius: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center' },
  ghostText: { color: '#fff', fontWeight: '700', fontSize: s(14) },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  menu: { width: s(320), maxHeight: '85%', backgroundColor: '#262626', borderRadius: 8, padding: s(14), gap: s(8) },
  menuTitle: { color: '#fff', fontSize: s(18), fontWeight: '800', marginBottom: s(4) },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: s(10), paddingVertical: s(9), paddingHorizontal: s(8), borderRadius: 4 },
  menuCheck: { color: '#fff', width: s(18), fontSize: s(15) },
  menuLabel: { color: '#bbb', fontSize: s(15) },
  menuItemNote: { color: '#999', fontSize: s(12) },
  menuNote: { color: '#999', fontSize: s(12) },
});
