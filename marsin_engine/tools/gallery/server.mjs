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

  Routes:
    GET /            phone-friendly index (search + list of widgets)
    GET /w/<name>    standalone widget HTML with sticky top bar
    GET /api/list    JSON [{name, mtime}] newest first
    *                clean 404
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
    out.push({ name, mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
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

function indexPage() {
  const items = listWidgets();
  const data = items.map((it) => ({ name: it.name, t: fmtTime(it.mtime) }));
  const rows = data.map((it) =>
    `<a class="card" href="/w/${encodeURIComponent(it.name)}" data-name="${esc(it.name.toLowerCase())}">` +
    `<span class="nm">${esc(it.name)}</span><span class="t">${esc(it.t)}</span></a>`
  ).join('\n');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Titanic Pattern Gallery</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#08080c; color:#e6e9ee;
    font:16px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif;
    padding:max(env(safe-area-inset-top),12px) 12px 32px; }
  header { position:sticky; top:0; background:#08080c; padding-bottom:10px; z-index:1; }
  h1 { font-size:20px; margin:6px 2px 12px; letter-spacing:.5px; }
  h1 .sub { color:#7a8; font-size:12px; font-weight:400; letter-spacing:1px; }
  #q { width:100%; padding:14px 16px; font-size:17px; border-radius:14px;
    border:1px solid #23232c; background:#12121a; color:#e6e9ee; outline:none; }
  #q:focus { border-color:#3a6; }
  #count { color:#778; font-size:12px; margin:10px 4px 4px; }
  .card { display:flex; justify-content:space-between; align-items:center; gap:10px;
    text-decoration:none; color:#e6e9ee; background:#12121a; border:1px solid #1d1d26;
    border-radius:14px; padding:18px 16px; margin-bottom:10px; }
  .card:active { background:#1a1a26; }
  .nm { font-size:17px; font-weight:600; word-break:break-word; }
  .t { color:#778; font-size:12px; white-space:nowrap; }
  .empty { color:#778; padding:24px 6px; }
</style></head><body>
<header>
  <h1>Titanic Pattern Gallery <span class="sub">OFFLINE REVIEW</span></h1>
  <input id="q" type="search" placeholder="Search patterns&hellip;" autocomplete="off" autocapitalize="off">
  <div id="count"></div>
</header>
<main id="list">
${rows || '<div class="empty">No patterns published yet. Run tools/gallery/publish.mjs.</div>'}
</main>
<script>
  const q = document.getElementById('q');
  const cards = Array.from(document.querySelectorAll('.card'));
  const count = document.getElementById('count');
  function apply() {
    const v = q.value.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const hit = !v || c.dataset.name.includes(v);
      c.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    count.textContent = shown + ' pattern' + (shown === 1 ? '' : 's');
  }
  q.addEventListener('input', apply);
  apply();
</script>
</body></html>`;
}

function widgetPage(name) {
  const file = path.join(WIDGETS_DIR, name + '.html');
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // The published page is already a full self-contained document. Inject a
  // sticky top bar right after <body> so review is one tap from the gallery.
  const bar = `<div style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:12px;` +
    `padding:10px 14px;background:#08080cE6;backdrop-filter:blur(8px);` +
    `border-bottom:1px solid #1d1d26;font:14px/1 -apple-system,system-ui,sans-serif;color:#e6e9ee;">` +
    `<a href="/" style="color:#7cc;text-decoration:none;font-size:14px;">&larr; gallery</a>` +
    `<span style="font-weight:600;">${esc(name)}</span></div>`;
  if (/<body[^>]*>/i.test(body)) {
    body = body.replace(/(<body[^>]*>)/i, `$1\n${bar}`);
  } else {
    body = bar + body;
  }
  return body;
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url);
  const pathname = decodeURIComponent(u.pathname || '/');

  if (req.method !== 'GET') {
    return notFound(res, 'Only GET is supported.');
  }

  if (pathname === '/') {
    return send(res, 200, 'text/html; charset=utf-8', indexPage());
  }

  if (pathname === '/api/list') {
    return send(res, 200, 'application/json; charset=utf-8',
      JSON.stringify(listWidgets().map((it) => ({ name: it.name, mtime: it.mtime }))));
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
  lines.push('  widgets dir: ' + WIDGETS_DIR);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
});
