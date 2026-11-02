// Entry point for the old-TV build (see tools/build-tv.mjs): polyfills for Chrome 56-era
// browsers and the adapted stylesheet first, then the normal app.

import './tv-polyfills.js';
import './app.js';
