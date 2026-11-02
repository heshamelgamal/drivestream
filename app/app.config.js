// Your build settings for the Android phone / Android TV app. app.json holds everything
// else; these come from the environment (or app/.env, which Expo reads) so nothing
// personal lives in the repo. See app/.env.example and README → "Android app".
//
//   DRIVESTREAM_SERVER   your server's address, pre-filled on the sign-in screen
//                        (e.g. https://stream.example.com). Empty = typed in on first sign-in.
//   ANDROID_PACKAGE      your own application id, e.g. com.yourname.drivestream
//   APP_NAME             name under the icon (default DriveStream)
//   EAS_PROJECT_ID       only for EAS cloud builds: from `npx eas-cli init`
//   EAS_OWNER            only for EAS cloud builds: your Expo account name
//
// Local release builds can be signed with your own key: put keys/keystore.properties
// next to this file (see keys.example/). Without it, nothing changes.

const fs = require('fs');
const path = require('path');

const env = (k) => (process.env[k] || '').trim();

module.exports = ({ config }) => {
  const pkg = env('ANDROID_PACKAGE') || 'com.example.drivestream';
  if (!env('ANDROID_PACKAGE')) {
    console.warn('[app.config] ANDROID_PACKAGE is not set; using the placeholder com.example.drivestream.');
  }
  const out = {
    ...config,
    name: env('APP_NAME') || config.name,
    android: { ...config.android, package: pkg },
    extra: { ...config.extra, serverUrl: env('DRIVESTREAM_SERVER').replace(/\/+$/, '') },
  };
  if (env('EAS_PROJECT_ID')) out.extra.eas = { projectId: env('EAS_PROJECT_ID') };
  if (env('EAS_OWNER')) out.owner = env('EAS_OWNER');
  // Thmanyah Sans (Arabic) can't be shipped in the repo; embed it only once you've added
  // the files to assets/fonts (README → Fonts). Without it, Arabic uses the system font.
  out.plugins = (out.plugins || config.plugins || []).map((p) =>
    Array.isArray(p) && p[0] === 'expo-font'
      ? [p[0], { ...p[1], fonts: p[1].fonts.filter((f) => fs.existsSync(path.join(__dirname, f))) }]
      : p,
  );
  if (fs.existsSync(path.join(__dirname, 'keys', 'keystore.properties'))) {
    out.plugins = ['./plugins/withLocalSigning', ...out.plugins];
  }
  return out;
};
