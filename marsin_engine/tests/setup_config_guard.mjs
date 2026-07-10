// Test config guard — loaded via `node --import` before any test module.
//
// The deck autopilot (lib/autopilot.js) and colour autopilot
// (lib/color_autopilot.js) persist their runtime state by dumping the ENTIRE
// parsed config.yaml back to disk (js-yaml strips every comment). A test that
// spawns the real engine and activates autopilot would therefore rewrite the
// tracked, comment-bearing marsin_engine/config.yaml — wiping the documented
// `controllers:` routing examples and appending a `colorAutopilot:` block.
//
// Both modules resolve their persistence path from MARSIN_CONFIG_FILE (falling
// back to the real config.yaml when unset). Here we point that env var at a
// scratch COPY of config.yaml, so: (a) the engine still boots from real
// settings, and (b) every autopilot save lands in the scratch file. Spawned
// engine subprocesses inherit the env var (they inherit process.env), so this
// one hook covers the whole suite — no per-test wiring.
//
// Idempotent: honours an override the caller already set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.MARSIN_CONFIG_FILE) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const realConfig = path.join(here, '..', 'config.yaml');
  const scratch = path.join(os.tmpdir(), `bm26_engine_config_test_${process.pid}.yaml`);
  fs.copyFileSync(realConfig, scratch);
  process.env.MARSIN_CONFIG_FILE = scratch;
  process.on('exit', () => {
    try { fs.rmSync(scratch, { force: true }); } catch { /* best-effort cleanup */ }
  });
}
