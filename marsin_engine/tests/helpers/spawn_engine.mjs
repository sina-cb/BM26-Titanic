// Shared spawn-engine harness for the end-to-end unit suites.
//
// Seven suites (autosave_gating, deck_dirty_flush, deck_entry_autocapture,
// effects_v2_api, performance_mode, playlist_api, session_param_retention) each
// spawn a REAL engine subprocess on a random high port with MARSIN_STATE_DIR /
// MARSIN_PLAYLISTS_DIR redirected into throwaway temp dirs, poll /status, and
// drive the HTTP API. They had drifted copies of the same scaffolding; this
// factory is the single reconciled source.
//
// `createEngineHarness({ scene, pattern, prefix, portBase, portSpan, extraEnv,
// extraArgs })` returns the shared pieces: `spawnEngine()`, `waitForReady()`,
// `api()`, `teardown()`, the resolved temp dirs (`tmpStateRoot`,
// `playlistsDir`, `stateDir`), the `port`, and `base()` (→
// `http://127.0.0.1:<port>`). Each spawned engine gets
// `BM26_DISABLE_TIMELINE=1` plus the isolation env; pass `extraEnv` for
// suite-specific overrides (e.g. `MARSIN_VSN1_DEPLOY: '0'`) and `extraArgs`
// for extra CLI flags (e.g. `['--dest', '192.0.2.9']` to black-hole the
// spawned engine's sACN output so it can never reach the operator's live sim
// bridge on UDP 5568). Use `192.0.2.x` — TEST-NET-1 (RFC 5737), reserved for
// documentation and never routed. A LOOPBACK dest is NOT a black hole: the
// sim's sACN receiver binds every local interface, so it RECEIVES
// loopback-destined frames and relays them on to the live rig.
//
// This file is NOT a `*.test.*` module, so no test runner picks it up.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/helpers → tests → marsin_engine
const engineDir = path.resolve(__dirname, '..', '..');

export function createEngineHarness(options = {}) {
  const {
    scene,
    pattern = '13_sparkle',
    prefix,
    portBase = 7100,
    portSpan = 300,
    extraEnv = {},
    extraArgs = [],
  } = options;
  if (!Array.isArray(extraArgs)) throw new TypeError('createEngineHarness: `extraArgs` must be an array');
  if (!scene) throw new Error('createEngineHarness: `scene` is required');
  if (!prefix) throw new Error('createEngineHarness: `prefix` is required');

  const tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-states-`));
  const playlistsDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-playlists-`));
  const stateDir = path.join(tmpStateRoot, scene);

  const port = portBase + Math.floor(Math.random() * portSpan);
  const base = () => `http://127.0.0.1:${port}`;

  let proc = null;

  function spawnEngine() {
    proc = spawn(
      'node',
      ['engine.js', '--pattern', pattern, '--model', scene, '--port', String(port), ...extraArgs],
      {
        cwd: engineDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
            BM26_DISABLE_TIMELINE: '1',
            // Every test harness chooses auth mode explicitly. Production
            // launcher sets 1; isolated engine tests do not need operator
            // credentials and must never inherit/guess a private source.
            BM26_CAPTAINPAD_AUTH_REQUIRED: '0',
          // This harness stops engines with proc.kill('SIGTERM'), which on
          // Windows terminates outright WITHOUT running the shutdown handler —
          // so the engine's crash marker survives and every restart here looks
          // like a crash. Left on, the crash-boot policy would revert the deck
          // to the 'default' playlist and stomp whatever a test just restored
          // (it did exactly that to the two playlist-persistence tests).
          // Tests that want to exercise the revert set this back to '0'.
          BM26_DISABLE_CRASH_REVERT: '1',
          MARSIN_STATE_DIR: tmpStateRoot,
          MARSIN_PLAYLISTS_DIR: playlistsDir,
          ...extraEnv,
        },
      },
    );
    proc.stdout.on('data', d => process.stderr.write('[engine] ' + d));
    proc.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
    return proc;
  }

  async function waitForReady(timeoutMs = 25000) {
    const t0 = Date.now();
    let lastErr = null;
    while (Date.now() - t0 < timeoutMs) {
      try {
        const res = await fetch(base() + '/status');
        if (res.ok) {
          const j = await res.json();
          if (j.service === 'marsin-engine') return j;
        }
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('Engine never became ready: ' + (lastErr?.message || 'timeout'));
  }

  async function api(method, path_, body, headers = {}) {
    const res = await fetch(base() + path_, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  async function teardown() {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
      if (!proc.killed) proc.kill('SIGKILL');
    }
  }

  return {
    spawnEngine,
    waitForReady,
    api,
    teardown,
    base,
    get proc() { return proc; },
    tmpStateRoot,
    playlistsDir,
    stateDir,
    port,
    engineDir,
  };
}
