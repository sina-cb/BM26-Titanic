/*
 * save_now_honesty_e2e.test.js — regression for L5 (reports _115 / _116 / _120):
 * a failed deck/mixer/globals state write must NOT report success. The CaptainPad
 * "✓ SAVED" badge reads POST /settings/save-now's response, so a 200 {saved:true}
 * on a disk-full/EBUSY write is a lie.
 *
 * The remaining L5 root (after W1-1 wrapped the save-now handler in try/catch) was
 * StateManager.save() SWALLOWING the atomic-write error with only a console.warn,
 * so the deck/mixer/globals branch of save-now still succeeded silently on a
 * failed write. `_120` added a STRICT save path used ONLY by the explicit operator
 * save; the ~80 auto-save triggers stay BEST-EFFORT so a transient disk blip never
 * crashes the ship (W1-1's process backstop exits(1) on any surviving throw).
 *
 * This drives a REAL engine.js subprocess (black-holed config; state redirected to
 * a temp dir) and proves BOTH halves over the SAME broken dir:
 *   1. an AUTO-SAVE trigger (POST /global-blackout → best-effort saveGlobals) keeps
 *      the engine UP and answers 200 — no throw, no process backstop;
 *   2. the EXPLICIT save (POST /settings/save-now → strict) returns a non-200
 *      {saved:false}, and the engine is still alive afterward.
 *
 * The timeline is DISABLED here (BM26_DISABLE_TIMELINE=1) so the only writers into
 * the broken state dir are the deck/mixer/globals paths under test — the timeline
 * persistence path is a separate subsystem with its own honesty coverage
 * (tests/timeline/save_write_honesty.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';

import {
  writeBlackHoledConfig, ENGINE_DIR, REPO_DIR, E2E_SCENE, sleep,
} from './timeline_e2e_harness.mjs';

function makeEngine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save_now_honesty-'));
  const stateRoot = path.join(root, 'states');
  const stateDir = path.join(stateRoot, E2E_SCENE); // the StateManager's dir
  const playlistsDir = path.join(root, 'playlists');
  for (const d of [stateRoot, stateDir, playlistsDir]) fs.mkdirSync(d, { recursive: true });

  const realPlaylists = path.join(REPO_DIR, 'simulation', 'scenes', E2E_SCENE, 'playlists');
  for (const f of fs.readdirSync(realPlaylists)) {
    if (f.endsWith('.yaml')) fs.copyFileSync(path.join(realPlaylists, f), path.join(playlistsDir, f));
  }

  const configFile = writeBlackHoledConfig(root);
  // Clear of the pinned 6967-6972 band and the timeline harness's 7700-7899.
  const port = 7500 + Math.floor(Math.random() * 150);
  const base = () => `http://127.0.0.1:${port}`;

  let proc = null;
  let stdout = '';

  function spawnEngine() {
    proc = spawn(
      'node',
      ['engine.js', '--pattern', '13_sparkle', '--model', E2E_SCENE,
        '--port', String(port), '--dest', '127.0.0.9'],
      {
        cwd: ENGINE_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MARSIN_CONFIG_FILE: configFile,
          MARSIN_STATE_DIR: stateRoot,
          MARSIN_PLAYLISTS_DIR: playlistsDir,
          BM26_DISABLE_TIMELINE: '1', // isolate the broken dir to deck/mixer/globals
          MARSIN_VSN1_DEPLOY: '0',
        },
      },
    );
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stdout += d.toString(); });
  }

  async function waitForReady(timeoutMs = 40000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (proc && proc.exitCode !== null) {
        throw new Error(`engine exited (${proc.exitCode}) during boot:\n${stdout.slice(-3000)}`);
      }
      try {
        const res = await fetch(base() + '/status');
        if (res.ok) { const j = await res.json(); if (j.service === 'marsin-engine') return j; }
      } catch { /* not up yet */ }
      await sleep(200);
    }
    throw new Error(`engine never became ready\n${stdout.slice(-3000)}`);
  }

  async function api(method, url, body) {
    const res = await fetch(base() + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  const alive = async () => {
    try { return (await fetch(base() + '/status')).ok; } catch { return false; }
  };

  async function kill() {
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill('SIGTERM');
    const won = await Promise.race([exited.then(() => true), sleep(4000).then(() => false)]);
    if (!won) { proc.kill('SIGKILL'); await Promise.race([exited, sleep(2000)]); }
  }

  async function teardown() {
    await kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  return {
    spawnEngine, waitForReady, api, alive, kill, teardown, base,
    stateDir, get stdout() { return stdout; },
  };
}

// Replace the live state dir with a FILE so every atomic write into it fails at
// openSync (ENOTDIR) — the operator's suggested way to force a write failure.
function breakStateDir(stateDir) {
  fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  fs.writeFileSync(stateDir, 'not a directory', 'utf8');
}

test('save-now returns non-200 on a failed write, while an auto-save over the same broken dir keeps the engine up', async () => {
  const h = makeEngine();
  try {
    h.spawnEngine();
    await h.waitForReady();

    // Sanity: with a healthy dir, save-now is honestly 200 {saved:true}.
    const ok = await h.api('POST', '/settings/save-now');
    assert.equal(ok.status, 200, `healthy save-now should be 200, got ${ok.status}: ${JSON.stringify(ok.data)}`);
    assert.equal(ok.data.saved, true);

    // Now break the state dir so every deck/mixer/globals write fails.
    breakStateDir(h.stateDir);

    // (1) BEST-EFFORT auto-save trigger: /global-blackout → saveGlobals(false).
    // It must swallow the write failure, answer 200, and NOT crash the engine.
    const auto = await h.api('POST', '/global-blackout', { state: true });
    assert.equal(auto.status, 200,
      `auto-save trigger over a broken dir must stay best-effort (200), got ${auto.status}: ${JSON.stringify(auto.data)}`);
    assert.equal(await h.alive(), true, 'engine must survive a best-effort auto-save write failure');

    // (2) EXPLICIT operator save over the SAME broken dir: strict → non-200.
    const strict = await h.api('POST', '/settings/save-now');
    assert.notEqual(strict.status, 200,
      `save-now over a broken dir must NOT report success (the badge must not lie); got ${strict.status}: ${JSON.stringify(strict.data)}`);
    assert.equal(strict.data.saved, false, 'save-now must report saved:false when the write failed');
    assert.ok(strict.data.error, 'save-now should surface the underlying error');

    // The strict failure was CAUGHT by the save-now handler — the engine is still
    // alive, and no survivable write error reached W1-1's fatal process backstop.
    assert.equal(await h.alive(), true, 'engine must survive a strict save failure (handler catches it)');
    assert.doesNotMatch(h.stdout, /ENGINE FATAL/,
      'a caught save failure must never reach the uncaughtException backstop');
  } finally {
    await h.teardown();
  }
});
