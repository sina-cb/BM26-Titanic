/*
  server.mjs — standalone OFFLINE phone gallery for reviewing BM26-Titanic
  lighting-pattern visualizations over Tailscale.

  DEV/REVIEW TOOL ONLY. Completely separate from engine.js / launcher.js.
  Node built-ins only (http, fs, path, url, os) — no npm deps, no CDNs.

  Port comes from tools/gallery/gallery_config.json ({"port": 6965}); override
  with --port or GALLERY_PORT. A present-but-malformed config is a hard error
  (codex P0: fail loudly, never silently fall back).

  Start (from marsin_engine/, or anywhere):
    node tools/gallery/server.mjs            # port from gallery_config.json (6965)
    node tools/gallery/server.mjs --port 6965
    GALLERY_PORT=6965 node tools/gallery/server.mjs

  Patterns are named NN_name; a sibling agent may publish per-model variants as
  NN_name__<model>. We split on "__" so a pattern groups with its model variants
  under one card. Families group into number bands (00-09, 10-19, ...).

  Routes:
    GET /                phone index: grouped/sorted cards, search + filter chips
    GET /grid            contact-sheet: many live clip thumbnails (lazy via
                         IntersectionObserver; off-screen clips paused)
    GET /compare         side-by-side: ?a=<name>&b=<name> (pickers if absent)
    GET /w/<name>        standalone widget HTML with sticky bar + prev/next nav
    GET /api/list        JSON [{name, mtime, num, family, model}] newest first
    *                    clean 404
*/
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WIDGETS_DIR = path.join(HERE, 'widgets');
const CONFIG_PATH = path.join(HERE, 'gallery_config.json');
const DEFAULT_PORT = 6965;

// Port resolution: --port arg > GALLERY_PORT env > gallery_config.json port >
// DEFAULT_PORT. A present-but-malformed config is fatal — we never quietly fall
// back to a different port (codex P0: no silent fallbacks).
function configPort() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    process.stderr.write('FATAL: ' + CONFIG_PATH + ' is not valid JSON: ' + e.message + '\n');
    process.exit(1);
  }
  if (cfg.port === undefined || cfg.port === null) return null;
  const p = Number(cfg.port);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) {
    process.stderr.write('FATAL: ' + CONFIG_PATH + ' "port" must be an integer 1..65535, got: ' + cfg.port + '\n');
    process.exit(1);
  }
  return p;
}

const PORT = parseInt(arg('port', process.env.GALLERY_PORT || configPort() || DEFAULT_PORT), 10);

// Reject anything that is not a bare pattern name (no slashes, no traversal).
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Naming convention: NN_name or NN_name__<model>.
//   num    : leading number ("01") or '' if none.
//   model  : text after "__", or '' if no model suffix.
//   family : the pattern identity WITHOUT the model suffix (e.g. "01_cylon_sweep").
//            This is the grouping key — a pattern + all its model variants share it.
//   label  : human label of the family minus the number ("cylon sweep").
// ---------------------------------------------------------------------------
function parseName(name) {
  let family = name;
  let model = '';
  const sep = name.indexOf('__');
  if (sep !== -1) {
    family = name.slice(0, sep);
    model = name.slice(sep + 2);
  }
  const m = /^(\d+)_(.*)$/.exec(family);
  const num = m ? m[1] : '';
  const rest = m ? m[2] : family;
  const label = rest.replace(/_/g, ' ');
  return { num, model, family, label };
}

