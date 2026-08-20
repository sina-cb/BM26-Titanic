#!/usr/bin/env node
/**
 * static_web_server.cjs — zero-dependency static file server for a prebuilt
 * CaptainPad web export (`npm run web:build` → CaptainPad/dist).
 *
 * WHY THIS EXISTS (and why it is not `npx serve` / `npx http-server`):
 *   The show server runs OFFLINE (codex P0 — no runtime `npm install`, no CDN).
 *   `serve` is NOT a CaptainPad dependency, so `npm run web:serve` resolves it
 *   through `npx`, which on a playa box with no internet either hangs or fails.
 *   `http-server` is installed under simulation/, not CaptainPad/. Rather than
 *   reach across subsystems or add a dependency, the prod path uses this file:
 *   Node built-ins only, so it can never fail to resolve.
 *
 *   Prod therefore serves the PREBUILT dist instead of running Expo/Metro — no
 *   bundler process, no dev-server watcher, no bundle recompiles mid-show. Dev
 *   profiles keep the Expo dev server (hot reload is the point there).
 *
 * Usage:
 *   node tools/static_web_server.cjs --root <dir> --port <n> [--host <addr>]
 *
 * Options:
 *   --root <dir>   Directory to serve (required). Must exist and contain
 *                  index.html, or the process EXITS 1 — a silently empty web
 *                  root is exactly the failure that reads as "CaptainPad is up"
 *                  to an HTTP probe while the operator gets a blank page.
 *   --port <n>     TCP port (required).
 *   --host <addr>  Bind address (default 0.0.0.0 — the operator's iPad reaches
 *                  CaptainPad over the camp LAN; a loopback bind would make the
 *                  show control surface unreachable from the iPad).
 *
 * Routing (matches an Expo Router STATIC web export):
 *   /             → index.html
 *   /foo          → foo.html if it exists, else foo/index.html
 *   /foo/         → foo/index.html
 *   anything else → 404 (no SPA catch-all rewrite: the export ships one real
 *                   HTML file per route, so rewriting would mask a bad build).
 *
 * Exit codes: 1 = bad/missing arguments or unusable web root.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const DEFAULT_HOST = '0.0.0.0';

function fail(message) {
  process.stderr.write(`  ❌ static_web_server: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { root: null, port: null, host: DEFAULT_HOST };
  const takeValue = (flag, value) => {
    if (value === undefined || value.startsWith('-')) {
      fail(`${flag} requires a value (got ${value === undefined ? 'nothing' : `'${value}'`}).`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--root': opts.root = takeValue('--root', argv[++i]); break;
      case '--port': opts.port = parseInt(takeValue('--port', argv[++i]), 10); break;
      case '--host': opts.host = takeValue('--host', argv[++i]); break;
      default: fail(`unknown option '${argv[i]}'.`);
    }
  }
  if (!opts.root) fail('--root <dir> is required.');
  if (!Number.isInteger(opts.port) || opts.port <= 0 || opts.port > 65535) {
    fail('--port <n> is required and must be a valid TCP port.');
  }
  return opts;
}

// Resolve a request path to a real file inside `root`, or null.
// Every candidate is re-checked against `root` after resolution, so `..` and
// encoded traversal can never escape the web root.
function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (err) {
    return null; // malformed percent-encoding → 404, never a crash
  }
  const clean = decoded.split('?')[0].split('#')[0];
  const rel = clean.replace(/^\/+/, '');
  const base = path.resolve(root);
  const candidates = rel === '' || rel.endsWith('/')
    ? [path.join(base, rel, 'index.html')]
    : [path.join(base, rel), `${path.join(base, rel)}.html`, path.join(base, rel, 'index.html')];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function serve(root, port, host) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('405 Method Not Allowed\n');
      return;
    }
    const file = resolveFile(root, req.url || '/');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${req.url}\n`);
      return;
    }
    const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // The show stack is restarted, not cache-busted: an operator who reloads
    // CaptainPad after a deploy must get the NEW bundle, so HTML is never
    // cached. Hashed asset files under _expo/ are safe to cache for a session.
    const cache = type.startsWith('text/html') ? 'no-store' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file)
      .on('error', (err) => {
        process.stderr.write(`  ❌ static_web_server: read failed for ${file}: ${err.message}\n`);
        res.destroy();
      })
      .pipe(res);
  });
  server.on('error', (err) => fail(`cannot listen on ${host}:${port} — ${err.message}`));
  server.listen(port, host, () => {
    console.log(`[static] serving ${root} on http://${host}:${port} (prebuilt CaptainPad web export)`);
  });
  // The launcher stops children with SIGTERM (POSIX) / taskkill (Windows).
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`[static] ${signal} — closing.`);
      server.close(() => process.exit(0));
    });
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail(`web root does not exist: ${root}. Build it first: (cd CaptainPad && npm run web:build)`);
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    fail(`web root has no index.html: ${root}. Rebuild it: (cd CaptainPad && npm run web:build)`);
  }
  serve(root, opts.port, opts.host);
}

if (require.main === module) main();

module.exports = { parseArgs, resolveFile, MIME_TYPES };
