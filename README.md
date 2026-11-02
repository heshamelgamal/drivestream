# DriveStream

A personal, Netflix-style streaming app for the movies, series and animation you already own,
kept in **Google Drive** or in a **folder on your server**. One small Node server; watch in any
browser, on Android phones and Android TV (app), and on Samsung TVs (Tizen app or the TV browser).

**Developed by Hesham Elgamal.** Free for personal, non-commercial use. See [LICENSE](LICENSE).

```
 Browser / Android app / Samsung TV ──▶ DriveStream server ──▶ Google Drive or a local folder
                                               └─────────────▶ TMDB (posters, plots, episode names)
```

> **Disclaimer.** DriveStream is for streaming media you have the right to use. You are responsible
> for the content you put in your library and for following Google's terms (Drive, Google Cloud) and
> TMDB's terms. DriveStream is not affiliated with Google, Samsung, Netflix or TMDB.

## Features

- **Categories** (e.g. Movies, TV Series, Animation), each from its own folder. Movies vs. shows are detected from names and folders.
- **TMDB data** (optional): posters, backdrops, plot, rating, genres, episode names and stills.
- **Profiles**: each person signs in with their own profile and gets their own Continue Watching. Admins manage profiles.
- **Continue watching** across devices, with "Up next" after an episode.
- **Player**: every quality you have as a separate file, plus on-the-fly 1080/720/480/360p conversion with ffmpeg;
  files a browser can't play (HEVC, AC3/DTS, AVI) are converted automatically; `.srt`/`.vtt` subtitles (Arabic Windows-1256 handled).
- **Skip Intro / Next Episode**: intro and credits are detected automatically per show (ffmpeg audio fingerprints).
- **TVs**: a 10-foot TV mode for the remote (`?tv=1`), a bundle for older Samsung TVs, a Samsung app with
  Continue Watching on the TV's home bar, and sign-in on TVs with a code/QR approved from a phone.
- **Cast links** for apps like Web Video Cast, and APK self-updates for the Android app.
- **English and Arabic** interface.
- **Security**: sign-in required for everything except the app shell; only files in your library can be streamed.

## Contents

