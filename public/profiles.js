// Sign-in screen, profile menu, "Manage profiles" dashboard and account settings.

import { h, api, send, avatar, appDownloads, credit } from './ui.js';
import { tvMode } from './tv.js';
import { t, lang, applyLang } from './i18n.js';

export let me = null;

export async function loadMe() {
  try {
    ({ user: me } = await api('/api/me'));
  } catch {
    me = null;
  }
  if (me) applyLang(me.lang);
  linkTvKey();
  return me;
}

// In the Samsung app (opened with ?dk=<key>): the rows it shows on the TV's home bar
// become this profile's. See /api/tv/preview on the server.
const tvKey = new URLSearchParams(location.search).get('dk');
function linkTvKey() {
  if (me && tvKey) send('/api/tv/register', 'POST', { key: tvKey }).catch(() => {});
}

// Saves the profile's language and reloads so every screen redraws in it.
async function setLanguage(next) {
  if (me) await send('/api/me', 'PATCH', { lang: next });
  else sessionStorage.setItem('ds.langPicked', '1');
  applyLang(next);
  location.reload();
}

// "العربية" / "English" switch for the sign-in screen (before there's a profile to save it on).
const langSwitch = () => h('button', { type: 'button', class: 'lang-switch', lang: lang === 'ar' ? 'en' : 'ar', onclick: () => setLanguage(lang === 'ar' ? 'en' : 'ar') },
  lang === 'ar' ? 'English' : 'العربية');

// After signing in: a language picked on the sign-in screen wins over the profile's saved one.
async function adoptLanguage(user) {
  me = user;
  linkTvKey();
  if (pickedOnSignIn && me.lang !== lang) {
    await send('/api/me', 'PATCH', { lang }).then((r) => (me = r.user)).catch(() => {});
  } else if (me.lang !== lang) {
    applyLang(me.lang);
  }
}
const pickedOnSignIn = (() => { try { return sessionStorage.getItem('ds.langPicked') === '1'; } catch { return false; } })();

// ---------- sign in ----------

export function showLogin(onSignedIn) {
  document.body.classList.add('signed-out');
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn play wide', type: 'submit' }, t('Sign In'));
  const clearMark = (e) => e.target.classList.remove('invalid');
  const form = h('form', { class: 'login-card', oninput: clearMark, onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    form.username.classList.remove('invalid');
    form.password.classList.remove('invalid');
    submit.disabled = true;
    try {
      const { user } = await send('/api/login', 'POST', { username: form.username.value.trim(), password: form.password.value });
      await adoptLanguage(user);
      document.body.classList.remove('signed-out');
      onSignedIn();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      // Point at the field that was wrong.
      const bad = err.field === 'username' ? form.username : form.password;
      bad.classList.add('invalid');
      bad.select();
    } finally {
      submit.disabled = false;
    }
  } },
    h('h1', {}, t('Sign In')),
    h('label', { class: 'field' }, h('span', {}, t('Username')),
      h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true })),
    h('label', { class: 'field' }, h('span', {}, t('Password')),
      h('div', { class: 'password-wrap' },
        h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
        h('button', { type: 'button', class: 'show-pass', 'aria-label': t('Show password'), onclick: (e) => {
          const show = form.password.type === 'password';
          form.password.type = show ? 'text' : 'password';
          e.currentTarget.textContent = show ? t('Hide') : t('Show');
          e.currentTarget.setAttribute('aria-label', show ? t('Hide password') : t('Show password'));
        } }, t('Show')))),
    error,
    submit,
    h('p', { class: 'muted small' }, t('Ask the person who runs this DriveStream for a profile.')));

  const done = () => {
    document.body.classList.remove('signed-out');
    onSignedIn();
  };
  // On TVs, signing in with a phone is much easier than typing with the remote.
  const panel = tvMode ? codeSignIn(async (user) => { await adoptLanguage(user); done(); }) : null;
  const login = h('div', { class: 'login' }, langSwitch(), h('img', { class: 'login-logo', src: 'brand/logo.svg', alt: 'DriveStream' }),
    panel ? h('div', { class: 'login-split' }, panel, form) : form);
  document.getElementById('view').replaceChildren(login);
  login.append(credit());
  appDownloads().then((el) => el && login.lastChild.before(el));
  if (!tvMode) form.username.focus();
}

