// DriveStream front end: hash-routed single page, no build step.
//   #/            home: hero, Continue watching, Recently added, categories, genres
//   #/c/<slug>    category
//   #/t/<id>      title details (seasons and episodes for shows)
//   #/w/<fileId>  player (?from=0 to start over)
//   #/s/<query>   search
//   #/admin       manage profiles (admins)
//   #/account     account settings: language, change password
//   #/link        approve a TV's sign-in code (?code=ABC123 from its QR)

import { h, icon, api, send, appDownloads, credit, posterUrl, backdropUrl, tmdbImg, fmtRuntime, fmtSize, qualityBadge, img } from './ui.js';
import { openPlayer } from './player.js';
import { me, loadMe, showLogin, renderProfileMenu, viewAdmin, viewAccount, viewLink } from './profiles.js';
import { tvMode, confirmDialog } from './tv.js'; // remote-control navigation on TVs
import { t, t as tr, tName, epLabel } from './i18n.js'; // viewTitle names the title `t`, so it translates with `tr`

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const search = document.getElementById('search');
let lib = null;
let cleanup = () => {};
let lastBrowseHash = '#/';
let browsedInApp = false; // so the player's Back can use history instead of guessing

async function loadLibrary() {
  lib = await api('/api/library');
  renderNavLinks();
  return lib;
}

// ---------- shared pieces ----------

function renderNavLinks() {
  const links = document.getElementById('nav-links');
  const cur = location.hash || '#/';
  links.replaceChildren(
    h('a', { href: '#/', class: cur === '#/' ? 'active' : null }, t('Home')),
    ...lib.categories.map((c) => h('a', { href: `#/c/${c.slug}`, class: cur === `#/c/${c.slug}` ? 'active' : null }, tName(c.name))),
  );
}

function metaLine(it, extra = []) {
  const bits = [];
  if (it.rating) bits.push(h('span', { class: 'match' }, `★ ${it.rating.toFixed(1)}`));
  if (it.year) bits.push(h('span', {}, String(it.year)));
  if (it.kind === 'show') bits.push(h('span', {}, it.seasonCount > 1 ? t('{n} Seasons', { n: it.seasonCount }) : it.episodeCount === 1 ? t('1 Episode') : t('{n} Episodes', { n: it.episodeCount })));
  else if (it.durationMs) bits.push(h('span', {}, fmtRuntime(Math.round(it.durationMs / 60000))));
  const q = qualityBadge(it.quality);
  if (q) bits.push(h('span', { class: 'chip' }, q));
  bits.push(...extra);
  return h('div', { class: 'meta' }, bits);
}

function fallbackTile(it) {
  return h('div', { class: 'tile-fallback' }, h('span', {}, it.title), it.year ? h('small', {}, String(it.year)) : null);
}

const isNew = (it) => it.addedAt && Date.now() - Date.parse(it.addedAt) < 10 * 86400_000;

// Quick details shown over a poster on hover / keyboard focus.
function quickInfo(it) {
  const bits = [
    it.rating ? h('span', { class: 'match' }, `★ ${it.rating.toFixed(1)}`) : null,
    it.year ? h('span', {}, String(it.year)) : null,
    it.kind === 'show'
      ? h('span', {}, it.seasonCount > 1 ? t('{n} Seasons', { n: it.seasonCount }) : t('{n} Ep.', { n: it.episodeCount }))
      : it.durationMs ? h('span', {}, fmtRuntime(Math.round(it.durationMs / 60000))) : null,
    qualityBadge(it.quality) ? h('span', { class: 'chip' }, qualityBadge(it.quality)) : null,
  ];
  return h('div', { class: 'poster-info', 'aria-hidden': 'true' },
    h('strong', {}, it.title),
    h('div', { class: 'poster-meta' }, bits),
    it.genres.length ? h('div', { class: 'poster-genres' }, it.genres.slice(0, 3).map(tName).join(' • ')) : null);
}

function posterCard(it) {
  return h('a', { class: 'poster', href: `#/t/${it.id}`, 'aria-label': `${it.title}${it.year ? ` (${it.year})` : ''}` },
    img(posterUrl(it), '', null, () => fallbackTile(it)),
    isNew(it) ? h('span', { class: 'ribbon' }, t('New')) : null,
    quickInfo(it));
}

