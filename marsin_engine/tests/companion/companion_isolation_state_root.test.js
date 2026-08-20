// ░░ The isolated-companion STATE ROOT is real, and it is a temp dir ░░
//
// `isolatedCompanionEnv()` black-holed the Companion's outbound endpoints and
// forced the synthetic source (report `_173`), but until `_214` it left
// `MARSIN_STATE_DIR` alone. `companion_server.js` resolves its analyzer config
// with `loadEffectiveAudioAnalysisConfig({modelName: <--model>})`, so a spawned
// companion booted on `states/<scene>/audio_state.yaml` — the operator's live
// overlay — and any state write it ever gains would have landed in the tracked
// tree.
//
// This file is the proof, in three parts, all of them deterministic (nothing
// here reads or writes the tracked `states/` tree, so a live engine writing
// there concurrently can never make it flake):
//
//   1. A real state WRITE through the real seam (`lib/state_paths.js` →
//      `saveSceneAudio`) lands inside the temp root, and the tracked tree gains
//      nothing — proven with a scene name no repo scene uses.
//   2. A spawned REAL companion RESOLVES that temp root: it boots on a
//      distinctive value planted only there, which the tracked config does not
//      carry.
//   3. The seeded fixtures carry the mic selection and NOTHING else — the
//      `_207` lesson that a copied state file leaks its content even when the
//      path is already redirected.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WebSocket } from 'ws';

