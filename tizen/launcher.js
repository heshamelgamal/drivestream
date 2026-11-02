  // DriveStream for Samsung TVs: a launcher for the DriveStream website in TV mode.
  // It registers the remote's media keys for the app, refreshes the rows the app shows on
  // the TV's home bar, checks the server is reachable, then opens the site. The site
  // handles the remote from there (see public/tv.js).
  var SERVER = '__DRIVESTREAM_SERVER__'; // set by tools/build-tizen.mjs from tizen/tizen.config.json
  var SERVICE_ID = '__TIZEN_PACKAGE_ID__.preview';

  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward', 'MediaStop'].forEach(function (k) {
      tizen.tvinputdevice.registerKey(k);
    });
  } catch (e) {}

  function exitApp() {
    try { tizen.application.getCurrentApplication().exit(); } catch (err) {}
  }

  // A tile picked on the home bar opens the app with its page in PAYLOAD: { path } for a
  // title, or { path, via } for a video and the title page behind it. The site lays out
  // history from these so Back leads to its home screen (see openFromHomeBar in app.js).
  var PAGE = /^#\/[wt]\/[\w-]+$/;
  function deepLink() {
    try {
      var req = tizen.application.getCurrentApplication().getRequestedAppControl();
      var data = (req && req.appControl && req.appControl.data) || [];
      for (var i = 0; i < data.length; i++) {
        if (data[i].key !== 'PAYLOAD') continue;
        var v = JSON.parse(JSON.parse(data[i].value[0]).values);
        if (!PAGE.test(v.path)) return '';
        return '&open=' + encodeURIComponent(v.path) + (PAGE.test(v.via) ? '&via=' + encodeURIComponent(v.via) : '');
      }
    } catch (e) {}
    return '';
  }
  var link = deepLink();

  // The site can't close the app itself: its Exit button (and Back from a page opened
  // from the home bar) steps back through history to this page, which then closes the app.
  // Arriving here by going back, rather than by a launch or reload, means exactly that.
  function cameBack(e) {
    return (e && e.persisted) || (window.performance && performance.navigation && performance.navigation.type === 2);
  }
  if (cameBack()) exitApp();
  window.addEventListener('pageshow', function (e) { if (cameBack(e)) exitApp(); });

  // This TV's key for its home-bar rows (see /api/tv/preview on the server): made once,
  // kept with the app, and linked by the site to whoever signs in on this TV.
  function tvKey() {
    var key = null;
    try { key = localStorage.getItem('ds.tvkey'); } catch (e) {}
    if (!key || !/^[a-f0-9]{32}$/.test(key)) {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      key = Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
      try { localStorage.setItem('ds.tvkey', key); } catch (e) {}
    }
    return key;
  }
  var key = tvKey();

  // Fetch this viewer's rows and hand them to the background service, which puts them on
  // the home bar. Never holds up opening the site for more than a few seconds.
  function refreshRows(then) {
    var finished = false;
    var finish = function () { if (!finished) { finished = true; then(); } };
    setTimeout(finish, 4000);
    var launch = function (rows) {
      try {
        var data = [new tizen.ApplicationControlData('caller', ['ForegroundApp']), new tizen.ApplicationControlData('key', [key])];
        if (rows) data.push(new tizen.ApplicationControlData('preview', [rows]));
        var ctl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, null, null, data);
        tizen.application.launchAppControl(ctl, SERVICE_ID, finish, finish);
      } catch (e) { finish(); }
    };
    var xhr = new XMLHttpRequest();
    xhr.open('GET', SERVER + '/api/tv/preview?key=' + key);
    xhr.timeout = 3000;
    xhr.onload = function () { launch(xhr.status === 200 ? xhr.responseText : null); };
    xhr.onerror = xhr.ontimeout = function () { launch(null); };
    xhr.send();
  }

  var msg = document.getElementById('msg');
  var retry = document.getElementById('retry');

  function open() {
    msg.textContent = 'Connecting…';
    retry.hidden = true;
    // Loading a small image works across origins without any special server setup.
    var probe = new Image();
    var done = false;
    var fail = function () {
      if (done) return;
      done = true;
      msg.textContent = 'Can’t reach DriveStream. Check the TV’s internet connection.';
      retry.hidden = false;
      retry.focus();
    };
    probe.onload = function () {
      if (done) return;
      done = true;
      refreshRows(function () {
        // Not replace(): this page stays in history so the site's Exit can come back to it.
        location.href = SERVER + '/?tv=1&app=1&dk=' + key + link + '#/';
      });
    };
    probe.onerror = fail;
    setTimeout(fail, 12000);
    probe.src = SERVER + '/favicon-32.png?t=' + Date.now();
  }
  retry.addEventListener('click', open);

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 10009) { // Back
      exitApp();
    } else if (e.keyCode === 13 && !retry.hidden) {
      open();
    }
  });

  open();