function continueCard(c) {
  const it = c.item;
  const pct = c.d ? Math.min(100, (c.t / c.d) * 100) : 0;
  const card = h('div', { class: 'landscape-wrap' },
    h('a', { class: 'landscape', href: `#/w/${c.fileId}`, 'aria-label': t('Continue {title}', { title: it.title }) },
      h('div', { class: 'landscape-img' },
        img(tmdbImg(it.backdrop, 'w780') || `/thumb/${c.fileId}?s=780`, '', null, () => fallbackTile(it)),
        h('span', { class: 'landscape-play' }, icon('play')),
        pct ? h('div', { class: 'bar' }, h('div', { style: `width:${pct}%` })) : null),
      h('div', { class: 'landscape-text' },
        h('strong', {}, it.title),
        c.label ? h('span', {}, c.upNext ? t('Up next · {label}', { label: epLabel(c.label) }) : epLabel(c.label)) : null)),
    // The ✕ (on TVs: a long press of OK, see tv.js) asks first.
    h('button', { class: 'remove-btn', title: t('Remove from Continue Watching'), 'aria-label': t('Remove {title} from Continue Watching', { title: it.title }), onclick: () => {
      confirmDialog({ title: t('Remove from Continue Watching?'), text: it.title, ok: t('Remove'), focusCancel: true, onOk: () => remove() });
    } }, '✕'));
  async function remove() {
    await send('/api/continue/hide', 'POST', { itemId: it.id }).catch(() => {});
    const row = card.closest('.row');
    // On a TV, focus moves on to the card beside it.
    const near = card.nextElementSibling || card.previousElementSibling;
    card.remove();
    if (row && !row.querySelector('.landscape-wrap')) row.remove();
    else if (tvMode) near?.querySelector('.landscape')?.focus();
  }
  return card;
}

function row(title, cards, kind = 'posters') {
  if (!cards.length) return null;
  const track = h('div', { class: `track ${kind}` }, cards);
  const scroll = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
  return h('section', { class: 'row' },
    h('h2', {}, title),
    h('div', { class: 'row-body' },
      h('button', { class: 'arrow left', 'aria-label': t('Scroll left'), tabindex: '-1', onclick: () => scroll(-1) }, icon('chevronL')),
      track,
      h('button', { class: 'arrow right', 'aria-label': t('Scroll right'), tabindex: '-1', onclick: () => scroll(1) }, icon('chevronR'))));
}

function hero(it, { compact = false } = {}) {
  if (!it) return null;
  const resume = lib.continue.find((c) => c.item.id === it.id);
  return h('section', { class: `hero${compact ? ' compact' : ''}` },
    h('div', { class: 'hero-bg' }, img(backdropUrl(it, 'original'), '', null, () => h('div', { class: 'hero-blank' }))),
    h('div', { class: 'hero-content' },
      h('h1', { class: 'hero-title' }, it.title),
      metaLine(it),
      it.overview ? h('p', { class: 'hero-overview' }, it.overview) : null,
      h('div', { class: 'actions' },
        h('a', { class: 'btn play', href: resume ? `#/w/${resume.fileId}` : `#/t/${it.id}?play=1` }, icon('play'), resume ? t('Resume') : t('Play')),
        h('a', { class: 'btn info', href: `#/t/${it.id}` }, icon('info'), t('More info')))));
}

function pickHero(items) {
  const pool = items.filter((i) => i.backdrop).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')).slice(0, 8);
  const list = pool.length ? pool : items.slice(0, 8);
  return list[Math.floor(Math.random() * list.length)];
}

const byAdded = (a, b) => (b.addedAt || '').localeCompare(a.addedAt || '');

function message(title, text, ...extra) {
  return h('div', { class: 'message' }, h('h2', {}, title), text ? h('p', {}, text) : null, extra);
}

function statusFooter() {
  const s = lib.status;
  const when = s.scannedAt ? new Date(s.scannedAt).toLocaleString() : t('never');
  const btn = h('button', { class: 'link-btn', onclick: async () => {
    btn.disabled = true;
    btn.lastChild.textContent = t('Refreshing…');
    await api('/api/rescan', { method: 'POST' });
    pollUntilScanned(() => route());
  } }, icon('refresh'), h('span', {}, s.scanning ? t('Refreshing…') : t('Refresh library')));
  if (s.scanning) btn.disabled = true;
  const footer = h('footer', { class: 'status' },
    h('span', {}, t('{n} titles · last scanned {when}', { n: lib.items.length, when })),
    s.error ? h('span', { class: 'warn' }, t('Last scan failed: {error}', { error: s.error })) : null,
    !s.tmdb ? h('span', { class: 'warn' }, t('Add TMDB_API_KEY in .env for posters and plots')) : null,
    btn);
  footer.append(credit());
  appDownloads().then((el) => el && footer.prepend(el));
  return footer;
}