function listWidgets() {
  let entries;
  try {
    entries = fs.readdirSync(WIDGETS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.html')) continue;
    const name = e.name.slice(0, -'.html'.length);
    if (!SAFE_NAME.test(name)) continue;
    const st = fs.statSync(path.join(WIDGETS_DIR, e.name));
    const meta = parseName(name);
    out.push({ name, mtime: st.mtimeMs, num: meta.num, model: meta.model, family: meta.family, label: meta.label });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// Stable ordering by number then name (for prev/next + default index sort).
function byNumber(a, b) {
  const an = a.num === '' ? Infinity : parseInt(a.num, 10);
  const bn = b.num === '' ? Infinity : parseInt(b.num, 10);
  if (an !== bn) return an - bn;
  return a.name.localeCompare(b.name);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res, msg) {
  send(res, 404, 'text/html; charset=utf-8',
    `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{background:#0a0a0e;color:#cdd;font:16px/1.5 system-ui,sans-serif;padding:2rem;}` +
    `a{color:#7cc;}</style></head><body><h1>404</h1><p>${esc(msg || 'Not found.')}</p>` +
    `<p><a href="/">&larr; gallery</a></p></body></html>`);
}

// Shared theme + nav strip used across the index / grid / compare chrome.
const THEME_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#08080c; color:#e6e9ee;
    font:16px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif;
    padding:max(env(safe-area-inset-top),12px) 12px 32px; }
  a { color:#7cc; }
  header { position:sticky; top:0; background:#08080c; padding-bottom:10px; z-index:5; }
  h1 { font-size:20px; margin:6px 2px 10px; letter-spacing:.5px; }
  h1 .sub { color:#7a8; font-size:12px; font-weight:400; letter-spacing:1px; }
  .nav { display:flex; gap:8px; margin:0 2px 10px; flex-wrap:wrap; }
  .nav a { text-decoration:none; color:#9bd; background:#12121a; border:1px solid #1d1d26;
    border-radius:999px; padding:6px 14px; font-size:13px; }
  .nav a.on { background:#173026; border-color:#2f6a4f; color:#bfeede; }
`;

function navStrip(active) {
  const links = [
    ['/', 'List'],
    ['/grid', 'Grid'],
    ['/compare', 'Compare'],
  ];
  return '<nav class="nav">' + links.map(([href, lbl]) =>
    `<a href="${href}"${href === active ? ' class="on"' : ''}>${lbl}</a>`).join('') + '</nav>';
}

// ---------------------------------------------------------------------------
// Index page: grouped/sorted cards with search + family/model filter chips.
// Sorting and grouping happen client-side over a JSON payload so toggles are
// instant and no extra round-trips are needed on the phone.
// ---------------------------------------------------------------------------
function indexPage() {
  const items = listWidgets();
  const data = items.map((it) => ({
    name: it.name, t: fmtTime(it.mtime), mtime: it.mtime,
    num: it.num, model: it.model, family: it.family, label: it.label,
  }));
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Titanic Pattern Gallery</title>
<style>
${THEME_CSS}
  #q { width:100%; padding:14px 16px; font-size:17px; border-radius:14px;
    border:1px solid #23232c; background:#12121a; color:#e6e9ee; outline:none; }
  #q:focus { border-color:#3a6; }
  .controls { display:flex; gap:8px; align-items:center; margin:10px 2px 4px; flex-wrap:wrap; }
  .controls .lbl { color:#778; font-size:12px; }
  .seg { display:inline-flex; border:1px solid #1d1d26; border-radius:999px; overflow:hidden; }
  .seg button { background:#12121a; color:#9aa; border:0; padding:6px 12px; font-size:13px; }
  .seg button.on { background:#173026; color:#bfeede; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin:8px 2px 2px; }
  .chip { background:#12121a; color:#9aa; border:1px solid #1d1d26; border-radius:999px;
    padding:5px 12px; font-size:13px; cursor:pointer; }
  .chip.on { background:#173026; color:#bfeede; border-color:#2f6a4f; }
  #count { color:#778; font-size:12px; margin:10px 4px 6px; }
  .group-h { color:#7a8; font-size:12px; letter-spacing:1px; text-transform:uppercase;
    margin:18px 4px 8px; border-bottom:1px solid #16161e; padding-bottom:6px; }
  .card { display:flex; justify-content:space-between; align-items:center; gap:10px;
    text-decoration:none; color:#e6e9ee; background:#12121a; border:1px solid #1d1d26;
    border-radius:14px; padding:16px; margin-bottom:10px; }
  .card:active { background:#1a1a26; }
  .cl { min-width:0; }
  .nm { font-size:17px; font-weight:600; word-break:break-word; }
  .meta { color:#778; font-size:12px; margin-top:3px; display:flex; gap:8px; flex-wrap:wrap; }
  .badge { background:#1a1a24; border:1px solid #262633; border-radius:6px; padding:1px 7px; color:#9bd; }
  .variants { display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
  .variants a { text-decoration:none; font-size:12px; background:#15151d; border:1px solid #24242f;
    border-radius:8px; padding:3px 9px; color:#bfeede; }
  .t { color:#778; font-size:12px; white-space:nowrap; }
  .empty { color:#778; padding:24px 6px; }
</style></head><body>
<header>
  <h1>Titanic Pattern Gallery <span class="sub">OFFLINE REVIEW</span></h1>
  ${navStrip('/')}
  <input id="q" type="search" placeholder="Search patterns&hellip;" autocomplete="off" autocapitalize="off">
  <div class="controls">
    <span class="lbl">Sort</span>
    <span class="seg" id="sort">
      <button data-v="num" class="on">Number</button>
      <button data-v="name">Name</button>
      <button data-v="recent">Recent</button>
    </span>
    <span class="seg" id="grp">
      <button data-v="band" class="on">Grouped</button>
      <button data-v="flat">Flat</button>
    </span>
  </div>
  <div class="chips" id="chips"></div>
  <div id="count"></div>
</header>
<main id="list"><div class="empty">Loading&hellip;</div></main>
<script>
  const DATA = ${payload};
  const q = document.getElementById('q');
  const list = document.getElementById('list');
  const count = document.getElementById('count');
  const chipsEl = document.getElementById('chips');
  let sortMode = 'num';
  let grpMode = 'band';
  let activeModel = null; // model name to filter on, or null for All

  function bandOf(num) {
    if (num === '') return { key: 'zz', label: 'Unnumbered' };
    const n = parseInt(num, 10);
    const lo = Math.floor(n / 10) * 10;
    return { key: String(lo).padStart(3, '0'), label: lo + '\\u2013' + (lo + 9) };
  }

  // Collapse variants: one card per family, model variants listed inside it.
  function families() {
    const map = new Map();
    for (const it of DATA) {
      let g = map.get(it.family);
      if (!g) { g = { family: it.family, label: it.label, num: it.num, variants: [], mtime: 0 }; map.set(it.family, g); }
      g.variants.push(it);
      if (it.mtime > g.mtime) g.mtime = it.mtime;
    }
    return Array.from(map.values());
  }

  function buildChips() {
    const models = new Set();
    for (const it of DATA) if (it.model) models.add(it.model);
    const frag = [];
    frag.push('<span class="chip' + (activeModel ? '' : ' on') + '" data-kind="all">All</span>');
    for (const m of Array.from(models).sort()) {
      const on = activeModel === m;
      frag.push('<span class="chip' + (on ? ' on' : '') + '" data-kind="model" data-val="' + m + '">' + m + '</span>');
    }
    chipsEl.innerHTML = frag.join('');
  }

  function matchesFilter(fam) {
    if (!activeModel) return true;
    return fam.variants.some(v => v.model === activeModel);
  }

  function cardHtml(fam) {
    // Default link: the base variant (no model) if present, else first.
    const base = fam.variants.find(v => !v.model) || fam.variants[0];
    const variantLinks = fam.variants.length > 1
      ? '<div class="variants">' + fam.variants.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v =>
          '<a href="/w/' + encodeURIComponent(v.name) + '">' + (v.model ? v.model : 'base') + '</a>').join('') + '</div>'
      : '';
    const numBadge = fam.num ? '<span class="badge">#' + fam.num + '</span>' : '';
    const t = new Date(fam.mtime);
    const pad = n => String(n).padStart(2, '0');
    const ts = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    return '<a class="card" href="/w/' + encodeURIComponent(base.name) + '">' +
      '<span class="cl"><span class="nm">' + fam.label + '</span>' +
      '<span class="meta">' + numBadge +
      (fam.variants.length > 1 ? '<span class="badge">' + fam.variants.length + ' variants</span>' : '') +
      '</span>' + variantLinks + '</span>' +
      '<span class="t">' + ts + '</span></a>';
  }

  function sortFams(fams) {
    if (sortMode === 'name') return fams.sort((a, b) => a.label.localeCompare(b.label));
    if (sortMode === 'recent') return fams.sort((a, b) => b.mtime - a.mtime);
    return fams.sort((a, b) => {
      const an = a.num === '' ? Infinity : parseInt(a.num, 10);
      const bn = b.num === '' ? Infinity : parseInt(b.num, 10);
      if (an !== bn) return an - bn;
      return a.label.localeCompare(b.label);
    });
  }

  function render() {
    const v = q.value.trim().toLowerCase();
    let fams = families().filter(matchesFilter).filter(f => {
      if (!v) return true;
      if (f.family.toLowerCase().includes(v) || f.label.toLowerCase().includes(v)) return true;
      return f.variants.some(x => x.name.toLowerCase().includes(v) || (x.model && x.model.toLowerCase().includes(v)));
    });
    fams = sortFams(fams);
    let html = '';
    if (!fams.length) {
      html = '<div class="empty">No matching patterns.</div>';
    } else if (grpMode === 'band' && sortMode === 'num') {
      const bands = new Map();
      for (const f of fams) {
        const b = bandOf(f.num);
        if (!bands.has(b.key)) bands.set(b.key, { label: b.label, items: [] });
        bands.get(b.key).items.push(f);
      }
      for (const key of Array.from(bands.keys()).sort()) {
        const b = bands.get(key);
        html += '<div class="group-h">' + b.label + '</div>';
        html += b.items.map(cardHtml).join('');
      }
    } else {
      html = fams.map(cardHtml).join('');
    }
    list.innerHTML = html;
    let clips = 0;
    for (const f of fams) clips += f.variants.length;
    count.textContent = fams.length + ' pattern' + (fams.length === 1 ? '' : 's') +
      ' \\u00b7 ' + clips + ' clip' + (clips === 1 ? '' : 's');
  }

  q.addEventListener('input', render);
  document.getElementById('sort').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sortMode = b.dataset.v;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    render();
  });
  document.getElementById('grp').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    grpMode = b.dataset.v;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    render();
  });
  chipsEl.addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    activeModel = c.dataset.kind === 'all' ? null : c.dataset.val;
    buildChips(); render();
  });

  buildChips();
  render();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Grid / contact-sheet: many live clips at once. Each clip is an <iframe> to
// /w/<name>; we only set src when the tile scrolls near the viewport
// (IntersectionObserver) and blank it again when it leaves, so a phone never
// runs dozens of rAF loops at once. Built-ins only — no libraries.
// ---------------------------------------------------------------------------
function gridPage() {
  const items = listWidgets().slice().sort(byNumber);
  const data = items.map((it) => ({ name: it.name, label: it.label, num: it.num, model: it.model }));
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Gallery — Grid</title>
<style>
${THEME_CSS}
  #q { width:100%; padding:12px 14px; font-size:16px; border-radius:12px;
    border:1px solid #23232c; background:#12121a; color:#e6e9ee; outline:none; }
  #q:focus { border-color:#3a6; }
  #count { color:#778; font-size:12px; margin:8px 4px 4px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
  .tile { display:block; background:#0c0c12; border:1px solid #1d1d26; border-radius:12px;
    overflow:hidden; text-decoration:none; color:#e6e9ee; }
  .tile .frame { position:relative; width:100%; height:170px; background:#060608; overflow:hidden; }
  .tile iframe { position:absolute; inset:0; width:128%; height:128%; border:0;
    transform:scale(.78); transform-origin:top left; pointer-events:none; }
  .tile .tap { position:absolute; inset:0; }
  .tile .cap { display:flex; justify-content:space-between; gap:6px; padding:7px 9px;
    font-size:12px; align-items:center; }
  .tile .cap .nm { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tile .cap .md { color:#9bd; font-size:11px; white-space:nowrap; }
  .placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    color:#445; font-size:12px; }
  .empty { color:#778; padding:24px 6px; }
</style></head><body>
<header>
  <h1>Pattern Grid <span class="sub">CONTACT SHEET</span></h1>
  ${navStrip('/grid')}
  <input id="q" type="search" placeholder="Filter&hellip;" autocomplete="off" autocapitalize="off">
  <div id="count"></div>
</header>
<main class="grid" id="grid"></main>
<script>
  const DATA = ${payload};
  const grid = document.getElementById('grid');
  const q = document.getElementById('q');
  const count = document.getElementById('count');

  // Lazy-mount clips: load iframe src when near viewport, blank when far away
  // so off-screen tiles stop animating. rootMargin gives a one-screen lead.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const fr = en.target.querySelector('iframe');
      if (!fr) continue;
      if (en.isIntersecting) {
        if (!fr.src) fr.src = fr.dataset.src;
      } else if (fr.src) {
        fr.removeAttribute('src');
        const ph = en.target.querySelector('.placeholder');
        if (ph) ph.style.display = '';
      }
    }
  }, { rootMargin: '300px 0px' });

  function tile(it) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = '/w/' + encodeURIComponent(it.name);
    const md = it.model ? '<span class="md">' + it.model + '</span>' : '';
    a.innerHTML =
      '<div class="frame">' +
        '<iframe loading="lazy" data-src="/w/' + encodeURIComponent(it.name) + '" title="' + it.label + '"></iframe>' +
        '<div class="placeholder">' + (it.num ? '#' + it.num + ' ' : '') + 'tap to open</div>' +
        '<span class="tap"></span>' +
      '</div>' +
      '<div class="cap"><span class="nm">' + it.label + '</span>' + md + '</div>';
    const fr = a.querySelector('iframe');
    fr.addEventListener('load', () => {
      const ph = a.querySelector('.placeholder');
      if (ph && fr.src) ph.style.display = 'none';
    });
    return a;
  }

  function render() {
    const v = q.value.trim().toLowerCase();
    io.disconnect();
    grid.innerHTML = '';
    let shown = 0;
    for (const it of DATA) {
      if (v && !(it.name + ' ' + it.label + ' ' + (it.model || '')).toLowerCase().includes(v)) continue;
      const t = tile(it);
      grid.appendChild(t);
      io.observe(t);
      shown++;
    }
    if (!shown) grid.innerHTML = '<div class="empty">No matching patterns.</div>';
    count.textContent = shown + ' clip' + (shown === 1 ? '' : 's');
  }

  q.addEventListener('input', render);
  if (!DATA.length) {
    grid.innerHTML = '<div class="empty">No patterns published yet. Run tools/gallery/publish.mjs.</div>';
  } else {
    render();
  }
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Compare: two clips side by side. Pickers when a/b not both given.
// ---------------------------------------------------------------------------
function comparePage(a, b) {
  const items = listWidgets().slice().sort(byNumber);
  const names = new Set(items.map((it) => it.name));
  const validA = a && names.has(a) ? a : '';
  const validB = b && names.has(b) ? b : '';
  const opts = (sel) => '<option value=""' + (sel ? '' : ' selected') + '>— pick —</option>' +
    items.map((it) =>
      `<option value="${esc(it.name)}"${it.name === sel ? ' selected' : ''}>${esc(it.name)}</option>`).join('');
  const pane = (name, side) => {
    if (!name) {
      return `<div class="pane"><div class="phh">Pick a pattern (${side})</div>` +
        `<div class="blank">no clip selected</div></div>`;
    }
    return `<div class="pane">` +
      `<div class="ph">${esc(name)}</div>` +
      `<iframe src="/w/${encodeURIComponent(name)}" title="${esc(name)}"></iframe></div>`;
  };
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Gallery — Compare</title>
<style>
${THEME_CSS}
  .pickers { display:flex; gap:8px; margin:0 2px 10px; flex-wrap:wrap; }
  select { flex:1 1 140px; min-width:0; padding:10px 12px; font-size:14px; border-radius:10px;
    border:1px solid #23232c; background:#12121a; color:#e6e9ee; }
  .panes { display:grid; grid-template-columns:1fr; gap:10px; }
  @media (min-width:680px) { .panes { grid-template-columns:1fr 1fr; } }
  .pane { background:#0c0c12; border:1px solid #1d1d26; border-radius:12px; overflow:hidden; }
  .pane .ph, .pane .phh { font-size:12px; color:#9bd; padding:8px 10px; border-bottom:1px solid #16161e;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pane .phh { color:#667; }
  .pane iframe { width:100%; height:62vh; border:0; background:#060608; display:block; }
  .pane .blank { height:62vh; display:flex; align-items:center; justify-content:center; color:#445; font-size:13px; }
</style></head><body>
<header>
  <h1>Compare <span class="sub">SIDE BY SIDE</span></h1>
  ${navStrip('/compare')}
  <form class="pickers" method="get" action="/compare" id="f">
    <select name="a" id="a">${opts(validA)}</select>
    <select name="b" id="b">${opts(validB)}</select>
  </form>
</header>
<main class="panes">
  ${pane(validA, 'left')}
  ${pane(validB, 'right')}
</main>
<script>
  const f = document.getElementById('f');
  document.getElementById('a').addEventListener('change', () => f.submit());
  document.getElementById('b').addEventListener('change', () => f.submit());
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Widget page: the published clip with a sticky bar + prev/next nav.
// ---------------------------------------------------------------------------
function widgetPage(name) {
  const file = path.join(WIDGETS_DIR, name + '.html');
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // Prev/next over the number-sorted list so stepping through a band is easy.
  const items = listWidgets().slice().sort(byNumber);
  const idx = items.findIndex((it) => it.name === name);
  const prev = idx > 0 ? items[idx - 1].name : '';
  const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1].name : '';
  const navBtn = (target, sym, title) => target
    ? `<a href="/w/${encodeURIComponent(target)}" title="${esc(title)}" ` +
      `style="color:#9bd;text-decoration:none;font-size:18px;padding:0 6px;">${sym}</a>`
    : `<span style="color:#33333c;font-size:18px;padding:0 6px;">${sym}</span>`;
  // The published page is already a full self-contained document. Inject a
  // sticky top bar right after <body> so review is one tap from the gallery.
  const bar = `<div style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:10px;` +
    `padding:10px 14px;background:#08080cE6;backdrop-filter:blur(8px);` +
    `border-bottom:1px solid #1d1d26;font:14px/1 -apple-system,system-ui,sans-serif;color:#e6e9ee;">` +
    `<a href="/" style="color:#7cc;text-decoration:none;font-size:14px;">&larr; gallery</a>` +
    `<span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>` +
    navBtn(prev, '&#8249;', prev ? 'Prev: ' + prev : 'No previous') +
    navBtn(next, '&#8250;', next ? 'Next: ' + next : 'No next') +
    `</div>`;
  if (/<body[^>]*>/i.test(body)) {
    body = body.replace(/(<body[^>]*>)/i, `$1\n${bar}`);
  } else {
    body = bar + body;
  }
  return body;
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const pathname = decodeURIComponent(u.pathname || '/');

  if (req.method !== 'GET') {
    return notFound(res, 'Only GET is supported.');
  }

  if (pathname === '/') {
    return send(res, 200, 'text/html; charset=utf-8', indexPage());
  }

  if (pathname === '/grid') {
    return send(res, 200, 'text/html; charset=utf-8', gridPage());
  }

  if (pathname === '/compare') {
    const a = typeof u.query.a === 'string' ? u.query.a : '';
    const b = typeof u.query.b === 'string' ? u.query.b : '';
    if ((a && !SAFE_NAME.test(a)) || (b && !SAFE_NAME.test(b))) {
      return notFound(res, 'Bad pattern name.');
    }
    return send(res, 200, 'text/html; charset=utf-8', comparePage(a, b));
  }

  if (pathname === '/api/list') {
    return send(res, 200, 'application/json; charset=utf-8',
      JSON.stringify(listWidgets().map((it) => ({
        name: it.name, mtime: it.mtime, num: it.num, family: it.family, model: it.model,
      }))));
  }

  if (pathname.startsWith('/w/')) {
    const name = pathname.slice('/w/'.length);
    if (!SAFE_NAME.test(name)) return notFound(res, 'Bad pattern name.');
    const page = widgetPage(name);
    if (page == null) return notFound(res, 'No such pattern: ' + name);
    return send(res, 200, 'text/html; charset=utf-8', page);
  }

  return notFound(res, 'Unknown path: ' + pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  const lines = [];
  lines.push('');
  lines.push('  Titanic Pattern Gallery (offline review tool)');
  lines.push('  port: ' + PORT);
  lines.push('  local: http://localhost:' + PORT + '/');
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push({ iface: name, addr: ni.address });
    }
  }
  if (addrs.length) {
    lines.push('  network addresses:');
    for (const a of addrs) lines.push('    http://' + a.addr + ':' + PORT + '/   (' + a.iface + ')');
    lines.push('  -> open http://<your-tailscale-ip>:' + PORT + '/ on your phone');
  } else {
    lines.push('  (no external IPv4 found — only reachable on localhost)');
  }
  lines.push('  routes: /  /grid  /compare  /w/<name>  /api/list');
  lines.push('  widgets dir: ' + WIDGETS_DIR);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
});
