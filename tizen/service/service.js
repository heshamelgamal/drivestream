// DriveStream background service: puts Continue Watching and Recently Added on the Samsung
// home bar (Smart Hub Preview). The app starts it with fresh rows each time it opens (see
// launcher.js). The TV also starts it now and then on its own; it then fetches the rows
// itself, with the key the app gave it last time.
// Plain ES5: older TVs run services on an old JavaScript engine.
var SERVER = '__DRIVESTREAM_SERVER__'; // set by tools/build-tizen.mjs from tizen/tizen.config.json
var KEY_FILE = 'dskey.txt';

function done() {
  try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
}

function setPreview(json) {
  try {
    webapis.preview.setPreviewData(json, done, function (e) {
      console.log('DriveStream preview: ' + (e && e.message));
      done();
    });
  } catch (e) {
    console.log('DriveStream preview: ' + e);
    done();
  }
}

// The key lives in the app's private folder, which this service shares with the app.
function withKeyFile(mode, fn) {
  try {
    tizen.filesystem.resolve('wgt-private', function (dir) {
      var file = null;
      try { file = dir.resolve(KEY_FILE); } catch (e) {
        if (mode === 'w') { try { file = dir.createFile(KEY_FILE); } catch (e2) {} }
      }
      if (!file) return fn(null);
      file.openStream(mode, function (s) { fn(s); }, function () { fn(null); }, 'UTF-8');
    }, function () { fn(null); }, 'rw');
  } catch (e) { fn(null); }
}

function saveKey(key, then) {
  withKeyFile('w', function (s) {
    if (s) { try { s.write(key); } catch (e) {} s.close(); }
    then();
  });
}

function loadKey(then) {
  withKeyFile('r', function (s) {
    var key = null;
    if (s) { try { key = s.read(64); } catch (e) {} s.close(); }
    then(key && /^[a-f0-9]{32,64}$/.test(key) ? key : null);
  });
}

function fetchPreview(key, then) {
  try {
    require('https').get(SERVER + '/api/tv/preview?key=' + key, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { then(res.statusCode === 200 ? body : null); });
    }).on('error', function () { then(null); });
  } catch (e) { then(null); }
}

function show(json) {
  // An empty preview isn't accepted; keep whatever the TV already shows.
  if (!json || json.indexOf('"tiles"') < 0) return done();
  setPreview(json);
}

module.exports.onStart = function () {};

module.exports.onRequest = function () {
  var data = {};
  try {
    var req = tizen.application.getCurrentApplication().getRequestedAppControl();
    var items = (req && req.appControl && req.appControl.data) || [];
    for (var i = 0; i < items.length; i++) data[items[i].key] = items[i].value[0];
  } catch (e) {}
  if (data.key) {
    // Started by the app, with this TV's key and (usually) the rows already fetched.
    saveKey(data.key, function () {
      if (data.preview) show(data.preview);
      else fetchPreview(data.key, show);
    });
    return;
  }
  // Started by the TV: fetch the rows with the saved key.
  loadKey(function (key) {
    if (!key) return done();
    fetchPreview(key, show);
  });
};

module.exports.onExit = function () {};