let poll;
function pollUntilScanned(done) {
  clearInterval(poll);
  poll = setInterval(async () => {
    const l = await api('/api/library').catch(() => null);
    if (l && !l.status.scanning) {
      clearInterval(poll);
      done();
    }
  }, 2500);
}

// ---------- views ----------

async function viewHome() {
  await loadLibrary();
  const { items, categories } = lib;
  if (!items.length) {
    if (lib.status.scanning) pollUntilScanned(() => route());
    const local = lib.status.storage === 'local';
    view.replaceChildren(message(
      lib.status.scanning ? (local ? t('Scanning your library…') : t('Scanning your Google Drive…')) : t('Your library is empty'),
      lib.status.scanning
        ? t('This takes a few seconds the first time. The page will refresh on its own.')
        : lib.status.error || (local ? t('Add movies and shows to your media folders, then refresh.') : t('Add movies and shows to your Drive folders, then refresh.')),
    ), statusFooter());
    return;
  }

  const genreCount = new Map();
  for (const it of items) for (const g of it.genres) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  const topGenres = [...genreCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);

  view.replaceChildren(
    hero(pickHero(items)),
    h('div', { class: 'rows' },
      row(t('Continue Watching'), lib.continue.map(continueCard), 'landscapes'),
      row(t('Recently Added'), [...items].sort(byAdded).slice(0, 24).map(posterCard)),
      categories.map((c) => row(tName(c.name), items.filter((i) => i.category === c.slug).sort(byAdded).map(posterCard))),
      topGenres.map((g) => row(tName(g), items.filter((i) => i.genres.includes(g)).map(posterCard))),
    ),
    statusFooter(),
  );
}

async function viewCategory(slug, params) {
  await loadLibrary();
  const cat = lib.categories.find((c) => c.slug === slug);
  if (!cat) return view.replaceChildren(message(t('Category not found')));
  const all = lib.items.filter((i) => i.category === slug);
  const genre = params.get('g') || '';
  const sort = params.get('sort') || 'added';
  const genres = [...new Set(all.flatMap((i) => i.genres))].sort((a, b) => tName(a).localeCompare(tName(b))); // by the name shown
  const sorters = {
    added: byAdded,
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  };
  const list = all.filter((i) => !genre || i.genres.includes(genre)).sort(sorters[sort] || byAdded);
  const link = (g, s) => `#/c/${slug}?` + new URLSearchParams({ ...(g ? { g } : {}), ...(s !== 'added' ? { sort: s } : {}) });

  view.replaceChildren(
    hero(pickHero(all), { compact: true }),
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('h1', {}, tName(cat.name)),
        h('select', { class: 'select', 'aria-label': t('Sort'), onchange: (e) => (location.hash = link(genre, e.target.value)) },
          Object.entries({ added: 'Recently added', title: 'A–Z', year: 'Newest', rating: 'Top rated' })
            .map(([v, label]) => h('option', { value: v, selected: v === sort }, t(label))))),
      genres.length ? h('div', { class: 'chips' },
        h('a', { class: `chip-link${!genre ? ' on' : ''}`, href: link('', sort) }, t('All')),
        genres.map((g) => h('a', { class: `chip-link${g === genre ? ' on' : ''}`, href: link(g, sort) }, tName(g)))) : null,
      list.length ? h('div', { class: 'grid' }, list.map(posterCard)) : message(t('Nothing here yet'), lib.status.storage === 'local'
        ? t('Add files to your {name} folder.', { name: cat.name })
        : t('Add files to your {name} folder on Drive.', { name: cat.name }))),
  );
}

