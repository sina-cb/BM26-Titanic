/*
  gallery_launcher.mjs — launch + serve the OFFLINE phone gallery.

  DEV/REVIEW TOOL ONLY. Standalone and self-contained, exactly like its sibling
  server.mjs: Node built-ins only (child_process, fs, path, url, os), no npm
  deps, no CDNs. It is NOT the production stack launcher (root launcher.js) and
  shares no code with it — keep that one lean; this one only ever touches the
  gallery.

  What it adds over `node server.mjs`: it resolves the served port up front
  (same contract as the server: --port > GALLERY_PORT > gallery_config.json >
  6965, malformed config is fatal), prints the Tailscale phone URL prominently,
  then spawns server.mjs pinned to that port so launcher and server can never
  disagree. Ctrl+C tears the server down cleanly.

  ── --regen: one-action clean → generate → serve ────────────────────────────
  With `--regen` the launcher first WIPES the gitignored widgets/ scratch dir
  (the previously generated clips), then regenerates the FULL gallery data via
  gen_variations.mjs (every pattern's STATIC + SOUND variation clips), and only
  THEN serves it. Generation is FAIL-LOUD (codex P0): a compile/render error
  stops the run BEFORE the server starts, so you never serve a half-built
  gallery over stale-but-wiped data. Pass-through flags: --model, --seconds,
  --fps, --pattern (subset; omit for the whole library).

  Start (from marsin_engine/, or anywhere):
    node tools/gallery/gallery_launcher.mjs            # port from gallery_config.json (6965)
    node tools/gallery/gallery_launcher.mjs --port 6965
    GALLERY_PORT=6965 node tools/gallery/gallery_launcher.mjs
    node tools/gallery/gallery_launcher.mjs --regen                 # clean+generate ALL, then serve
    node tools/gallery/gallery_launcher.mjs --regen --model titanic --seconds 10
*/
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'server.mjs');
const GENVAR = path.join(HERE, 'gen_variations.mjs');
const WIDGETS_DIR = path.join(HERE, 'widgets');
const ENGINE_DIR = path.resolve(HERE, '..', '..');   // marsin_engine/
const CONFIG_PATH = path.join(HERE, 'gallery_config.json');
const DEFAULT_PORT = 6965;

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

// ── --regen: clean the old widgets, regenerate the full data, THEN serve ──────
// Wipe only the gitignored generated clips (*.html) — never the tracked
// .gitignore or anything else. Then run gen_variations for the whole library
// (or the requested subset/model). Fail loud and DO NOT serve if generation
// fails, so we never serve over freshly-wiped data (codex P0: no silent half-
// states). Forwards the relevant gen_variations flags through verbatim.
function wipeWidgets() {
  if (!fs.existsSync(WIDGETS_DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(WIDGETS_DIR)) {
    if (f.endsWith('.html')) { fs.unlinkSync(path.join(WIDGETS_DIR, f)); n++; }
  }
  return n;
}

if (flag('regen')) {
  const wiped = wipeWidgets();
  process.stdout.write('\n  [--regen] cleaned ' + wiped + ' old widget(s) from ' + WIDGETS_DIR + '\n');

  // Forward only the gen_variations pass-through flags the operator actually set.
  const passthrough = [];
  for (const name of ['model', 'models', 'seconds', 'fps', 'pattern']) {
    const v = arg(name);
    if (v !== undefined) passthrough.push('--' + name, v);
  }
  process.stdout.write('  [--regen] generating full gallery data (gen_variations.mjs ' +
    passthrough.join(' ') + ') …\n\n');
  try {
    // Inherit stdio so the per-pattern progress + summary stream live; a
    // compile/render error throws here and aborts BEFORE we serve.
    execFileSync(process.execPath, [GENVAR, ...passthrough], { cwd: ENGINE_DIR, stdio: 'inherit' });
  } catch (e) {
    process.stderr.write('\nFATAL: --regen generation failed (' + (e.message || e) +
      ') — NOT serving over the wiped data. Fix the failing pattern and re-run.\n');
    process.exit(1);
  }
  process.stdout.write('\n  [--regen] generation complete — starting server.\n');
}

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
