// Metro config: Expo defaults, minus native build output.
// Local Android builds write tens of thousands of files under android/ and
// node_modules/*/android/build; the JS bundle never imports them, and watching
// them makes the dev server crawl on Windows.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const ignore = [
  /[\\/]android[\\/](build|\.cxx|\.gradle|app[\\/]build|app[\\/]\.cxx)[\\/].*/,
  /[\\/]node_modules[\\/].*[\\/]android[\\/](build|\.cxx)[\\/].*/,
  /^(?:.*[\\/])?android[\\/]\.gradle[\\/].*/,
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...ignore];

module.exports = config;