// A code and QR that a signed-in phone or computer approves (see #/link). Renews
// itself when the code expires and stops once this screen is gone.
function codeSignIn(onSignedIn) {
  const code = h('div', { class: 'device-code' }, '······');
  const qr = h('img', { class: 'device-qr', alt: '' });
  const where = h('p', { class: 'muted small' });
  const box = h('div', { class: 'login-card code-card' },
    h('h1', {}, t('Sign in with your phone')),
    h('p', {}, t('Scan the QR code with your phone’s camera, or open DriveStream on your phone or computer, choose '), h('strong', {}, t('Link a device')), t(' and enter:')),
    code, qr, where);
  let timer;
  let started = false;
  async function next() {
    clearTimeout(timer);
    if (started && !box.isConnected) return;
    started = true;
    try {
      const d = await send('/api/device/start', 'POST', { device: 'TV' });
      code.textContent = d.display;
      qr.src = d.qr;
      where.textContent = t('The code changes every 10 minutes.');
      const until = Date.now() + d.expiresIn * 1000;
      const poll = async () => {
        if (!box.isConnected) return;
        if (Date.now() > until) return next();
        const r = await send('/api/device/poll', 'POST', { secret: d.secret }).catch(() => ({ status: 'pending' }));
        if (r.status === 'approved') return onSignedIn(r.user);
        if (r.status === 'expired') return next();
        timer = setTimeout(poll, 2500);
      };
      timer = setTimeout(poll, 2500);
    } catch (e) {
      code.textContent = '—';
      where.textContent = e.message;
      timer = setTimeout(next, 15000);
    }
  }
  next();
  return box;
}

// ---------- link a device (approve a TV's code) ----------

export function viewLink(view, params) {
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const input = h('input', { name: 'code', value: params.get('code') || '', maxlength: '7', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'ABC-123', class: 'code-input', required: true });
  const submit = h('button', { class: 'btn play wide', type: 'submit' }, t('Continue'));
  const card = h('form', { class: 'login-card link-card', onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const d = await api(`/api/device/lookup?code=${encodeURIComponent(input.value)}`);
      card.replaceChildren(
        h('h1', {}, t('Sign in this TV?')),
        h('p', {}, t('{device} will be signed in as ', { device: d.device === 'TV' ? t('The TV') : d.device }), h('strong', {}, me.name), t(' (@{username}), with your own Continue Watching.', { username: me.username })),
        error,
        h('button', { class: 'btn play wide', type: 'button', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await send('/api/device/approve', 'POST', { code: input.value });
            card.replaceChildren(h('h1', {}, t('Done ✓')), h('p', {}, t('The TV is signing in now.')), h('a', { class: 'btn info wide', href: '#/' }, t('Back to DriveStream')));
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        } }, t('Sign in the TV')),
        h('a', { class: 'btn info wide', href: '#/link' }, t('Cancel')));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  } },
    h('h1', {}, t('Link a device')),
    h('p', {}, t('Enter the code shown on your TV.')),
    input, error, submit);
  view.replaceChildren(h('div', { class: 'page top-pad narrow link-page' }, card));
  // A code from the QR link: go straight to the confirmation.
  if (input.value) submit.click();
  else input.focus();
}

// ---------- profile menu (top right) ----------

