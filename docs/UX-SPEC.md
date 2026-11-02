# DriveStream player & navigation spec

The website (incl. Samsung TVs in TV mode, `public/`) and the Android phone/TV app (`app/`)
are separate code. This file is the single description both follow. Change behaviour here
first, then in both places. "TV" means a remote (Samsung or Android TV); "phone" means touch.

## Player

**Layout.** Top: Back · title · (Cast on Android phones). Centre: Back 10 · Play/Pause · Forward 10.
Bottom: seek bar with time remaining, then Speed · Episodes · Subtitles · Quality · Next Episode.
Desktop browsers also get Mute/volume/Fullscreen and keyboard shortcuts (platform extras).

**Controls show/hide.** Any key, tap or mouse move shows them. They hide after **4 s** idle while
playing, with no panel open and not scrubbing.

**TV focus.** When the controls appear, **Play/Pause** is focused — except: Skip Intro (when
showing) and the Next-episode card take focus first; ←/→ with the controls hidden go straight to
the seek bar and start scrubbing.

**TV keys.**
- ←/→ on the seek bar (or with controls hidden): scrub. Each press within 600 ms of the last
  continues a streak; the step grows with the streak: presses 1–3: 10 s, 4–8: 30 s, 9–16: 60 s,
  then 120 s. Holding repeats about every 180 ms with the same steps. The bar and a time bubble
  above it move right away; the video jumps **1.5 s after the last press**, or at once on **OK**.
- OK with controls hidden: play/pause. OK on a button: presses it.
- Play/Pause key: toggle. **Rewind / Fast-forward keys: −10 s / +10 s.**
- Back: closes an open panel → otherwise leaves the player (to where you came from; to the
  title page if the player was opened directly).

**Phone touch.** Single tap: **show/hide the controls**. Double tap on the left/right half:
−/+10 s, each further quick tap adds 10 s (350 ms window), with a "« 20 s" bubble (translated).
Tapping outside an open panel closes it. The seek bar can be tapped or dragged.

**Logo intro.** Plays only when starting from the beginning, as the opening of the title: it sits
under the normal controls, which show and hide as usual. The time and seek bar show the title from
0:00 (full length). Play/Pause pauses the intro; seeking, Forward 10, scrubbing or a double tap
forward leave it for that point in the title; Back 10 replays it; Back leaves the player. The
title buffers behind it and carries on the moment it ends. Gives up after **10 s** of playing.
Exception: Samsung TVs that can only run one video at a time load the title when the intro ends
(the server is woken up during the intro so the title starts quickly).

**Skip Intro / credits / next episode.** Skip Intro shows during the detected intro (until 1 s
before its end). At confirmed credits: the episode counts as watched and a 10 s countdown to the
next episode starts (no countdown for a black-screen ending: card only). Without marked credits,
the card shows in the last 25 s. At the end: 5 s countdown, or leave if there is no next episode.
Card buttons: "Next episode (in N)" and "Watch credits"/"Hide".

**Panels.** Quality: every original version, then converted versions at each standard height up
to the source's (the one at the source height reads "Converted · use if the original won't play"),
originals show format and size. Subtitles: Off + each track. Speed: 0.5–1.5. Episodes: season tabs,
rows with still, progress, "N. name (now playing)".

**Remembered per device:** chosen quality, subtitle language (and "Off"). Speed is not remembered.

**Progress** is saved every 10 s while playing, on pause and on leaving — never below 5 s unless
the title is finished.

## Browsing

**Top bar:** logo · Home · each category · Search · profile avatar. TV focus look: the focused
item is a **white pill with black text**; the current page's item has a faint pill.

**Focus look (TV), everywhere:** buttons and chips turn **white with black text** and grow
slightly; posters and wide cards grow with a shadow. No outline rings.

**Home:** hero (random of the 8 newest with artwork; Play/Resume, More info), then Continue
Watching, Recently Added (24), each category, up to 5 genres with ≥3 titles. Footer: title count,
last scan, Refresh library, credit (download buttons on the website only, not in TV mode).

**Continue Watching remove:** ✕ on the card (phone/desktop) or long-press OK (TV), then confirm
"Remove from Continue Watching?".

**Title page:** artwork, title, meta, Play/Resume (+ Start over when resuming), overview, Genres,
Available in (quality list), Subtitles. Shows: **season tabs** and episode rows (number, still,
name, runtime · quality · CC, overview). On TV, Play is focused first.

**Category page:** heading, **Sort** (Recently added / A–Z / Newest / Top rated) and genre chips
(sorted by the shown, translated name).

**Search:** results update as you type; heading "Results for “q”" / "No results for “q”".
Matches title, year, genres (in both languages) and overview.

**Back key (TV):** closes a dialog/menu first; on Home it asks **"Exit DriveStream?"**
(Cancel / Exit, Exit focused); elsewhere goes back.

**Profile menu:** name and @username, Link a device, Account settings, language switch, Sign out
(+ Manage profiles for admins on the website only). **Account settings:** language, change password.

**Website only (by design):** Manage profiles, Drive uploads, desktop volume/fullscreen/keyboard.
**App only (by design):** server address, phone code sign-in, QR scanning, pull-to-refresh.

## Text

Same wording in both apps, in English and Arabic. The Android app's `app/src/lib/i18n.tsx` and
the website's `public/i18n.js` are checked against each other by `tools/check-strings.mjs`.
Arabic: التلفزيون, بث, أُضيف مؤخرًا, البدء من جديد; episode labels "م1 ح2".
