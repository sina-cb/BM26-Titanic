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
    GET /api/models      JSON {models:[...], default} — rig list for the picker
    GET /live            LIVE visualizer of the running engine's vis WS
    GET /live/<name>     same, with the pattern name as a caption
    GET /live_client.js  the live renderer (browser module)
    GET /api/live-layout model-aware layout JSON (?model=<name>)
    *                    clean 404

  OFFLINE vs ONLINE: /, /grid, /compare, /w/<name> are OFFLINE — they replay
  pre-rendered clips and need no engine. /live is ONLINE — it streams the
  running engine's per-pixel vis over ws://<engineHost>/ws/viz. engineHost
  resolves: /live?host= > gallery_config.json "engineHost" > 127.0.0.1:6968.

  All chrome pages carry a global MODEL PICKER (header). The active rig flows
  through every link as ?model=<rig> (persisted in the querystring + localStorage)
  so list/grid/compare and /live?model= all agree on the rig.
*/
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';
// <!-- BEGIN live-vis -->
import { buildLiveLayout } from './live_layout.mjs';
// <!-- END live-vis -->


function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WIDGETS_DIR = path.join(HERE, 'widgets');
const CONFIG_PATH = path.join(HERE, 'gallery_config.json');
const DEFAULT_PORT = 6965;

// <!-- BEGIN model-select -->
// Rig models live in marsin_engine/models/<model>.js (the gallery sits two
// levels down at marsin_engine/tools/gallery/). The default rig is
// test_bench — clips for it are published bare (<pattern>.html, no __model
// suffix); other rigs publish <pattern>__<model>.html.
const MODELS_DIR = path.join(HERE, '..', '..', 'models');
const DEFAULT_MODEL = 'test_bench';
// <!-- END model-select -->

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

// <!-- BEGIN live-vis -->
// marsin_engine/ — used to import models/<name>.js for the live layout.
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const HERE_DIR = HERE; // for serving live_client.js statically
const DEFAULT_ENGINE_HOST = '127.0.0.1:6968';
const LIVE_CLIENT_PATH = path.join(HERE, 'live_client.js');
// host:port for the running engine's vis WS. A present-but-malformed config
// value is fatal (codex P0: no silent fallback). host:port must be a bare
// authority — no scheme, no path.
const SAFE_HOST = /^[A-Za-z0-9._-]+:\d{1,5}$/;
function configEngineHost() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    process.stderr.write('FATAL: ' + CONFIG_PATH + ' is not valid JSON: ' + e.message + '\n');
    process.exit(1);
  }
  if (cfg.engineHost === undefined || cfg.engineHost === null) return null;
  if (typeof cfg.engineHost !== 'string' || !SAFE_HOST.test(cfg.engineHost)) {
    process.stderr.write('FATAL: ' + CONFIG_PATH + ' "engineHost" must be "host:port", got: ' + cfg.engineHost + '\n');
    process.exit(1);
  }
  return cfg.engineHost;
}
// Resolution: ?host= query (per-request) > gallery_config.json engineHost >
// DEFAULT_ENGINE_HOST. The config value is resolved once at startup; the query
// override is applied per request in the /live handler.
const ENGINE_HOST = configEngineHost() || DEFAULT_ENGINE_HOST;
// <!-- END live-vis -->


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

// <!-- BEGIN model-select -->
// List rig model names from marsin_engine/models/. A model is a bare
// "<name>.js" file (PixelMap definition); the parallel ".effects.js",
// ".viewmasks.js", and ".js.original" siblings are NOT rigs, so we only take
// files whose name is exactly "<name>.js" with no inner dots in <name>.
// test_bench is always present and is the default; it is hoisted to the front.
function listModels() {
  let entries;
  try {
    entries = fs.readdirSync(MODELS_DIR, { withFileTypes: true });
  } catch {
    // No models dir reachable: still offer the default so the picker works.
    return [DEFAULT_MODEL];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.js')) continue;          // skips ".js.original"
    const base = e.name.slice(0, -'.js'.length);    // "test_bench", "test_bench.effects", ...
    if (base.includes('.')) continue;               // skips ".effects"/".viewmasks" siblings
    if (!SAFE_NAME.test(base)) continue;
    out.push(base);
  }
  out.sort();
  // Hoist the default rig to the front so it reads as the obvious starting point.
  const i = out.indexOf(DEFAULT_MODEL);
  if (i > 0) { out.splice(i, 1); out.unshift(DEFAULT_MODEL); }
  else if (i === -1) out.unshift(DEFAULT_MODEL);
  return out;
}