export function renderProfileMenu(onSignOut) {
  const slot = document.getElementById('nav-profile');
  if (!me) return slot.replaceChildren();
  const menu = h('div', { class: 'profile-menu', hidden: true, role: 'menu' },
    h('div', { class: 'profile-head' }, avatar(me, 36), h('div', {}, h('strong', {}, me.name), h('small', {}, `@${me.username}`))),
    me.isAdmin ? h('a', { href: '#/admin', role: 'menuitem' }, t('Manage profiles')) : null,
    h('a', { href: '#/link', role: 'menuitem' }, t('Link a device')),
    h('a', { href: '#/account', role: 'menuitem' }, t('Account settings')),
    h('button', { role: 'menuitem', lang: lang === 'ar' ? 'en' : 'ar', onclick: () => setLanguage(lang === 'ar' ? 'en' : 'ar') }, lang === 'ar' ? 'English' : 'العربية'),
    h('button', { role: 'menuitem', onclick: async () => {
      await send('/api/logout', 'POST').catch(() => {});
      me = null;
      onSignOut();
    } }, t('Sign out')));
  const button = h('button', { class: 'profile-btn', 'aria-label': t('Profile: {name}', { name: me.name }), 'aria-haspopup': 'menu', onclick: (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  } }, avatar(me, 32), h('span', { class: 'caret' }, '▾'));
  document.addEventListener('click', (e) => { if (!slot.contains(e.target)) menu.hidden = true; });
  menu.addEventListener('click', () => (menu.hidden = true));
  slot.replaceChildren(button, menu);
}

// ---------- dialogs ----------

function dialog(title, body, { submitLabel = t('Save'), onSubmit, danger = false }) {
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: `btn ${danger ? 'danger' : 'play'}`, type: 'submit' }, submitLabel);
  const dlg = h('dialog', { class: 'modal' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      await onSubmit(form);
      dlg.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  } },
    h('h2', {}, title), body, error,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn info', type: 'button', onclick: () => dlg.close() }, t('Cancel')), submit));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  form.querySelector('input')?.focus();
  return dlg;
}

const field = (label, attrs, hint) =>
  h('label', { class: 'field' }, h('span', {}, label), h('input', attrs), hint ? h('small', { class: 'muted' }, hint) : null);

function profileForm(user = null) {
  return [
    field(t('Name'), { name: 'name', value: user?.name || '', required: true, maxlength: '40', placeholder: t('e.g. Sara') }),
    field(t('Username'), { name: 'username', value: user?.username || '', required: true, pattern: '[A-Za-z0-9._\\-]{3,32}', autocapitalize: 'none', spellcheck: 'false' },
      t('3–32 characters: letters, numbers, . _ -')),
    field(user ? t('New password') : t('Password'), { name: 'password', type: 'password', minlength: '6', required: !user, autocomplete: 'new-password' },
      user ? t('Leave blank to keep the current password. Changing it signs this profile out on all devices.') : t('At least 6 characters.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isAdmin', checked: !!user?.isAdmin }), h('span', {}, t('Admin (can manage profiles)'))),
  ];
}

const formData = (f) => ({ name: f.name.value, username: f.username.value.trim(), password: f.password.value || undefined, isAdmin: f.isAdmin.checked });

// ---------- Manage profiles (admins) ----------

const ago = (when) => {
  if (!when) return t('Never');
  const m = Math.round((Date.now() - when) / 60000);
  if (m < 60) return m <= 1 ? t('Just now') : t('{n} min ago', { n: m });
  const hrs = Math.round(m / 60);
  if (hrs < 48) return t('{n} h ago', { n: hrs });
  return new Date(when).toLocaleDateString();
};