1. [Quick start](#1-quick-start)
2. [Storage: Google Drive](#2-storage-google-drive) or [local folder](#3-storage-local-folder)
3. [Folder layout and naming](#4-folder-layout-and-naming)
4. [TMDB](#5-tmdb-optional) · [ffmpeg](#6-ffmpeg) · [Fonts](#7-fonts)
5. [HTTPS and a domain](#8-https-reverse-proxy) · [Docker](#9-docker)
6. [Android phone / Android TV app](#10-android-phone-and-android-tv-app)
7. [Samsung TV app](#11-samsung-tv-app)
8. [Settings](#12-settings) · [Project layout](#13-project-layout) · [License](#14-license-and-credit)

## 1. Quick start

You need [Node.js](https://nodejs.org/) 22+ and, for conversion and intro detection, [ffmpeg](https://ffmpeg.org/).

```bash
git clone https://github.com/heshamelgamal/drivestream.git
cd drivestream
npm install
cp .env.example .env      # then edit .env (see the next sections)
npm start
```

On first start the server creates an **admin** profile and prints how to sign in (username `admin`,
password = `APP_PASSWORD`, or a random one shown in the log). Open the address it prints; on other
devices at home use the "On your network" address. Add more profiles from the profile menu → **Manage profiles**.

## 2. Storage: Google Drive

Set `STORAGE=drive`. The server reads your folders with a Google Cloud **service account** (read-only).

1. Open <https://console.cloud.google.com/> and create a project (e.g. "DriveStream").
2. **APIs & Services → Library** → **Google Drive API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Any name; it needs no roles.
4. Open it → **Keys → Add key → Create new key → JSON**. Save the file next to `server.js` as
   `service-account.json` (or set `GOOGLE_APPLICATION_CREDENTIALS`). **Keep it private; never commit it.**
5. Copy the account's email (`…@….iam.gserviceaccount.com`). In Google Drive, **share** each library
   folder (e.g. Movies, TV Series, Animation) with that email as **Viewer**.
6. In `.env`, list the folders (link or ID) in `CATEGORIES`:

   ```
   CATEGORIES=Movies|movie|https://drive.google.com/drive/folders/AAA, TV Series|tv|BBB, Animation|auto|CCC
   ```

   `movie` = only films, `tv` = only series (each top-level folder is a show), `auto` = decided per folder.

Google limits how much one account can download per day; that's plenty for personal viewing.

**Optional: "Add to Google Drive" (admins).** With Drive storage, admins can paste links on the
Manage profiles page; the server downloads each file and uploads it into the right category folder as
your Google account. It needs a Google OAuth client (type "Web application") with
`<PUBLIC_URL>/api/google/callback` as an authorised redirect URI; the page walks you through it.
If you publish an OAuth consent screen, edit `public/privacy.html` (fill in the `[brackets]`) and use it as the privacy page.

## 3. Storage: local folder

Set `STORAGE=local` and `LOCAL_MEDIA_DIR` to a folder on the server's disk:

```
STORAGE=local
LOCAL_MEDIA_DIR=/srv/media
```

Each sub-folder becomes a category (a name containing "TV", "Series" or "Shows" is treated as TV,
"Movies"/"Films" as movies, anything else is detected per folder). Or list them yourself:
`CATEGORIES=Films|movie|Movies, Series|tv|TV, Kids|auto|Kids/Cartoons` (paths are relative to `LOCAL_MEDIA_DIR`).

With local storage, video thumbnails are grabbed from the video with ffmpeg (cached in `data/thumbs`),
`poster.jpg`/`folder.jpg`/`cover.jpg` images are used as posters, and the Drive uploader is hidden.
The server only needs read access to the folder. Hidden files (starting with `.`) are ignored.

## 4. Folder layout and naming

DriveStream reads file and folder names; the same layout works for Drive and local folders.

```
Movies/
  Obsession.2025.1080p.BluRay [720p].mp4               ← a loose file is fine
  Inception (2010)/                                    ← or one folder per movie
    Inception.2010.1080p.mkv
    Inception.2010.720p.mp4                            ← extra qualities show in the quality menu
    Inception.2010.1080p.ar.srt                        ← subtitles: name.<lang>.srt (or a Subs folder)
    poster.jpg                                         ← optional poster (used without TMDB)
  Nolan Collection/<movie folders>                     ← collections are flattened
TV Series/
  Dark/Season 1/Dark.S01E01.mkv                        ← season folders
  VisionQuest/VisionQuest.E01.mp4                      ← or episodes straight in the show folder
Animation/                                             ← movies and series detected per folder
  Spirited Away (2001)/…
  Naruto/Naruto - 01.mkv
```

- Put the **year** in movie names (`Title (2010)` or `Title.2010…`) for accurate TMDB matches.
- Wrong match? Add `{tmdb-12345}` to the folder or file name (the number from the TMDB page URL).
- Files with "sample", "trailer" or "featurette" in the name are skipped.
- New files appear on the next scan (`RESCAN_MINUTES`, default 30) or right away with **Refresh library** at the bottom of the home page.

## 5. TMDB (optional)

1. Create a free account at <https://www.themoviedb.org/signup>.
2. **Settings → API** → request a key ("Personal").
3. Put the **API Key** or the **API Read Access Token** in `TMDB_API_KEY`. `TMDB_LANGUAGE` sets the language (e.g. `ar-SA`).

## 6. ffmpeg

ffmpeg powers resolution switching, conversion of files browsers can't play, thumbnails for local
storage, and intro/credits detection. Install it so `ffmpeg` and `ffprobe` are on the PATH
(`sudo apt install ffmpeg`, `winget install ffmpeg`, `brew install ffmpeg`) or set `FFMPEG_PATH`/`FFPROBE_PATH`.
Conversions run at the lowest CPU priority; `MAX_TRANSCODES` caps how many run at once. Without ffmpeg,
DriveStream still plays files the device supports directly.

## 7. Fonts

The Arabic interface uses **Thmanyah Sans**, whose license doesn't allow redistributing the files,
so they aren't in this repository. To use it, download Thmanyah Sans from Thmanyah's official site
and copy `ThmanyahSans-Regular.otf`, `ThmanyahSans-Medium.otf` and `ThmanyahSans-Bold.otf` into
`public/fonts/` (website) and `app/assets/fonts/` (Android app). Without them, Arabic text uses the
system font. These files are git-ignored so you don't publish them by accident.

## 8. HTTPS (reverse proxy)

For use outside your home network, put DriveStream behind HTTPS:

- **Simplest:** [Tailscale](https://tailscale.com/) between your devices, no ports opened.
- **nginx + Let's Encrypt** on a Linux server with a domain pointing at it:
  set `HOST=127.0.0.1` and `PORT=8080` in `.env`, then run
  `bash deploy/setup-https.sh stream.example.com` (HTTPS on 443) or
  `bash deploy/setup-https.sh stream.example.com 8443 8080` (HTTPS on another port). Read the script first.
- **Caddy:** `stream.example.com { reverse_proxy 127.0.0.1:8080 }` also works (it handles certificates and ranges).

Then set `PUBLIC_URL=https://stream.example.com` (with `:port` if not 443): cast links, TV sign-in QR codes
and the Google callback use it. Run the server with a process manager (systemd, pm2, or Docker).

## 9. Docker

```bash
cp .env.example .env          # fill it in
docker compose up -d --build
```

`docker-compose.yml` runs the server with ffmpeg, keeps `data/` in a named volume, mounts
`./service-account.json` for Drive, and mounts `./media` at `/media` for local storage
(`LOCAL_MEDIA_DIR` is set to `/media` inside the container; point the volume at your folder).
Remove the line you don't need. Behind a reverse proxy on the same machine, publish the port as `127.0.0.1:8080:8080`.

## 10. Android phone and Android TV app

One Expo / React Native (TV) codebase in `app/` builds both. Set your own values first:

```bash
cd app
npm install
cp .env.example .env    # DRIVESTREAM_SERVER, ANDROID_PACKAGE, APP_NAME, EAS_* (see comments)
```

- `DRIVESTREAM_SERVER` is pre-filled on the sign-in screen (people can still change it). Empty = typed on first sign-in.
- `ANDROID_PACKAGE` must be your own id, e.g. `com.yourname.drivestream`.

**Cloud build (EAS, no Android Studio needed):**

```bash
npx eas-cli@latest login
npx eas-cli@latest init                 # prints your project id → EAS_PROJECT_ID / EAS_OWNER
npx eas-cli@latest build -p android --profile phone
npx eas-cli@latest build -p android --profile tv
```

`.env` is not uploaded to EAS: set the same variables as [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)
or in `eas.json` under each profile's `"env"`.

**Local build (Windows):** install a JDK (17/21) and the Android SDK, set `JAVA_HOME` and `ANDROID_HOME`, then
`powershell -File tools/build-android.ps1 -Version 1.0.0`. APKs land in `app/dist-local/`. To sign with your own
key, copy `app/keys.example/` to `app/keys/` and fill it in (otherwise the debug key is used).
On macOS/Linux: `cd app && npx expo prebuild -p android && cd android && ./gradlew assembleRelease`
(with `EXPO_TV=1` for the TV build).

**Self-update:** put APKs named `DriveStream.Phone.<version>.apk` / `DriveStream.TV.<version>.apk` in a
`downloads/` folder next to `server.js`; the website shows download buttons, `/phone.apk` and `/tv.apk`
always point at the newest, and the app offers updates (`downloads/releases.json` holds optional release notes).
Bump `version` and `android.versionCode` in `app/app.json` for each release.

## 11. Samsung TV app

The Samsung (Tizen) app in `tizen/` is a small launcher that opens your DriveStream site in TV mode and
puts Continue Watching / Recently Added on the TV's home bar. (Any Samsung TV can also just open
`https://<your server>/?tv=1` in its browser.)

1. Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   with the TV extensions and the **Samsung Certificate Extension**.
2. Create your own **Samsung certificate** (Certificate Manager → Samsung; you need a Samsung account) and
   add your TV's DUID to it when asked.
3. On the TV, enable **Developer Mode**: Apps → press `1 2 3 4 5` on the remote → Developer mode **On**,
   enter your computer's IP, restart the TV.
4. `cp tizen/tizen.config.example.json tizen/tizen.config.json` and set `server` (your HTTPS address) and
   `packageId` (10 letters/digits of your own).
5. `npm run build:tizen` → prepares `tizen/build/`.
6. In Tizen Studio: import `tizen/build` as a project (or use the CLI:
   `tizen package -t wgt -s <your-profile> -- tizen/build`), connect to the TV with Device Manager, and
   **Run As → Tizen Web Application** (or `tizen install -n DriveStream.wgt -t <tv>`).

The home-bar rows need HTTPS with a valid certificate.

## 12. Settings

Every server setting is documented in [`.env.example`](.env.example): storage (`STORAGE`,
`GOOGLE_APPLICATION_CREDENTIALS`, `LOCAL_MEDIA_DIR`, `CATEGORIES`), TMDB, `PORT`/`HOST`/`PUBLIC_URL`/`DATA_DIR`,
`ADMIN_USERNAME`/`APP_PASSWORD`, `RESCAN_MINUTES`, ffmpeg paths and `MAX_TRANSCODES`.
App build settings: [`app/.env.example`](app/.env.example). Samsung app: [`tizen/tizen.config.example.json`](tizen/tizen.config.example.json).

Everything DriveStream stores (library index, profiles, watch progress, TMDB cache, intro data, signing keys
for cast links) is in `data/` (or `DATA_DIR`). Back it up; never publish it.

## 13. Project layout

```
server.js               HTTP server: API, sign-in, streaming, conversion, subtitles, thumbnails, progress
lib/storage/            storage providers: index.js (interface), drive.js + drive-api.js, local.js
lib/library.js          turns folders into movies/shows (name parsing, seasons, versions, subtitles)
lib/segments.js         intro/credits detection (ffmpeg chromaprint)
lib/tmdb.js             TMDB lookups with an on-disk cache
lib/accounts.js         profiles, sessions, watch history
lib/uploader.js         "Add to Google Drive" queue (Drive storage only)
lib/devicelogin.js      sign in on TVs with a code/QR
public/                 website (plain ES modules, no build step); public/tv/ = bundle for old TVs
app/                    Android phone + Android TV app (Expo / React Native for TV)
tizen/                  Samsung TV launcher app + home-bar service
tools/                  build-tv.mjs, build-tizen.mjs, build-android.ps1, check-strings.mjs, check-credit.mjs
deploy/setup-https.sh   nginx + Let's Encrypt helper
docs/UX-SPEC.md         player & navigation behaviour spec (web, phone, TV)
branding/               logo, icons and the Bebas Neue font
```

Development: `npm run dev` (restarts on changes), `npm run build:tv` after changing `public/` (rebuilds the
old-TV bundle), `npm run check` (credit + English/Arabic string checks), `cd app && npx tsc --noEmit`.

## 14. License and credit

DriveStream is **source-available for personal, non-commercial use** under the
[DriveStream Personal Use License](LICENSE): use and modify it for yourself, your household and friends;
no selling, paid hosting or commercial use; share it only free of charge with the license, [NOTICE](NOTICE)
and credit intact. The visible **"Developed by Hesham Elgamal"** credit must stay in every running copy.
Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
