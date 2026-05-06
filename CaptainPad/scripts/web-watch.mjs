#!/usr/bin/env node
/**
 * web-watch.js — CaptainPad Web Export Watcher
 *
 * Builds the static web export (dist/) on startup, then watches for
 * source changes and rebuilds automatically. Also serves the dist/
 * folder on the configured port.
 *
 * Usage:  node scripts/web-watch.js [--port 6967]
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ── Config ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let port = 6967;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[i + 1], 10);
}

// Try to read port from local config first, then fallback to engine config
try {
  const yaml = (await import('js-yaml')).default;
  const localCfgPath = path.resolve(rootDir, 'config.yaml');
  const engineCfgPath = path.resolve(rootDir, '../marsin_engine/config.yaml');
  
  if (fs.existsSync(localCfgPath)) {
    const cfg = yaml.load(fs.readFileSync(localCfgPath, 'utf8'));
    if (cfg?.client?.web?.port) port = cfg.client.web.port;
  } else if (fs.existsSync(engineCfgPath)) {
    const cfg = yaml.load(fs.readFileSync(engineCfgPath, 'utf8'));
    if (cfg?.client?.web?.port) port = cfg.client.web.port;
  }
} catch (_) {}

// ── Helpers ──────────────────────────────────────────────────────────────
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';

let building = false;
let rebuildQueued = false;
let serveProc = null;

function killPort() {
  try {
    execSync(`npx -y kill-port ${port}`, { stdio: 'ignore', shell: isWin });
  } catch (_) {}
}

function build() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  console.log(`\n  🔨 Building CaptainPad web export...`);
  const start = Date.now();

  const proc = spawn(npx, ['expo', 'export', '--platform', 'web', '-c'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
  });

  proc.on('close', (code) => {
    building = false;
    if (code === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ✅ Build complete (${elapsed}s)`);
      startServe();
    } else {
      console.warn(`  ⚠ Build failed (exit ${code})`);
    }
    if (rebuildQueued) {
      rebuildQueued = false;
      build();
    }
  });
}

function startServe() {
  if (serveProc) return; // already running
  killPort();
  console.log(`  🌐 Serving dist/ on http://localhost:${port}`);
  serveProc = spawn(npx, ['serve', 'dist', '-p', port.toString(), '-s'], {
    cwd: rootDir,
    stdio: 'ignore',
    shell: isWin,
  });
  serveProc.on('close', () => { serveProc = null; });
}

// ── Watch ────────────────────────────────────────────────────────────────
const WATCH_DIRS = ['app', 'components', 'constants', 'styles', 'utils', 'hooks'].map(d => path.join(rootDir, d));
const WATCH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json']);
let debounceTimer = null;

function startWatch() {
  for (const dir of WATCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename);
      if (!WATCH_EXTENSIONS.has(ext)) return;

      // Debounce: wait 500ms after last change before rebuilding
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`  📝 Changed: ${filename}`);
        // Kill serve so the next build gets a fresh dist/
        if (serveProc) {
          serveProc.kill();
          serveProc = null;
        }
        build();
      }, 500);
    });
  }
  console.log(`  👀 Watching for source changes...`);
}

// ── Main ─────────────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n  Shutting down...');
  if (serveProc) serveProc.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`
  ╔══════════════════════════════════════════╗
  ║    🌐 CaptainPad Web Export Watcher      ║
  ╚══════════════════════════════════════════╝
`);

killPort();
build();
startWatch();
