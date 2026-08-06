// Shared isolation for the two suites that spawn the REAL Audio Companion
// (tests/companion/companion_osc_accounting.test.js and
// tests/companion/companion_new_signals.test.js).
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
 * Write a scratch config.yaml whose companion endpoints can't reach anything,
 * and return the child `env` that points a spawned companion at it.
 *
 * @param {string} prefix  scratch-file name prefix (per-suite, for debugging)
 * @returns {{ env: object, configPath: string, cleanup: () => void }}
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

  return {
    configPath,
    env: { ...process.env, MARSIN_CONFIG_FILE: configPath },
    cleanup() { try { fs.rmSync(configPath, { force: true }); } catch { /* best-effort */ } },
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