export async function viewAdmin(view, refresh) {
  if (!me?.isAdmin) return view.replaceChildren(h('div', { class: 'message' }, h('h2', {}, t('Admins only'))));
  const { users } = await api('/api/users');

  const addBtn = h('button', { class: 'btn play', onclick: () => dialog(t('Add profile'), profileForm(), {
    submitLabel: t('Add profile'),
    onSubmit: async (f) => {
      await send('/api/users', 'POST', formData(f));
      refresh();
    },
  }) }, t('+ Add profile'));

  const card = (u) => h('div', { class: 'admin-card' },
    avatar(u, 56),
    h('div', { class: 'admin-info' },
      h('strong', {}, u.name, u.id === me.id ? h('span', { class: 'tag' }, t('You')) : null, u.isAdmin ? h('span', { class: 'tag red' }, t('Admin')) : null),
      h('span', { class: 'muted' }, `@${u.username}`),
      h('span', { class: 'muted small' }, t('{n} titles in history · last watched {ago}', { n: u.watched, ago: ago(u.lastWatched) }))),
    h('div', { class: 'admin-actions' },
      h('button', { class: 'btn info small', onclick: () => dialog(t('Edit {name}', { name: u.name }), profileForm(u), {
        onSubmit: async (f) => {
          await send(`/api/users/${u.id}`, 'PATCH', formData(f));
          if (u.id === me.id) await loadMe();
          refresh();
        },
      }) }, t('Edit')),
      h('button', { class: 'btn info small', onclick: () => dialog(t('Clear {name}’s history?', { name: u.name }),
        h('p', {}, t('This empties their Continue Watching and resume points. It can’t be undone.')), {
          submitLabel: t('Clear history'), danger: true,
          onSubmit: async () => {
            await send(`/api/users/${u.id}/reset-history`, 'POST');
            refresh();
          },
        }) }, t('Clear history')),
      u.id !== me.id ? h('button', { class: 'btn danger small', onclick: () => dialog(t('Delete {name}?', { name: u.name }),
        h('p', {}, t('@{username} will be signed out everywhere and their watch history deleted. This can’t be undone.', { username: u.username })), {
          submitLabel: t('Delete profile'), danger: true,
          onSubmit: async () => {
            await send(`/api/users/${u.id}`, 'DELETE');
            refresh();
          },
        }) }, t('Delete')) : null));

  view.replaceChildren(h('div', { class: 'page top-pad narrow' },
    h('div', { class: 'page-head' }, h('h1', {}, t('Manage profiles')), addBtn),
    h('p', { class: 'muted' }, t('Everyone signs in with their own username and password and gets their own Continue Watching.')),
    h('div', { class: 'admin-list' }, users.map(card)),
    await uploadsSection(refresh)));
}

// ---------- Google Drive uploads (admins) ----------
// Paste links; the server downloads each one and uploads it into the chosen
// category's Drive folder, then deletes its local copy.

const STATUS_LABEL = { queued: 'Waiting', downloading: 'Downloading', uploading: 'Uploading to Drive', done: 'In Drive', skipped: 'Skipped', failed: 'Failed', cancelled: 'Cancelled' };

const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const mb = (n) => `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1)} MB`;