// Resolve the requested ?model= against the real rig list. Unknown/garbage
// falls back to the default (the picker only ever offers real models, but a
// hand-typed querystring shouldn't 404 the whole page).
function resolveModel(req) {
  const list = listModels();
  if (req && SAFE_NAME.test(req) && list.includes(req)) return req;
  return DEFAULT_MODEL;
}
// <!-- END model-select -->

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
  /* <!-- BEGIN model-select --> Prominent global rig picker in the header. */
  .modelbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
    margin:2px 2px 12px; padding:10px 12px; background:#101820;
    border:1px solid #234; border-radius:14px; }
  .modelbar .mb-lbl { font-size:12px; letter-spacing:1px; text-transform:uppercase;
    color:#8fb; font-weight:700; }
  .modelbar .mb-sel-wrap { position:relative; flex:1 1 200px; min-width:0; }
  .modelbar select { width:100%; appearance:none; -webkit-appearance:none;
    padding:11px 38px 11px 14px; font-size:16px; font-weight:600; border-radius:10px;
    border:1px solid #2f6a4f; background:#0d1f17; color:#bfeede; outline:none; }
  .modelbar select:focus { border-color:#3a6; }
  .modelbar .mb-sel-wrap::after { content:'\\25be'; position:absolute; right:14px; top:50%;
    transform:translateY(-50%); color:#8fb; pointer-events:none; font-size:14px; }
  .modelbar .mb-active { font-size:12px; color:#9bd; white-space:nowrap; }
  .modelbar .mb-active b { color:#bfeede; }
  .modelbar .mb-live { text-decoration:none; font-size:13px; color:#bfeede;
    background:#173026; border:1px solid #2f6a4f; border-radius:999px; padding:7px 14px;
    white-space:nowrap; }
  /* <!-- END model-select --> */
`;

function navStrip(active) {
  const links = [
    ['/', 'List'],
    ['/grid', 'Grid'],
    ['/compare', 'Compare'],
    // <!-- BEGIN live-vis -->
    ['/live', 'Live'],
    // <!-- END live-vis -->
  ];
  return '<nav class="nav">' + links.map(([href, lbl]) =>
    `<a href="${href}"${href === active ? ' class="on"' : ''}>${lbl}</a>`).join('') + '</nav>';
}

// <!-- BEGIN model-select -->
// Prominent, global MODEL PICKER for the header. Server-renders the <select>
// with the active rig preselected and shows "Viewing <model>" so the operator
// always sees which rig the gallery is showing. The sibling agent owns the
// /live route; we only LINK to /live?model=<active> so the choice carries over.
function modelBar(activeModel) {
  const models = listModels();
  const opts = models.map((m) =>
    `<option value="${esc(m)}"${m === activeModel ? ' selected' : ''}>` +
    `${esc(m)}${m === DEFAULT_MODEL ? ' (default)' : ''}</option>`).join('');
  return '<div class="modelbar">' +
    '<span class="mb-lbl">Model</span>' +
    '<span class="mb-sel-wrap">' +
      `<select id="model-pick" aria-label="Active rig model">${opts}</select>` +
    '</span>' +
    `<span class="mb-active">Viewing <b id="model-active">${esc(activeModel)}</b></span>` +
    `<a class="mb-live" id="model-live" href="/live?model=${encodeURIComponent(activeModel)}">Live &rsaquo;</a>` +
    '</div>';
}

// Client-side glue shared by every chrome page: persists the chosen model to
// the querystring + localStorage and re-navigates the current route with the
// new ?model= so list/grid/compare all stay model-aware. Self-contained, no
// deps. ACTIVE is the server-resolved model; on first load we honour an
// explicit ?model= over storage, else fall back to a remembered model.
function modelScript(activeModel) {
  return `<script>
(function () {
  var KEY = 'gallery.model';
  var ACTIVE = ${JSON.stringify(activeModel)};
  var DEFAULT = ${JSON.stringify(DEFAULT_MODEL)};
  var sel = document.getElementById('model-pick');
  if (!sel) return;
  var url = new URL(window.location.href);
  var qpModel = url.searchParams.get('model');
  // If the URL has no ?model= but we remember one (and it's a real option),
  // redirect once so the rest of the page renders for the remembered rig.
  if (!qpModel) {
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    var known = Array.prototype.some.call(sel.options, function (o) { return o.value === stored; });
    if (stored && known && stored !== ACTIVE) {
      url.searchParams.set('model', stored);
      window.location.replace(url.toString());
      return;
    }
  }
  // Remember whatever the server resolved so future no-querystring visits stick.
  try { localStorage.setItem(KEY, ACTIVE); } catch (e) {}
  sel.addEventListener('change', function () {
    var m = sel.value;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    var u = new URL(window.location.href);
    u.searchParams.set('model', m);
    window.location.assign(u.toString());
  });
})();
</script>`;
}
// <!-- END model-select -->

// ---------------------------------------------------------------------------
// Index page: grouped/sorted cards with search + family/model filter chips.
// Sorting and grouping happen client-side over a JSON payload so toggles are
// instant and no extra round-trips are needed on the phone.
// ---------------------------------------------------------------------------
function indexPage(activeModel) {
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
  .badge.fb { background:#231a12; border-color:#5a3; color:#e9c87a; }
  .variants { display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
  .variants a { text-decoration:none; font-size:12px; background:#15151d; border:1px solid #24242f;
    border-radius:8px; padding:3px 9px; color:#bfeede; }
  .t { color:#778; font-size:12px; white-space:nowrap; }
  .empty { color:#778; padding:24px 6px; }
</style></head><body>
<header>
  <h1>Titanic Pattern Gallery <span class="sub">OFFLINE REVIEW</span></h1>
  ${navStrip('/')}
  ${modelBar(activeModel)}
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
  // <!-- BEGIN model-select -->
  const ACTIVE_MODEL = ${JSON.stringify(activeModel)};
  const DEFAULT_MODEL = ${JSON.stringify(DEFAULT_MODEL)};
  // Querystring suffix to carry the active rig onto every /w/ link.
  const MODEL_QS = '?model=' + encodeURIComponent(ACTIVE_MODEL);
  // <!-- END model-select -->
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

  // <!-- BEGIN model-select -->
  // For the active rig, the variant we want is: the one whose model matches
  // ACTIVE_MODEL, or (when ACTIVE_MODEL is test_bench) the bare base clip.
  // If that exact clip is missing we fall back to the base (test_bench) clip so
  // the operator still sees SOMETHING, and flag it as a fallback so the card
  // can note "(test_bench)".
  function pickVariant(fam) {
    const wantBase = ACTIVE_MODEL === DEFAULT_MODEL;
    const exact = wantBase
      ? fam.variants.find(v => !v.model)
      : fam.variants.find(v => v.model === ACTIVE_MODEL);
    if (exact) return { clip: exact, fallback: false };
    const base = fam.variants.find(v => !v.model) || fam.variants[0];
    return { clip: base, fallback: true };
  }
  // <!-- END model-select -->

  function cardHtml(fam) {
    // <!-- BEGIN model-select -->
    // Lead the card with the chosen model's clip (falling back to test_bench).
    const pick = pickVariant(fam);
    const lead = pick.clip;
    const wHref = '/w/' + encodeURIComponent(lead.name) + MODEL_QS;
    const fallbackNote = pick.fallback
      ? '<span class="badge fb">no ' + esc(ACTIVE_MODEL) + ' clip \\u2014 (test_bench)</span>'
      : '';
    // <!-- END model-select -->
    const variantLinks = fam.variants.length > 1
      ? '<div class="variants">' + fam.variants.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v =>
          '<a href="/w/' + encodeURIComponent(v.name) + MODEL_QS + '">' + (v.model ? v.model : 'base') + '</a>').join('') + '</div>'
      : '';
    const numBadge = fam.num ? '<span class="badge">#' + fam.num + '</span>' : '';
    const t = new Date(fam.mtime);
    const pad = n => String(n).padStart(2, '0');
    const ts = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    return '<a class="card" href="' + wHref + '">' +
      '<span class="cl"><span class="nm">' + fam.label + '</span>' +
      '<span class="meta">' + numBadge + fallbackNote +
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
${modelScript(activeModel)}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Grid / contact-sheet: many live clips at once. Each clip is an <iframe> to
// /w/<name>; we only set src when the tile scrolls near the viewport
// (IntersectionObserver) and blank it again when it leaves, so a phone never
// runs dozens of rAF loops at once. Built-ins only — no libraries.
// ---------------------------------------------------------------------------
function gridPage(activeModel) {
  const items = listWidgets().slice().sort(byNumber);
  const data = items.map((it) => ({
    name: it.name, label: it.label, num: it.num, model: it.model, family: it.family,
  }));
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
  .tile .cap .md.fb { color:#e9c87a; }
  .placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    color:#445; font-size:12px; }
  .empty { color:#778; padding:24px 6px; }
</style></head><body>
<header>
  <h1>Pattern Grid <span class="sub">CONTACT SHEET</span></h1>
  ${navStrip('/grid')}
  ${modelBar(activeModel)}
  <input id="q" type="search" placeholder="Filter&hellip;" autocomplete="off" autocapitalize="off">
  <div id="count"></div>
</header>
<main class="grid" id="grid"></main>
<script>
  const DATA = ${payload};
  // <!-- BEGIN model-select -->
  const ACTIVE_MODEL = ${JSON.stringify(activeModel)};
  const DEFAULT_MODEL = ${JSON.stringify(DEFAULT_MODEL)};
  const MODEL_QS = '?model=' + encodeURIComponent(ACTIVE_MODEL);

  // Collapse the flat clip list into one tile PER FAMILY, showing the active
  // rig's clip (or the test_bench base as a flagged fallback). This keeps the
  // contact sheet showing "what this rig looks like" rather than every variant.
  function gridTiles() {
    const map = new Map();
    for (const it of DATA) {
      let g = map.get(it.family);
      if (!g) { g = { family: it.family, label: it.label, num: it.num, variants: [] }; map.set(it.family, g); }
      g.variants.push(it);
    }
    const wantBase = ACTIVE_MODEL === DEFAULT_MODEL;
    const tiles = [];
    for (const g of map.values()) {
      const exact = wantBase
        ? g.variants.find(v => !v.model)
        : g.variants.find(v => v.model === ACTIVE_MODEL);
      const clip = exact || g.variants.find(v => !v.model) || g.variants[0];
      tiles.push({ name: clip.name, label: g.label, num: g.num, model: ACTIVE_MODEL, fallback: !exact });
    }
    return tiles;
  }
  const TILES = gridTiles();
  // <!-- END model-select -->
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
    a.href = '/w/' + encodeURIComponent(it.name) + MODEL_QS;
    const md = it.fallback
      ? '<span class="md fb">(test_bench)</span>'
      : (it.model ? '<span class="md">' + it.model + '</span>' : '');
    const src = '/w/' + encodeURIComponent(it.name) + MODEL_QS;
    a.innerHTML =
      '<div class="frame">' +
        '<iframe loading="lazy" data-src="' + src + '" title="' + it.label + '"></iframe>' +
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
    for (const it of TILES) {
      if (v && !(it.name + ' ' + it.label + ' ' + (it.model || '')).toLowerCase().includes(v)) continue;
      const t = tile(it);
      grid.appendChild(t);
      io.observe(t);
      shown++;
    }
    if (!shown) grid.innerHTML = '<div class="empty">No matching patterns.</div>';
    count.textContent = shown + ' pattern' + (shown === 1 ? '' : 's') + ' on ' + ACTIVE_MODEL;
  }

  q.addEventListener('input', render);
  if (!DATA.length) {
    grid.innerHTML = '<div class="empty">No patterns published yet. Run tools/gallery/publish.mjs.</div>';
  } else {
    render();
  }
</script>
${modelScript(activeModel)}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Compare: two clips side by side. Pickers when a/b not both given.
// ---------------------------------------------------------------------------
function comparePage(a, b, activeModel) {
  const items = listWidgets().slice().sort(byNumber);
  const names = new Set(items.map((it) => it.name));
  const validA = a && names.has(a) ? a : '';
  const validB = b && names.has(b) ? b : '';
  // <!-- BEGIN model-select --> Carry the active rig onto every /w/ link.
  const mqs = '?model=' + encodeURIComponent(activeModel);
  // <!-- END model-select -->
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
      `<iframe src="/w/${encodeURIComponent(name)}${mqs}" title="${esc(name)}"></iframe></div>`;
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
  ${modelBar(activeModel)}
  <form class="pickers" method="get" action="/compare" id="f">
    <input type="hidden" name="model" value="${esc(activeModel)}">
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
${modelScript(activeModel)}
</body></html>`;
}

// <!-- BEGIN live-vis -->
// ---------------------------------------------------------------------------
// Live page: a LIVE visualizer of the running engine's per-pixel vis buffer.
//
// Unlike the offline clip views (pre-rendered HTML in widgets/), this page
// connects a browser WebSocket to ws://<engineHost>/ws/viz, decodes the chosen
// buffer (master|rig), and paints the rig LIVE. The WS buffer carries no
// coordinates, so the layout is computed SERVER-side from the active model
// (?model=<name>, default test_bench) and embedded here; the client positions
// pixels from it. Connection state is shown explicitly — connected vs not
// reachable — and we never show fake/zero data when disconnected (codex P0).
//
// host resolution: ?host= > gallery_config.json engineHost > 127.0.0.1:6968.
// model: ?model=<name> (FAIL LOUD if the model file is missing — returns 500).
// buffer: ?buffer=master|rig (default master). patternLabel: optional, just a
// caption (the gallery never drives the engine; load the pattern in the engine).
// ---------------------------------------------------------------------------
async function livePage(opts) {
  const model = opts.model;
  const host = opts.host;
  const buffer = opts.buffer === 'rig' ? 'rig' : 'master';
  const patternLabel = opts.patternLabel || '';

  // Model-aware layout (throws if the model file is missing — caller maps that
  // to a 500 with the loud message, never a silent test_bench fallback).
  const spec = await buildLiveLayout(ENGINE_DIR, model, { buffer });

  // Build the layout body markup (empty cells; the client fills them live).
  let bodyHtml = '';
  if (spec.layoutMode === 'map') {
    const L = spec.layout;
    bodyHtml = `<div id="live-map" style="position:relative;width:${L.W}px;height:${L.H}px;max-width:100%;margin:0 auto;"></div>`;
  } else {
    for (let s = 0; s < spec.layout.sections.length; s++) {
      const sec = spec.layout.sections[s];
      const sub = sec.axis === 'x' ? 'swipe x' : 'swipe y · ' + sec.cols.length + ' strip(s)';
      bodyHtml += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">` +
        `<span style="font-size:12px;letter-spacing:1px;color:#9aa;">${esc(sec.name.toUpperCase())}</span>` +
        `<span style="font-size:11px;color:#667;">${sub}</span></div>`;
      if (sec.axis === 'x') {
        bodyHtml += `<div id="live_r${s}" style="display:flex;gap:2px;height:28px;margin-bottom:16px;"></div>`;
      } else {
        bodyHtml += `<div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:16px;">` +
          sec.cols.map((_, k) => `<div id="live_r${s}_${k}" style="display:flex;flex-direction:column;gap:3px;"></div>`).join('') +
          `</div>`;
      }
    }
  }

  // The client config: the model-aware layout + connection params. Only the
  // serializable layout (no functions) goes over the wire.
  const cfg = {
    host, buffer, model: spec.model, pixelCount: spec.pixelCount,
    layoutMode: spec.layoutMode, layout: spec.layout,
  };
  const cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c');

  const layoutNote = spec.layoutMode === 'map'
    ? 'physical map · ' + spec.view + ' · ' + spec.pixelCount + 'px'
    : 'strip · ' + spec.pixelCount + 'px';

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Gallery — Live</title>
<style>
${THEME_CSS}
  :root {
    --border-radius-lg: 14px;
    --color-border-tertiary: #1d1d26;
    --color-text-secondary: #9aa;
    --color-text-tertiary: #667;
  }
  .live-bar { display:flex; align-items:center; gap:12px; margin:0 2px 10px; flex-wrap:wrap; }
  .live-status { font-size:13px; padding:6px 12px; border-radius:999px; border:1px solid #1d1d26;
    background:#12121a; white-space:nowrap; }
  .live-status.connecting { color:#cda; border-color:#3a3a20; }
  .live-status.up { color:#bfeede; border-color:#2f6a4f; background:#102a20; }
  .live-status.down { color:#f7a7a7; border-color:#6a2f2f; background:#2a1010; }
  .seg { display:inline-flex; border:1px solid #1d1d26; border-radius:999px; overflow:hidden; }
  .seg button { background:#12121a; color:#9aa; border:0; padding:6px 12px; font-size:13px; cursor:pointer; }
  .seg button.on { background:#173026; color:#bfeede; }
  #live-pp { font-size:13px; background:#12121a; color:#9bd; border:1px solid #1d1d26;
    border-radius:999px; padding:6px 14px; cursor:pointer; }
  .live-meta { color:#667; font-size:12px; }
  .live-stage { background:#06060a; border-radius:var(--border-radius-lg); padding:18px 20px;
    border:0.5px solid var(--color-border-tertiary); overflow:auto; }
  .live-host { color:#9bd; }
</style></head><body>
<header>
  <h1>Live Visualizer <span class="sub">LIVE ENGINE</span></h1>
  ${navStrip('/live')}
  <div class="live-bar">
    <span id="live-status" class="live-status connecting">○ connecting…</span>
    <span class="seg" id="live-buf">
      <button data-buf="master"${buffer === 'master' ? ' class="on"' : ''}>master</button>
      <button data-buf="rig"${buffer === 'rig' ? ' class="on"' : ''}>rig</button>
    </span>
    <button id="live-pp">Pause</button>
    <span class="live-meta">model <b>${esc(spec.model)}</b> · ${esc(layoutNote)} · engine <span class="live-host">${esc(host)}</span>${patternLabel ? ' · ' + esc(patternLabel) : ''}</span>
  </div>
</header>
<main>
  <div class="live-stage">
    ${bodyHtml}
  </div>
  <p class="live-meta" style="margin:12px 2px;">
    <b>master</b> = DECK MAIN composition · <b>rig</b> = post dimmers/FX (hardware truth).
    The gallery never drives the engine — load a pattern in the engine, this view mirrors its vis.
    Override the engine with <code>?host=ip:port</code>, the rig with <code>?model=titanic</code>.
  </p>
</main>
<script>window.__LIVE__ = ${cfgJson};</script>
<script src="/live_client.js"></script>
</body></html>`;
}
// <!-- END live-vis -->

// ---------------------------------------------------------------------------
// Widget page: the published clip with a sticky bar + prev/next nav.
// ---------------------------------------------------------------------------
function widgetPage(name, activeModel) {
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
  // <!-- BEGIN model-select -->
  // Keep the operator's chosen rig as they walk clips and return to the gallery.
  const mqs = activeModel ? '?model=' + encodeURIComponent(activeModel) : '';
  const modelTag = activeModel
    ? `<span style="font-size:11px;color:#bfeede;background:#173026;border:1px solid #2f6a4f;` +
      `border-radius:999px;padding:2px 8px;white-space:nowrap;">${esc(activeModel)}</span>`
    : '';
  // <!-- END model-select -->
  const navBtn = (target, sym, title) => target
    ? `<a href="/w/${encodeURIComponent(target)}${mqs}" title="${esc(title)}" ` +
      `style="color:#9bd;text-decoration:none;font-size:18px;padding:0 6px;">${sym}</a>`
    : `<span style="color:#33333c;font-size:18px;padding:0 6px;">${sym}</span>`;
  // The published page is already a full self-contained document. Inject a
  // sticky top bar right after <body> so review is one tap from the gallery.
  const bar = `<div style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:10px;` +
    `padding:10px 14px;background:#08080cE6;backdrop-filter:blur(8px);` +
    `border-bottom:1px solid #1d1d26;font:14px/1 -apple-system,system-ui,sans-serif;color:#e6e9ee;">` +
    `<a href="/${mqs}" style="color:#7cc;text-decoration:none;font-size:14px;">&larr; gallery</a>` +
    `<span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>` +
    modelTag +
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

  // <!-- BEGIN model-select -->
  // Resolve the active rig once per request from ?model= (validated against
  // the real models dir; unknown -> default). Threaded into every page so the
  // picker, links, and variant fallback all agree on the active rig.
  const reqModel = typeof u.query.model === 'string' ? u.query.model : '';
  const activeModel = resolveModel(reqModel);
  // <!-- END model-select -->

  if (pathname === '/') {
    return send(res, 200, 'text/html; charset=utf-8', indexPage(activeModel));
  }

  if (pathname === '/grid') {
    return send(res, 200, 'text/html; charset=utf-8', gridPage(activeModel));
  }

  if (pathname === '/compare') {
    const a = typeof u.query.a === 'string' ? u.query.a : '';
    const b = typeof u.query.b === 'string' ? u.query.b : '';
    if ((a && !SAFE_NAME.test(a)) || (b && !SAFE_NAME.test(b))) {
      return notFound(res, 'Bad pattern name.');
    }
    return send(res, 200, 'text/html; charset=utf-8', comparePage(a, b, activeModel));
  }

  if (pathname === '/api/list') {
    return send(res, 200, 'application/json; charset=utf-8',
      JSON.stringify(listWidgets().map((it) => ({
        name: it.name, mtime: it.mtime, num: it.num, family: it.family, model: it.model,
      }))));
  }

  // <!-- BEGIN model-select -->
  // Rig list for the model picker. The UI reads this to populate the <select>;
  // `default` is the rig the gallery starts on when no ?model= is given.
  if (pathname === '/api/models') {
    return send(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ models: listModels(), default: DEFAULT_MODEL }));
  }
  // <!-- END model-select -->

  if (pathname.startsWith('/w/')) {
    const name = pathname.slice('/w/'.length);
    if (!SAFE_NAME.test(name)) return notFound(res, 'Bad pattern name.');
    const page = widgetPage(name, activeModel);
    if (page == null) return notFound(res, 'No such pattern: ' + name);
    return send(res, 200, 'text/html; charset=utf-8', page);
  }

  // <!-- BEGIN live-vis -->
  // Static client module for the live visualizer (served from this dir).
  if (pathname === '/live_client.js') {
    let js;
    try {
      js = fs.readFileSync(LIVE_CLIENT_PATH, 'utf8');
    } catch (e) {
      return notFound(res, 'live_client.js missing: ' + e.message);
    }
    return send(res, 200, 'application/javascript; charset=utf-8', js);
  }

  // /live and /live/<name>: the LIVE visualizer page. <name> is just a caption
  // (the gallery never drives the engine). Resolves model/host/buffer from the
  // query, builds the model-aware layout, and serves the page. A missing model
  // file fails LOUD (500), never a silent test_bench fallback.
  if (pathname === '/live' || pathname.startsWith('/live/')) {
    return handleLive(req, res, u, pathname);
  }

  // /api/live-layout?model=<name>[&buffer=]: the raw model-aware layout JSON
  // (what /live embeds). Useful for the sibling model-picker / debugging.
  if (pathname === '/api/live-layout') {
    return handleLiveLayout(req, res, u);
  }
  // <!-- END live-vis -->

  return notFound(res, 'Unknown path: ' + pathname);
});

// <!-- BEGIN live-vis -->
// Resolve the engine host: ?host= query > config/default. Validated to a bare
// host:port authority so it can be dropped into ws://<host>/ws/viz.
function resolveHost(u) {
  const q = typeof u.query.host === 'string' ? u.query.host.trim() : '';
  if (q) {
    if (!SAFE_HOST.test(q)) return { error: 'Bad ?host= (want host:port): ' + q };
    return { host: q };
  }
  return { host: ENGINE_HOST };
}

function resolveLiveModel(u) {
  const m = typeof u.query.model === 'string' && u.query.model ? u.query.model : 'test_bench';
  if (!SAFE_NAME.test(m)) return { error: 'Bad ?model= name: ' + m };
  return { model: m };
}

async function handleLive(req, res, u, pathname) {
  const hr = resolveHost(u);
  if (hr.error) return notFound(res, hr.error);
  const mr = resolveLiveModel(u);
  if (mr.error) return notFound(res, mr.error);
  const buffer = u.query.buffer === 'rig' ? 'rig' : 'master';
  // /live/<name>: caption only.
  let patternLabel = '';
  if (pathname.startsWith('/live/')) {
    patternLabel = pathname.slice('/live/'.length);
    if (patternLabel && !SAFE_NAME.test(patternLabel)) return notFound(res, 'Bad pattern name.');
  }
  try {
    const page = await livePage({ model: mr.model, host: hr.host, buffer, patternLabel });
    return send(res, 200, 'text/html; charset=utf-8', page);
  } catch (e) {
    // FAIL LOUD: missing model file / bad meta is a 500 with the real reason.
    return send(res, 500, 'text/html; charset=utf-8',
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<style>body{background:#0a0a0e;color:#f7a7a7;font:16px/1.5 system-ui,sans-serif;padding:2rem;}` +
      `a{color:#7cc;}code{color:#cdd;}</style></head><body><h1>Live error</h1>` +
      `<p>${esc(e.message)}</p><p><a href="/live?model=test_bench">try test_bench</a> · ` +
      `<a href="/">gallery</a></p></body></html>`);
  }
}

async function handleLiveLayout(req, res, u) {
  const mr = resolveLiveModel(u);
  if (mr.error) return notFound(res, mr.error);
  const buffer = u.query.buffer === 'rig' ? 'rig' : 'master';
  try {
    const spec = await buildLiveLayout(ENGINE_DIR, mr.model, { buffer });
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(spec));
  } catch (e) {
    return send(res, 500, 'application/json; charset=utf-8',
      JSON.stringify({ error: e.message }));
  }
}
// <!-- END live-vis -->


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
  lines.push('  routes: /  /grid  /compare  /live  /w/<name>  /api/list  /api/models  /api/live-layout');
  lines.push('  models: ' + listModels().join(', ') + '  (default ' + DEFAULT_MODEL + ')');
  lines.push('  engine host (live vis): ' + ENGINE_HOST + '  (override with /live?host=ip:port)');
  lines.push('  widgets dir: ' + WIDGETS_DIR);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
});
