/*
  serve.cjs — self-serve MIDI discovery tool server.

  DEV/DISCOVERY TOOL ONLY. Completely separate from engine.js / launcher.js.
  Node built-ins only (http, fs, path, url) — no npm deps, no CDNs (offline rule).

  Why a browser page? Node has no built-in MIDI and the codex forbids adding
  native midi packages. The Web MIDI API (same one CaptainPad uses) reads every
  controller on the bus — so the capture UI lives in index.html and this server
  only (a) serves that page and (b) receives the exported JSON.

  Port 6979 — deliberately outside the dev stack's port set (6967-6972).

  Routes:
    GET  /            → index.html (the discovery UI)
    GET  /<asset>     → sibling static file (e.g. discovery.js), sandboxed to dir
    POST /capture     → write exported JSON into captures/<safe-name>_<ts>.json
    *                 → clean 404

  Run (from marsin_engine/, or anywhere):
    node tools/midi_discovery/serve.cjs
    node tools/midi_discovery/serve.cjs --port 6979
  Then open http://127.0.0.1:6979
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_PORT = 6979;
// The dev stack lives on 6967-6972; refuse to collide with it.
const STACK_PORTS = new Set([6967, 6968, 6969, 6970, 6971, 6972]);
const HERE = __dirname;
const CAPTURES_DIR = path.join(HERE, 'captures');
const MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MB — sysex dumps can be large

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

// Turn an arbitrary device name into a filesystem-safe slug. Collapses any run
// of non [a-z0-9] into a single underscore, trims leading/trailing underscores,
// lowercases, caps length. Empty/garbage input yields a stable fallback so we
// never write a dotfile or an empty-named file.
function safeDeviceName(name) {
  const slug = String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return slug || 'unknown_device';
}

// UTC timestamp yyyymmdd_hhmmss. Takes a Date so tests are deterministic.
function timestampStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

// Compose the capture filename. Pure — no I/O.
function captureFilename(deviceName, date) {
  return `${safeDeviceName(deviceName)}_${timestampStamp(date)}.json`;
}

// Validate the exported payload enough to fail loudly on garbage, then write it
// pretty-printed into capturesDir. Returns the absolute path written.
// Throws on invalid payload or write failure — no silent fallback.
function writeCapture(capturesDir, payload, date) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('capture payload must be a JSON object');
  }
  if (payload.tool !== 'midi_discovery') {
    throw new Error(`unexpected tool field: ${JSON.stringify(payload.tool)}`);
  }
  const device = payload.device;
  const deviceName =
    device && typeof device === 'object' && typeof device.name === 'string'
      ? device.name
      : 'device';
  const filename = captureFilename(deviceName, date);
  fs.mkdirSync(capturesDir, { recursive: true });
  const abs = path.join(capturesDir, filename);
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return abs;
}

function parsePortArg(argv) {
  const i = argv.indexOf('--port');
  if (i === -1) return DEFAULT_PORT;
  const raw = argv[i + 1];
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid --port value: ${JSON.stringify(raw)}`);
  }
  return port;
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  // Only files directly in this dir — resolve and confirm containment so a
  // crafted ../ path can't escape the tool directory.
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const abs = path.resolve(HERE, rel);
  if (abs !== HERE && !abs.startsWith(HERE + path.sep)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const type = CONTENT_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  });
}

function handleCapture(req, res) {
  const chunks = [];
  let total = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: 'payload too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      sendJson(res, 400, { error: `invalid JSON: ${err.message}` });
      return;
    }
    try {
      const abs = writeCapture(CAPTURES_DIR, payload, new Date());
      console.log(`[midi_discovery] wrote capture ${abs}`);
      sendJson(res, 200, { ok: true, path: abs, filename: path.basename(abs) });
    } catch (err) {
      console.error(`[midi_discovery] capture write failed: ${err.message}`);
      sendJson(res, 400, { error: err.message });
    }
  });
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/capture') {
      handleCapture(req, res);
      return;
    }
    if (req.method === 'GET') {
      serveStatic(res, req.url.split('?')[0]);
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
  });
}

function main() {
  const port = parsePortArg(process.argv);
  if (STACK_PORTS.has(port)) {
    console.error(
      `[midi_discovery] refusing port ${port}: reserved for the dev stack (6967-6972)`,
    );
    process.exit(1);
  }
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[midi_discovery] serving http://127.0.0.1:${port}`);
    console.log(`[midi_discovery] captures → ${CAPTURES_DIR}`);
  });
}

// Only start a server when run directly; importing (tests) gets the helpers.
if (require.main === module) {
  main();
}

module.exports = {
  safeDeviceName,
  timestampStamp,
  captureFilename,
  writeCapture,
  parsePortArg,
  createServer,
  DEFAULT_PORT,
  STACK_PORTS,
  CAPTURES_DIR,
};