async function uploadsSection(refresh) {
  let data = await api('/api/uploads');
  if (!data.available) return null; // local-folder storage: nothing to upload to
  const { google } = data;
  const section = h('section', { class: 'uploads' }, h('h2', {}, t('Add to Google Drive')));
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qs.get('drive_error')) section.append(h('p', { class: 'form-error' }, qs.get('drive_error')));

  if (!google.configured) {
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'upload-setup', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await send('/api/google/config', 'POST', { clientId: form.clientId.value, clientSecret: form.clientSecret.value });
        refresh();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    } },
      h('p', { class: 'muted' }, t('One-time setup: create a Google OAuth client (type “Web application”) and add this as its authorised redirect URI:')),
      h('code', { class: 'copyable' }, google.redirectUri),
      field(t('Client ID'), { name: 'clientId', required: true, spellcheck: 'false', placeholder: '…apps.googleusercontent.com' }),
      field(t('Client secret'), { name: 'clientSecret', type: 'password', required: true, autocomplete: 'off' }),
      error,
      h('button', { class: 'btn play', type: 'submit' }, t('Save')));
    section.append(form);
    return section;
  }

  if (!google.connected) {
    section.append(
      h('p', { class: 'muted' }, t('Connect the Google account that owns your library folders. Uploads are made as that account.')),
      h('a', { class: 'btn play', href: '/api/google/connect' }, t('Connect Google Drive')));
    return section;
  }

  // Link rows: URL, category, optional show folder.
  const cats = data.categories;
  const rows = h('div', { class: 'upload-rows' });
  const datalists = cats.map((c) => h('datalist', { id: `shows-${c.slug}` }, (data.shows[c.slug] || []).map((s) => h('option', { value: s }))));
  const addRow = (url = '', category = cats[0]?.slug) => {
    const show = h('input', { class: 'up-show', placeholder: t('Show folder (optional)'), list: `shows-${category}`, spellcheck: 'false' });
    const select = h('select', { class: 'up-cat', onchange: () => {
      show.setAttribute('list', `shows-${select.value}`);
      show.hidden = cats.find((c) => c.slug === select.value)?.type === 'movie';
    } }, cats.map((c) => h('option', { value: c.slug, selected: c.slug === category }, c.name)));
    show.hidden = cats.find((c) => c.slug === category)?.type === 'movie';
    const row = h('div', { class: 'upload-row' },
      h('input', { class: 'up-url', type: 'url', placeholder: 'https://…', value: url, spellcheck: 'false', onpaste: (e) => {
        // Pasting several lines fills several rows.
        const lines = e.clipboardData.getData('text').split(/\s+/).filter((l) => /^https?:\/\//i.test(l));
        if (lines.length < 2) return;
        e.preventDefault();
        e.target.value = lines[0];
        lines.slice(1).forEach((l) => addRow(l, select.value));
      } }),
      select, show,
      h('button', { class: 'btn info small', type: 'button', 'aria-label': t('Remove row'), onclick: () => (rows.children.length > 1 ? row.remove() : (row.querySelector('.up-url').value = '')) }, '✕'));
    rows.append(row);
  };
  addRow();

  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const sendBtn = h('button', { class: 'btn play', type: 'submit' }, t('Send to Drive'));
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    const items = [...rows.children].map((r) => ({
      url: r.querySelector('.up-url').value.trim(),
      category: r.querySelector('.up-cat').value,
      show: r.querySelector('.up-show').hidden ? '' : r.querySelector('.up-show').value.trim(),
    })).filter((i) => i.url);
    if (!items.length) return;
    sendBtn.disabled = true;
    try {
      await send('/api/uploads', 'POST', { items });
      rows.replaceChildren();
      addRow();
      await poll();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      sendBtn.disabled = false;
    }
  } },
    rows, datalists, error,
    h('div', { class: 'upload-actions' },
      h('button', { class: 'btn info small', type: 'button', onclick: () => addRow('', rows.lastChild?.querySelector('.up-cat').value) }, t('+ Add link')),
      sendBtn));

  const list = h('div', { class: 'upload-jobs' });
  const jobRow = (j) => {
    const busy = j.status === 'downloading' || j.status === 'uploading';
    const p = j.status === 'downloading' ? pct(j.downloaded, j.size) : j.status === 'uploading' ? pct(j.uploaded, j.size) : j.status === 'done' ? 100 : 0;
    const cat = cats.find((c) => c.slug === j.category)?.name || j.category;
    const detail = j.status === 'downloading' ? (j.size ? t('{a} of {b}', { a: mb(j.downloaded), b: mb(j.size) }) : mb(j.downloaded))
      : j.status === 'uploading' ? t('{a} of {b}', { a: mb(j.uploaded), b: mb(j.size) }) : j.note || (j.size ? mb(j.size) : '');
    return h('div', { class: `upload-job ${j.status}` },
      h('div', { class: 'upload-job-head' },
        h('strong', { title: j.url }, j.name || j.url),
        h('span', { class: 'muted small' }, `${cat}${j.show ? ` / ${j.show}` : ''}`)),
      h('div', { class: 'upload-job-status' },
        h('span', { class: `tag ${j.status === 'failed' ? 'red' : ''}` }, t(STATUS_LABEL[j.status] || j.status)),
        h('span', { class: 'muted small' }, detail),
        ['failed', 'cancelled'].includes(j.status) ? h('button', { class: 'btn info small', onclick: () => send(`/api/uploads/${j.id}/retry`, 'POST').then(poll) }, t('Retry')) : null,
        h('button', { class: 'btn info small', onclick: () => send(`/api/uploads/${j.id}`, 'DELETE').then(poll) }, busy || j.status === 'queued' ? t('Cancel') : t('Clear'))),
      busy ? h('div', { class: 'upload-bar' }, h('span', { style: `width:${p}%` })) : null);
  };
  const draw = () => list.replaceChildren(...(data.jobs.length ? data.jobs.map(jobRow) : [h('p', { class: 'muted' }, t('Nothing sent yet.'))]));
  async function poll() {
    if (!section.isConnected && list.childElementCount) return; // left the page
    data = await api('/api/uploads').catch(() => data);
    draw();
    clearTimeout(poll.timer);
    if (data.jobs.some((j) => ['queued', 'downloading', 'uploading'].includes(j.status))) poll.timer = setTimeout(poll, 2000);
  }
  draw();
  setTimeout(poll, 2000);

  section.append(
    h('p', { class: 'muted' }, t('Connected as '), h('strong', {}, google.email || t('your Google account')), '. ',
      h('button', { class: 'linkish', onclick: async () => { await send('/api/google/disconnect', 'POST'); refresh(); } }, t('Disconnect'))),
    h('p', { class: 'muted small' }, t('Paste one link per row (pasting several lines at once fills several rows). The server downloads each file, uploads it to Drive and deletes its own copy; the library refreshes when it’s done.')),
    form, h('h3', {}, t('Recent')), list);
  return section;
}

