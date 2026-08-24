// Test config guard — loaded via `node --import` before any test module.
//
// The deck autopilot (lib/autopilot.js) and colour autopilot
// (lib/color_autopilot.js) persist their runtime state by dumping the ENTIRE
// parsed config.yaml back to disk (js-yaml strips every comment). A test that
// spawns the real engine and activates autopilot would therefore rewrite the
// tracked, comment-bearing marsin_engine/config.yaml — wiping its documentation
// and appending a `colorAutopilot:` block.
//
// Both modules resolve their persistence path from MARSIN_CONFIG_FILE (falling
// back to the real config.yaml when unset), and since report _100 so does
// engine.js's own boot read. Here we point that env var at a scratch COPY of
// config.yaml, then in that scratch copy we disable the production OSC and
// fire-sync listeners AND black-hole the sACN output (report _361 BLOCKER 1 —
// see below). The engine otherwise boots from the real settings, and
// every autopilot save lands in the scratch file. Spawned
// engine subprocesses inherit the env var (they inherit process.env), so this
// one hook covers the whole suite — no per-test wiring.
//
// A harness that needs DIFFERENT settings (the timeline e2e suite writes a
// black-holed `sacn.destinations` config so its engines can never reach the
// rig) sets MARSIN_CONFIG_FILE itself, or hands the child its own value — this
// hook honours an override that is already set.
//
// Idempotent: honours an override the caller already set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { SACN_BLACK_HOLE_HOST, assertSacnDestinationsBlackHoled } from './sacn_black_hole.mjs';

if (!process.env.MARSIN_CONFIG_FILE) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // tests/helpers → tests → marsin_engine/config.yaml
  const realConfig = path.join(here, '..', '..', 'config.yaml');
  const scratch = path.join(os.tmpdir(), `bm26_engine_config_test_${process.pid}.yaml`);
  const isolatedConfig = yaml.load(fs.readFileSync(realConfig, 'utf8'));
  if (!isolatedConfig || typeof isolatedConfig !== 'object') {
    throw new Error(`test config guard could not parse ${realConfig}`);
  }
  // A random HTTP port and a TEST-NET sACN destination are not sufficient
  // isolation: the production config also opens the normal OSC and Stoker
  // fire-sync UDP listeners.  Real-engine tests must never contend with, read
  // from, or influence those live control ports.  Suites that explicitly test
  // OSC provide their own MARSIN_CONFIG_FILE and therefore bypass this guard.
  isolatedConfig.osc = { ...(isolatedConfig.osc || {}), enabled: false };
  isolatedConfig.fire_sync = { ...(isolatedConfig.fire_sync || {}), enabled: false };
  // THE sACN OUTPUT WALL (report `_361` BLOCKER 1). Until this existed the
  // guard left `sacn.destinations` at its PRODUCTION value — `127.0.0.1`,
  // which is the operator's live simulation input bridge — so `npm test`,
  // running four spawned engines at a time, transmitted real DMX into the
  // running show and silently stole his frames (shared E1.31 CID → the sim's
  // receiver discards on a poisoned sequence counter). The timeline e2e
  // harness had already solved this for its own engines; every one of the
  // other 88 test files was unwalled. See `sacn_black_hole.mjs` for why a
  // loopback destination is NOT a black hole. `multicast: false` matters too:
  // a multicast sender ignores the destination list entirely and would reach
  // the sim regardless.
  isolatedConfig.sacn = {
    ...(isolatedConfig.sacn || {}),
    destinations: [SACN_BLACK_HOLE_HOST],
    multicast: false,
  };
  // Prove it rather than trust it — a bad edit here must stop the suite, not
  // leak one frame.
  assertSacnDestinationsBlackHoled(isolatedConfig.sacn.destinations, scratch);
  if (isolatedConfig.sacn.multicast) {
    throw new Error(`[sACN wall] ${scratch}: multicast must be false in test configs`);
  }
  fs.writeFileSync(scratch, yaml.dump(isolatedConfig), 'utf8');
  process.env.MARSIN_CONFIG_FILE = scratch;
  process.on('exit', () => {
    try { fs.rmSync(scratch, { force: true }); } catch { /* best-effort cleanup */ }
  });
}