import { saveSceneAudio } from '../../audio/config/audio_config_store.js';
import { resolveStateRoot, sceneStateDir } from '../../lib/state_paths.js';
import { assertEngineLinkDown, isolatedCompanionEnv } from '../helpers/companion_isolation.mjs';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ENGINE_DIR, 'audio', 'companion', 'companion_server.js');
const TRACKED_STATES = path.join(ENGINE_DIR, 'states');
const TRACKED_AUDIO_CONFIG = loadTrackedAudioAnalysisConfig(ENGINE_DIR);

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** Run `fn` with `env` applied to this process, restoring every key after. */
function withEnv(env, fn) {
  const previous = new Map();
  for (const key of Object.keys(env)) previous.set(key, process.env[key]);
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('an isolated companion env redirects every state write into a throwaway temp root', () => {
  const isolation = isolatedCompanionEnv('state_root_write');
  // A scene name no repo scene uses, so the tracked-tree assertion below cannot
  // collide with anything the operator's live engine is writing right now.
  const canaryScene = `__isolation_canary_${process.pid}`;
  try {
    assert.ok(
      path.isAbsolute(isolation.stateRoot),
      `MARSIN_STATE_DIR must be absolute, got ${isolation.stateRoot}`,
    );
    assert.equal(isolation.env.MARSIN_STATE_DIR, isolation.stateRoot);
    assert.notEqual(
      path.resolve(isolation.stateRoot),
      path.resolve(TRACKED_STATES),
      `the isolated state root must NOT be the tracked tree (${TRACKED_STATES})`,
    );

    withEnv({ MARSIN_STATE_DIR: isolation.env.MARSIN_STATE_DIR }, () => {
      assert.equal(path.resolve(resolveStateRoot(ENGINE_DIR)), path.resolve(isolation.stateRoot));
      const canaryDir = sceneStateDir(ENGINE_DIR, canaryScene);
      assert.ok(
        path.resolve(canaryDir).startsWith(`${path.resolve(isolation.stateRoot)}${path.sep}`),
        `scene state dir escaped the temp root: ${canaryDir}`,
      );
      // A REAL write through the REAL writer, not a path calculation.
      saveSceneAudio(canaryDir, { capture: { device: 'test' } });
      assert.ok(
        fs.existsSync(path.join(canaryDir, 'audio_state.yaml')),
        `the write did not land in the temp root: ${canaryDir}`,
      );
    });

    assert.equal(
      fs.existsSync(path.join(TRACKED_STATES, canaryScene)),
      false,
      `a state write escaped into the tracked tree: ${path.join(TRACKED_STATES, canaryScene)}`,
    );
  } finally {
    isolation.cleanup();
  }
  assert.equal(
    fs.existsSync(isolation.stateRoot),
    false,
    `cleanup() must remove the temp state root: ${isolation.stateRoot}`,
  );
});

test('the seeded scene fixtures carry the mic selection and nothing else', () => {
  const isolation = isolatedCompanionEnv('state_root_fixture');
  try {
    const scenes = fs.readdirSync(isolation.stateRoot).sort();
    assert.deepEqual(
      scenes,
      fs.readdirSync(TRACKED_STATES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
      'every tracked scene NAME must be seeded, so any --model still boots',
    );
    for (const scene of scenes) {
      const text = fs.readFileSync(
        path.join(isolation.stateRoot, scene, 'audio_state.yaml'), 'utf8');
      // `_207`: a fixture that is a COPY of the live scene file leaks its
      // content even though the path is already redirected. Two keys, no more.
      assert.equal(text, 'capture:\n  device: test\n  platform: auto\n',
        `${scene} fixture is not the two-key mic fixture — did someone copy live state in?`);
    }
  } finally {
    isolation.cleanup();
  }
});

test('a spawned companion resolves the isolated state root, not the tracked tree', async () => {
  const port = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const isolation = isolatedCompanionEnv('state_root_spawn');
  // A value that exists ONLY in the temp root. If the companion reads the
  // tracked tree instead, `hello` carries config.yaml's value and this fails.
  const trackedSilenceConfirmMs =
    TRACKED_AUDIO_CONFIG.derivedSignals.trackChange.silenceConfirmMs;
  const plantedSilenceConfirmMs = trackedSilenceConfirmMs + 137;
  fs.writeFileSync(
    path.join(isolation.stateRoot, 'test_bench', 'audio_state.yaml'),
    'capture:\n  device: test\n  platform: auto\n'
    + `derivedSignals:\n  trackChange:\n    silenceConfirmMs: ${plantedSilenceConfirmMs}\n`,
    'utf8',
  );

  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--model', 'test_bench',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], { cwd: ENGINE_DIR, env: isolation.env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    const started = Date.now();
    let booted = false;
    while (Date.now() - started < 10000 && !booted) {
      try {
        booted = (await fetch(`http://127.0.0.1:${port}/catalog`)).ok;
      } catch { /* still booting */ }
      if (!booted) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(booted, `companion did not boot on ${port}\n${stderr}`);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hello = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no hello frame')), 5000);
      ws.on('message', (buffer) => {
        const message = JSON.parse(buffer.toString());
        if (message.type !== 'hello') return;
        clearTimeout(timeout);
        resolve(message);
      });
      ws.once('error', reject);
    });

    assert.equal(
      hello.derivedConfig.trackChange.silenceConfirmMs,
      plantedSilenceConfirmMs,
      'the spawned companion did NOT read the isolated state root — it resolved '
      + `${path.join(TRACKED_STATES, 'test_bench', 'audio_state.yaml')} instead `
      + `(tracked config.yaml says ${trackedSilenceConfirmMs})`,
    );
    // …and the knobs the fixture does NOT carry come from the TRACKED config,
    // not from the operator's live overlay. Measured pre-`_214` on this box: a
    // spawned companion booted on inputGain 8.83 / noiseGate 0.06 / per-band
    // gates 0.12-0.10-0.14 because it read `states/test_bench/audio_state.yaml`.
    assert.equal(
      hello.inputGain,
      TRACKED_AUDIO_CONFIG.bands.inputGain,
      'the spawned companion is running the operator\'s live input gain, not the tracked one',
    );
    assert.equal(
      hello.gates.noiseGate,
      TRACKED_AUDIO_CONFIG.bands.noiseGate,
      'the spawned companion is running the operator\'s live noise gate, not the tracked one',
    );
    // Same run, same env: the `_173` guarantee must still hold.
    assertEngineLinkDown(hello, assert.ok);
    ws.close();
  } finally {
    proc.kill('SIGKILL');
    isolation.cleanup();
  }
});