async function viewSearch(q) {
  if (!lib) await loadLibrary();
  if (search.value !== q) search.value = q;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = lib.items.filter((it) => {
    const hay = [it.title, it.year, ...it.genres, ...it.genres.map(tName), it.overview].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  view.replaceChildren(h('div', { class: 'page top-pad' },
    h('div', { class: 'page-head' }, h('h1', {}, hits.length ? t('Results for “{q}”', { q }) : t('No results for “{q}”', { q }))),
    hits.length ? h('div', { class: 'grid' }, hits.map(posterCard)) : h('p', { class: 'muted' }, t('Try a different title, genre or year.'))));
}

async function viewTitle(id, params) {
  if (!lib) await loadLibrary();
  const t = await api(`/api/title/${id}`);
  if (params.get('play')) {
    location.replace(`#/w/${t.resume.fileId}`);
    return;
  }

  const playLabel = t.resume.t > 0 ? (t.kind === 'show' ? tr('Resume {label}', { label: epLabel(t.resume.label) }) : tr('Resume')) : t.kind === 'show' && t.resume.label !== 'S1:E1' ? tr('Play {label}', { label: epLabel(t.resume.label) }) : tr('Play');
  const actions = h('div', { class: 'actions' },
    h('a', { class: 'btn play', href: `#/w/${t.resume.fileId}` }, icon('play'), playLabel),
    t.resume.t > 0 ? h('a', { class: 'btn info', href: `#/w/${t.resume.fileId}?from=0` }, tr('Start over')) : null);

  const extras = [];
  if (t.kind === 'movie' && t.subs.length) extras.push(h('span', { class: 'chip' }, 'CC'));
  const details = [];
  if (t.genres.length) details.push(h('p', {}, h('span', { class: 'muted' }, tr('Genres: ')), t.genres.map(tName).join('، ')));
  if (t.kind === 'movie') {
    if (t.versions.length) details.push(h('p', {}, h('span', { class: 'muted' }, tr('Available in: ')),
      t.versions.map((v) => [v.height ? `${v.height}p` : tr('Original'), fmtSize(v.size) && ` (${fmtSize(v.size)})`].join('')).join(' · ')));
    if (t.subs.length) details.push(h('p', {}, h('span', { class: 'muted' }, tr('Subtitles: ')), t.subs.map((s) => s.label).join(', ')));
  }

  const top = h('section', { class: 'detail-hero' },
    // Portrait phones get the tall poster as the background; wide screens the backdrop.
    h('div', { class: 'hero-bg' }, h('picture', {},
      tmdbImg(t.poster, 'w780') ? h('source', { media: '(orientation: portrait) and (max-width: 900px)', srcset: tmdbImg(t.poster, 'w780') }) : null,
      img(backdropUrl(t, 'original'), '', null, () => h('div', { class: 'hero-blank' })))),
    h('div', { class: 'detail-content' },
      h('div', { class: 'detail-poster' }, img(posterUrl(t), '', null, () => fallbackTile(t))),
      h('div', { class: 'detail-text' },
        h('a', { class: 'back-link', href: lastBrowseHash }, icon('back'), tr('Back')),
        h('h1', { class: 'hero-title' }, t.title),
        metaLine(t, extras),
        actions,
        t.overview ? h('p', { class: 'detail-overview' }, t.overview) : null,
        h('div', { class: 'detail-facts' }, details))));

  const parts = [top];
  if (t.kind === 'show') {
    const list = h('div', { class: 'episodes' });
    const resumeSeason = t.seasons.find((s) => s.episodes.some((e) => e.fileId === t.resume.fileId))?.season ?? t.seasons[0].season;
    const renderSeason = (n) => {
      const s = t.seasons.find((x) => x.season === n);
      list.replaceChildren(...s.episodes.map((e) =>
        h('a', { class: `episode${e.fileId === t.resume.fileId ? ' current' : ''}`, href: `#/w/${e.fileId}` },
          h('span', { class: 'ep-num' }, String(e.episode)),
          h('div', { class: 'ep-img' },
            img(tmdbImg(e.still, 'w300') || `/thumb/${e.fileId}?s=400`, '', null, () => h('div', { class: 'tile-fallback' })),
            h('span', { class: 'landscape-play' }, icon('play')),
            e.progress ? h('div', { class: 'bar' }, h('div', { style: `width:${Math.round(e.progress * 100)}%` })) : null),
          h('div', { class: 'ep-text' },
            h('div', { class: 'ep-head' },
              h('strong', {}, e.name),
              h('span', { class: 'muted' }, [e.runtimeMin ? fmtRuntime(e.runtimeMin) : '', qualityBadge(e.quality) || '', e.hasSubs ? 'CC' : ''].filter(Boolean).join(' · '))),
            e.overview ? h('p', {}, e.overview) : null))));
    };
    // Season tabs (pills, the current one filled), as in the apps.
    const tabs = t.seasons.length > 1
      ? h('div', { class: 'chips season-pills', role: 'tablist', 'aria-label': tr('Season') }, t.seasons.map((s) =>
        h('button', { class: `chip-link${s.season === resumeSeason ? ' on' : ''}`, role: 'tab', 'aria-selected': String(s.season === resumeSeason), onclick: (e) => {
          for (const b of tabs.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', String(b === e.currentTarget)); }
          renderSeason(s.season);
        } }, tName(s.name))))
      : null;
    renderSeason(resumeSeason);
    parts.push(h('section', { class: 'page' },
      h('div', { class: 'page-head' }, h('h2', {}, tr('Episodes')), tabs ? null : h('span', { class: 'muted' }, tName(t.seasons[0].name))),
      tabs, list));
  }
  view.replaceChildren(...parts);
  // On a TV, start on Play.
  if (tvMode) actions.firstChild.focus({ preventScroll: true });
}

async function viewWatch(fileId, params) {
  if (!lib) await loadLibrary().catch(() => {});
  const info = await api(`/api/play/${fileId}`);
  document.body.classList.add('watching');
  const player = openPlayer(info, {
    startAt: params.has('from') ? Number(params.get('from')) || 0 : info.resumeAt,
    onBack: () => (browsedInApp ? history.back() : location.replace(`#/t/${info.item.id}`)),
    onNext: (next) => location.replace(`#/w/${next.fileId}?from=0`),
  });
  view.replaceChildren(player.el);
  player.el.focus();
  cleanup = () => {
    player.destroy();
    document.body.classList.remove('watching');
  };
}

// ---------- router ----------

async function route() {
  cleanup();
  cleanup = () => {};
  clearInterval(poll);
  if (!me) return signIn();
  const [path, qs = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs);
  if (parts[0] !== 'w') {
    lastBrowseHash = location.hash || '#/';
    browsedInApp = true;
  }
  if (parts[0] !== 's' && document.activeElement !== search) search.value = '';
  try {
    if (parts[0] === 'c') await viewCategory(parts[1], params);
    else if (parts[0] === 't') await viewTitle(parts[1], params);
    else if (parts[0] === 'w') await viewWatch(parts[1], params);
    else if (parts[0] === 's') await viewSearch(decodeURIComponent(parts.slice(1).join('/')));
    else if (parts[0] === 'admin') await viewAdmin(view, route);
    else if (parts[0] === 'account') viewAccount(view);
    else if (parts[0] === 'link') viewLink(view, params);
    else await viewHome();
  } catch (e) {
    document.body.classList.remove('watching');
    if (e.status === 401) return;
    view.replaceChildren(message(t('Something went wrong'), e.message, h('a', { class: 'btn play', href: '#/' }, t('Back to home'))));
  }
  if (lib) renderNavLinks();
  if (parts[0] !== 's') window.scrollTo(0, 0);
}

let searchTimer;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = search.value.trim();
    const target = q ? `#/s/${encodeURIComponent(q)}` : '#/';
    if (location.hash.startsWith('#/s/')) location.replace(target);
    else location.hash = target;
  }, 250);
});

