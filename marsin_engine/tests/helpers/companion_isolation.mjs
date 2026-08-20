// Shared isolation for suites that spawn the REAL Audio Companion. Three
// things get neutralised: the OUTBOUND endpoints (engine + OSC), the audio
// SOURCE, and the STATE ROOT. Current consumers:
// tests/companion/companion_derived_patch_order.test.js,
// tests/companion/companion_isolation_state_root.test.js,
// tests/companion/companion_new_signals.test.js,
// tests/companion/companion_osc_accounting.test.js (full env for the booting
// tests, `isolatedStateRoot` alone for the ones whose subject IS the tracked
// config's production endpoints) and
// tests/companion/companion_live_edit_collisions.test.js.
//
// ░░ WHY (incident, report _173) ░░
// companion_server.js reads the ENGINE's config to learn (a) which engine to
// LIVE-SYNC its shared audio tuning against — `companion.engine` — and (b)
// where to send its OSC output — `companion.osc`. The tracked config.yaml
// points both at the OPERATOR'S LIVE STACK (127.0.0.1:6968 and
// 127.0.0.1:10000). Both suites boot the companion and then send
// `{type:'setMode', mode:'test'}`, which write-throughs to the linked engine as
// `PATCH /audio/config {"capture":{"device":"test"}}`. The engine persists that
// into the tracked `states/<scene>/audio_state.yaml` AND rebroadcasts it, so the
// operator's real Companion snapped to the synthetic test generator every time
// the engine suite ran. The spawned companion also opened the operator's USB mic
// and sprayed synthetic audio OSC at the running show.
//
// The fix is the same seam engine.js and the autopilots already use:
// `MARSIN_CONFIG_FILE`. Here we write a scratch copy of config.yaml whose
// companion endpoints are BLACK-HOLED to an unroutable host (see
// BLACK_HOLE_HOST) and whose companion source is `test`, so a spawned
// companion:
//   - can never reach an engine (the link stays DOWN → no write-through),
//   - can never land an OSC packet on the live engine,
//   - never opens the operator's microphone.
//
// Assert it, never assume it: after boot, check `hello.engineLink.connected`
// is false (see `assertEngineLinkDown`). If someone re-points the companion at
// a real engine the assertion fails instead of the operator's show changing.
//
// This file is NOT a `*.test.*` module, so no test runner picks it up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/helpers → tests → marsin_engine
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

/**
 * A genuinely unreachable target host.
 *
 * NOT `127.0.0.9` — measured 2026-08-05 (report _173): the engine binds its API
 * on 0.0.0.0, which accepts connections on EVERY local address, and all of
 * 127.0.0.0/8 is local. A companion pointed at `127.0.0.9:6968` connected
 * straight to the operator's live engine. `192.0.2.1` is RFC 5737 TEST-NET-1 —
 * reserved for documentation and never routed — so a TCP connect can only fail
 * and a UDP datagram can only be dropped.
 */
export const BLACK_HOLE_HOST = '192.0.2.1';

/**
 * The ONLY thing a fresh isolated scene-state file may say: which capture
 * source to use. Deliberately NOT a copy of the operator's scene state (report
 * `_207` — the copy leaked its content, so the test scored the operator's live
 * mic gain / FFT size / live-patched derived groups). Every analyzer knob the
 * Companion needs comes from the tracked `config.yaml`; the scene state
 * contributes only the mic selection, so that is all the fixture carries.
 */
const ISOLATED_SCENE_STATE = 'capture:\n  device: test\n  platform: auto\n';

/**
 * Just the STATE half of the isolation: a fresh throwaway `MARSIN_STATE_DIR`
 * seeded with the two-key mic fixture for every tracked scene NAME, leaving
 * `MARSIN_CONFIG_FILE` untouched.
 *
 * ░░ WHO NEEDS THIS RATHER THAN THE FULL ENV (report `_220`) ░░
 * A test whose SUBJECT is the tracked `config.yaml` — e.g. "a `--no-mic`
 * companion must refuse a port that matches the CONFIGURED production
 * endpoint" — cannot be handed the black-holed scratch config: that rewrites
 * the very endpoint under test (`targetsMatch` compares hosts, so a
 * TEST-NET-1 configured host stops matching the loopback effective one and
 * the refusal the test exists to prove never fires). Such a test still must
 * not read the operator's live scene overlay, so it takes the state root
 * alone.
 *
 * @param {string} prefix  scratch-dir name prefix (per-suite, for debugging)
 * @returns {{ env: object, stateRoot: string, cleanup: () => void }}
 */