// ---------- Account settings: language and own password ----------

export function viewAccount(view) {
  const langChoice = (code, label) => h('button', { type: 'button', class: `chip-link${lang === code ? ' on' : ''}`, lang: code, 'aria-pressed': String(lang === code),
    onclick: () => (lang === code ? null : setLanguage(code)) }, label);
  const language = h('section', { class: 'settings-block' },
    h('h2', {}, t('Language')),
    h('p', { class: 'muted' }, t('Choose the language for menus and buttons on all your devices.')),
    h('div', { class: 'chips' }, langChoice('en', 'English'), langChoice('ar', 'العربية')));
  const done = h('p', { class: 'form-ok', hidden: true }, t('Password changed. Other devices have been signed out.'));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const form = h('form', { class: 'account-form', onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = done.hidden = true;
    if (form.next.value !== form.confirm.value) {
      error.textContent = t('The new passwords don’t match.');
      error.hidden = false;
      return;
    }
    try {
      await send('/api/me/password', 'POST', { current: form.current.value, next: form.next.value });
      form.reset();
      done.hidden = false;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  } },
    field(t('Current password'), { name: 'current', type: 'password', required: true, autocomplete: 'current-password' }),
    field(t('New password'), { name: 'next', type: 'password', required: true, minlength: '6', autocomplete: 'new-password' }),
    field(t('Confirm new password'), { name: 'confirm', type: 'password', required: true, minlength: '6', autocomplete: 'new-password' }),
    error, done,
    h('button', { class: 'btn play', type: 'submit' }, t('Change password')));
  view.replaceChildren(h('div', { class: 'page top-pad narrow' },
    h('div', { class: 'page-head' }, h('h1', {}, t('Account settings'))),
    h('div', { class: 'profile-head big' }, avatar(me, 48), h('div', {}, h('strong', {}, me.name), h('small', {}, `@${me.username}`))),
    language,
    h('section', { class: 'settings-block' }, h('h2', {}, t('Change password')), form)));
}