window.addEventListener('scroll', () => nav.classList.toggle('solid', window.scrollY > 40), { passive: true });
window.addEventListener('hashchange', route);

// Signed out (session expired, password changed elsewhere, or "Sign out"): show the sign-in screen.
function signIn() {
  cleanup();
  cleanup = () => {};
  lib = null;
  renderProfileMenu();
  showLogin(() => {
    renderProfileMenu(signIn);
    route();
  });
}
window.addEventListener('ds:signed-out', () => {
  if (document.body.classList.contains('signed-out')) return;
  loadMe().then((u) => { if (!u) signIn(); });
});

// Opened from a tile on the Samsung TV's home bar (?open=#/w/… or #/t/…, plus ?via=#/t/… for
// the title behind a video): lay out history as if it had been browsed to — home, the title,
// then the video — so Back steps through them to DriveStream's home instead of out of the app.
(function openFromHomeBar() {
  const q = new URLSearchParams(location.search);
  const open = q.get('open');
  if (!open) return;
  const via = q.get('via');
  q.delete('open');
  q.delete('via');
  const base = `${location.pathname}?${q}`;
  const ok = (hash) => /^#\/[wt]\/[\w-]+$/.test(hash || '');
  if (!ok(open)) return history.replaceState(history.state, '', base + location.hash);
  let depth = 1; // the app's launcher page is step 0 (see leaving the app in tv.js)
  history.replaceState({ dsDepth: depth }, '', `${base}#/`);
  if (ok(via) && via !== open) history.pushState({ dsDepth: ++depth }, '', base + via);
  history.pushState({ dsDepth: ++depth }, '', base + open);
  browsedInApp = true;
})();

loadMe().then((u) => {
  if (!u) return signIn();
  renderProfileMenu(signIn);
  route();
});