export function isolatedStateRoot(prefix) {
  if (!prefix || typeof prefix !== 'string') {
    throw new TypeError(`isolatedStateRoot requires a prefix, got: ${JSON.stringify(prefix)}`);
  }
  // A brand-new state root per call. `loadEffectiveAudioAnalysisConfig` REQUIRES
  // `<root>/<scene>/audio_state.yaml` to exist (a missing file throws — codex
  // P0, no silent default), so seed the fixture for every scene NAME the tracked
  // tree knows about. Names only: no byte of the operator's state is copied, and
  // a `--model` the repo has no scene for still fails exactly as loudly as it
  // did before this redirect existed.
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}_companion_state_`));
  for (const scene of fs.readdirSync(path.join(ENGINE_DIR, 'states'), { withFileTypes: true })) {
    if (!scene.isDirectory()) continue;
    fs.mkdirSync(path.join(stateRoot, scene.name), { recursive: true });
    fs.writeFileSync(path.join(stateRoot, scene.name, 'audio_state.yaml'), ISOLATED_SCENE_STATE, 'utf8');
  }
  return {
    stateRoot,
    env: { ...process.env, MARSIN_STATE_DIR: stateRoot },
    cleanup() {
      try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/**
 * Write a scratch config.yaml whose companion endpoints can't reach anything,
 * plus a fresh throwaway state root, and return the child `env` that points a
 * spawned companion at both.
 *
 * ░░ WHY THE STATE ROOT (report `_214`) ░░
 * `companion_server.js` resolves its analyzer config with
 * `loadEffectiveAudioAnalysisConfig({modelName: <--model>})` — tracked
 * `config.yaml` with `states/<scene>/audio_state.yaml` merged OVER it. Without
 * `MARSIN_STATE_DIR` a spawned companion therefore booted on the OPERATOR'S
 * live overlay (measured on this box: `bands.inputGain` 1 → 8.83, `fftSize`
 * 2048 → 1024 on `test_bench`), so every companion suite was scored against
 * whatever knob had last been turned, and any state write the companion ever
 * gains would land in the tracked tree. Redirecting the state root closes both
 * halves at once: reads resolve to a fresh fixture, writes can only reach a
 * temp dir. `lib/state_paths.js` is the single seam every state path goes
 * through, so this covers writers that do not exist yet as well.
 *
 * @param {string} prefix  scratch-file name prefix (per-suite, for debugging)
 * @returns {{ env: object, configPath: string, stateRoot: string,
 *            cleanup: () => void }}
 */
export function isolatedCompanionEnv(prefix) {
  if (!prefix || typeof prefix !== 'string') {
    throw new TypeError(`isolatedCompanionEnv requires a prefix, got: ${JSON.stringify(prefix)}`);
  }
  // Start from the REAL config so the companion boots on the operator's actual
  // tunables (party thresholds, bpm smoothing, fft sizes) — only the OUTBOUND
  // endpoints and the audio SOURCE are neutralised.
  const cfg = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8'));
  cfg.companion = { ...(cfg.companion || {}) };
  cfg.companion.engine = { ...(cfg.companion.engine || {}), host: BLACK_HOLE_HOST };
  cfg.companion.osc = { ...(cfg.companion.osc || {}), host: BLACK_HOLE_HOST };
  if (!Number.isInteger(cfg.companion.osc.port)) {
    // Without a valid `companion.osc` block the companion falls back to
    // `osc.port` on 127.0.0.1 (hardcoded loopback) — i.e. the live engine.
    // Refuse to hand back an env that leaves that route open.
    throw new Error('isolatedCompanionEnv: config.yaml companion.osc.port must be an integer to black-hole the OSC target');
  }
  // Boot on the synthetic generator: a spawned companion must never open the
  // operator's microphone (both suites switch to `test` anyway).
  cfg.companion.source = 'test';
  cfg.companion.device = null;

  const configPath = path.join(os.tmpdir(), `${prefix}_companion_config_${process.pid}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(cfg), 'utf8');

  // The state half is the same fixture seeding either way — one implementation,
  // shared with the config-sensitive callers that take the state root alone.
  const state = isolatedStateRoot(prefix);

  return {
    configPath,
    stateRoot: state.stateRoot,
    env: { ...state.env, MARSIN_CONFIG_FILE: configPath },
    cleanup() {
      try { fs.rmSync(configPath, { force: true }); } catch { /* best-effort */ }
      state.cleanup();
    },
  };
}

/**
 * Fail the suite unless the spawned companion's engine link is DOWN. `hello` is
 * the companion's first WS frame (`{type:'hello', …}`); it carries
 * `engineLink.connected`. Loud by design — a connected link means this
 * companion can PATCH a real engine's audio config.
 *
 * @param {object} hello           the parsed `hello` frame
 * @param {(v:boolean, m:string) => void} assertFn  e.g. node:assert's `ok`
 */
export function assertEngineLinkDown(hello, assertFn) {
  assertFn(
    hello && hello.engineLink && hello.engineLink.connected === false,
    'spawned companion must NOT be linked to an engine — it would PATCH capture.device '
    + 'into a live show (report _173). engineLink=' + JSON.stringify(hello && hello.engineLink),
  );
}
