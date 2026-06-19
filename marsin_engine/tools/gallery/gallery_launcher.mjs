/*
  gallery_launcher.mjs — launch + serve the OFFLINE phone gallery.

  DEV/REVIEW TOOL ONLY. Standalone and self-contained, exactly like its sibling
  server.mjs: Node built-ins only (child_process, fs, path, url, os), no npm
  deps, no CDNs. It is NOT the production stack launcher (root launcher.js) and
  shares no code with it — keep that one lean; this one only ever touches the
  gallery.

  What it adds over `node server.mjs`: it resolves the served port up front
  (same contract as the server: --port > GALLERY_PORT > gallery_config.json >
  6765, malformed config is fatal), prints the Tailscale phone URL prominently,
  then spawns server.mjs pinned to that port so launcher and server can never
  disagree. Ctrl+C tears the server down cleanly.

  Start (from marsin_engine/, or anywhere):
    node tools/gallery/gallery_launcher.mjs            # port from gallery_config.json (6765)
    node tools/gallery/gallery_launcher.mjs --port 6765
    GALLERY_PORT=6765 node tools/gallery/gallery_launcher.mjs
*/
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'server.mjs');
const CONFIG_PATH = path.join(HERE, 'gallery_config.json');
const DEFAULT_PORT = 6765;

// Mirror server.mjs's port contract so the URL we print is the port the server
// will actually bind. A present-but-malformed config is fatal — we never
// quietly fall back to a different port (codex P0: no silent fallbacks).
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

// Tailscale hands out addresses in the 100.64.0.0/10 CGNAT range — pick the
// first one so the operator gets a copy-paste phone URL without scanning the
// server's full interface dump.
function tailscaleIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const first = Number(ni.address.split('.')[0]);
      const second = Number(ni.address.split('.')[1]);
      if (first === 100 && second >= 64 && second <= 127) return ni.address;
    }
  }
  return null;
}

const ts = tailscaleIp();
const banner = [
  '',
  '  Titanic Pattern Gallery launcher',
  '  port: ' + PORT,
  ts
    ? '  PHONE (Tailscale): http://' + ts + ':' + PORT + '/'
    : '  (no Tailscale 100.x IPv4 found — is Tailscale up? falling through to localhost only)',
  '  starting server.mjs ...',
  '',
];
process.stdout.write(banner.join('\n') + '\n');

// Spawn the server pinned to the resolved port; inherit stdio so its own
// startup banner (every interface address) still reaches the operator.
const child = spawn(process.execPath, [SERVER, '--port', String(PORT)], { stdio: 'inherit' });

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
child.on('error', (e) => {
  process.stderr.write('FATAL: could not start ' + SERVER + ': ' + e.message + '\n');
  process.exit(1);
});

// Forward termination so Ctrl+C tears the server down with us — no orphans.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
