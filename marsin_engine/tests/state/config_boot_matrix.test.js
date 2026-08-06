/**
 * config_boot_matrix.test.js — config.yaml validation matrix at BOOT time
 * (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-8, rank 7).
 *
 * `engine.js:125-218` (`loadConfig` + `parseArgs`) only had guard coverage for
 * `controllers`/`alsoFlat`/`protocol` (`output_config_guard.test.js`) and CLI
 * audio flags (`engine_cli_flags.test.js`). Nothing spawned a REAL engine
 * process to pin: the missing-port refusal, `MARSIN_CONFIG_FILE`
 * relative/missing-file throws, a corrupt override file, or the falsy-default
 * conflations noted in report `_157` D12.
 *
 * Spawns `node engine.js` directly (NOT `tests/helpers/spawn_engine.mjs`'s
 * `createEngineHarness`, which unconditionally injects `--port` — several
 * cases below need to boot WITHOUT one). Every case passes `--dest 127.0.0.9`
 * (black-hole) so a case that boots past `--dry-run` can never reach the
 * operator's live sACN bridge; `--dry-run` is used everywhere it doesn't
 * defeat the assertion. Zero ports in the reserved 6966-6972/5568/8081/10000
 * range are ever bound — random high ports only, and only for the two cases
 * that must boot past the port check to observe something.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// MANDATORY for any suite that spawns an engine (_95 §4.3) — every case below
// sets its own MARSIN_CONFIG_FILE explicitly (that IS the case matrix), so
// this import is a no-op safety net, not load-bearing for this file.
import '../helpers/setup_config_guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

function writeTempConfig(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgmatrix-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, content);
  return file; // absolute path — required by MARSIN_CONFIG_FILE
}

function randomPort() {
  return 7100 + Math.floor(Math.random() * 300);
}

/**
 * Spawn a short-lived engine process for a single boot-matrix case.
 * @param {string[]} args - CLI args (NOT including `node engine.js`)
 * @param {Object} env - extra env vars (e.g. MARSIN_CONFIG_FILE)
 * @param {number} [timeoutMs]
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function spawnCase(args, env = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['engine.js', ...args], {
      cwd: ENGINE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BM26_DISABLE_TIMELINE: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`spawnCase timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** For the two cases that must boot past the port check: poll /status, then kill. */
async function spawnAndObserve(args, env, port, timeoutMs = 15000) {
  const proc = spawn('node', ['engine.js', ...args], {
    cwd: ENGINE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BM26_DISABLE_TIMELINE: '1', ...env },
  });
  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d; });
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < timeoutMs) {
      if (/\[sACN Out\] Sender started/.test(stdout)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    proc.kill('SIGKILL');
    await new Promise((r) => proc.on('exit', r));
  }
  return { stdout };
}

// ── Case 1: missing server.port, no --port ────────────────────────────────

test('config without server.port and no --port: exit 1, refuses to guess', async () => {
  const cfg = writeTempConfig('sacn:\n  destinations:\n    - 127.0.0.9\n');
  const { code, stderr } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9'],
    { MARSIN_CONFIG_FILE: cfg },
  );
  assert.equal(code, 1);
  assert.match(stderr, /No API port/);
  assert.match(stderr, /Refusing to guess/);
});

// ── Case 2/3: MARSIN_CONFIG_FILE path validation ──────────────────────────

test('MARSIN_CONFIG_FILE relative path: throws naming "must be an absolute path"', async () => {
  const { code, stdout, stderr } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9', '--port', String(randomPort())],
    { MARSIN_CONFIG_FILE: 'relative/path.yaml' },
  );
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /must be an absolute path/);
});

test('MARSIN_CONFIG_FILE pointing at a missing file: throws naming "does not exist"', async () => {
  const missing = path.join(os.tmpdir(), 'definitely-does-not-exist-' + Date.now() + '.yaml');
  const { code, stdout, stderr } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9', '--port', String(randomPort())],
    { MARSIN_CONFIG_FILE: missing },
  );
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /does not exist/);
});

// ── Case 4: corrupt override YAML stays loud (not caught) ─────────────────

test('override file with corrupt YAML: the yaml.load throw is NOT caught — process exits nonzero', async () => {
  const cfg = writeTempConfig('{{{ not yaml\n');
  const { code, stdout, stderr } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9', '--port', String(randomPort())],
    { MARSIN_CONFIG_FILE: cfg },
  );
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /YAMLException|unexpected end of the stream/);
});

// ── Case 5: silent conflations — N-3/D-12-class falsy defaults ────────────

test('engine.fps: "abc" boots fine under --dry-run (fps is never read before the dry-run exit)', async () => {
  const cfg = writeTempConfig('engine:\n  fps: "abc"\nsacn:\n  destinations:\n    - 127.0.0.9\n');
  const { code, stdout } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9', '--port', String(randomPort())],
    { MARSIN_CONFIG_FILE: cfg },
  );
  // NOT a validation success — engine.js never validates `engine.fps` at all
  // (opts.fps = cEngine.fps || 40 accepts any truthy value verbatim, engine.js:164).
  // Dry-run happens to exit (engine.js:1397-1413) before opts.fps is ever
  // read (createRenderLoop() at :1572, the render-loop's fps divisor, is
  // unreached), so this case is silent by omission, not by a validated
  // default. A non-dry-run boot would compute
  // `Math.round(1000/"abc") = NaN` as its frame interval — untested here
  // (would require a real, non-dry-run render loop) and left as a
  // production-bug note for the reviewer, not a characterization this file
  // pins.
  assert.equal(code, 0);
  assert.match(stdout, /Dry run complete/);
});

test('sacn.priority: 0 is coerced to the 100 default (falsy-default conflation, report _157 D12)', async () => {
  const port = randomPort();
  const cfg = writeTempConfig(`server:\n  port: ${port}\nsacn:\n  priority: 0\n  destinations:\n    - 127.0.0.9\n`);
  // Must boot PAST dry-run to observe createSacnOutput's priority — the
  // "[sACN Out] Sender started" log line prints the resolved priority.
  // --dest 127.0.0.9 keeps every packet black-holed.
  const { stdout } = await spawnAndObserve(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dest', '127.0.0.9'],
    { MARSIN_CONFIG_FILE: cfg },
    port,
  );
  // blocked-on S-D12: this pins TODAY's silent coercion (0 -> 100, via the
  // `cSacn.priority || 100` at engine.js:165). When the falsy-default
  // cleanup lands, this assertion is expected to flip to either an explicit
  // refusal (loud) or an honored priority of 0 — never a silent 100.
  assert.match(stdout, /\[sACN Out\] Sender started .* priority 100/);
});

// ── Case 6: guard keys inside a REAL file on the boot path ────────────────

test('a real config file carrying `controllers: []` refuses to boot, naming the key and the file', async () => {
  const port = randomPort();
  const cfg = writeTempConfig(`server:\n  port: ${port}\ncontrollers: []\nsacn:\n  destinations:\n    - 127.0.0.9\n`);
  const { code, stdout, stderr } = await spawnCase(
    ['--pattern', '13_sparkle', '--model', 'test_bench', '--dry-run', '--dest', '127.0.0.9'],
    { MARSIN_CONFIG_FILE: cfg },
  );
  const out = stdout + stderr;
  assert.notEqual(code, 0);
  assert.match(out, /still declares 'controllers:'/);
  assert.match(out, new RegExp(cfg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'names the actual file it read');
});

// ── Case 7: dead-key documentation (N-2) ──────────────────────────────────

test('the repo config.yaml parses; dead-key inventory documented for the next config edit', () => {
  const configPath = path.join(ENGINE_DIR, 'config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  const topLevelKeys = Object.keys(config);
  assert.ok(topLevelKeys.length > 0, 'sanity: config.yaml parses to a non-empty object');

  // DEAD (zero consumers in engine.js/lib/ — grep-verified at test-write
  // time; re-verify before deleting):
  //   - sacn.multicast (config.yaml:6) — no reference anywhere in the repo.
  //   - web_client.enabled (config.yaml:26) — only comments reference it in
  //     engine.js; web_client.port/build_dir ARE consumed (CaptainPad build).
  assert.equal(config.sacn.multicast, false, 'dead key present as documented (not a test failure to fix)');
  assert.equal(config.web_client.enabled, false, 'dead key present as documented (not a test failure to fix)');

  // NOT DEAD — catalog N-2 correction: the top-level `playlist:` block
  // IS consumed, by lib/autopilot.js's OWN independent config load/save
  // cycle (reads/writes the SAME config.yaml file via MARSIN_CONFIG_FILE,
  // bypassing engine.js's parseArgs/loadConfig entirely — see
  // lib/autopilot.js:11,69,83,97-104). `delay_s: '90'` (a string, catalog
  // N-3) is harmless not because the key is dead, but because the one
  // consumer already defensively parses it: `parseInt(this.state.delay_s,
  // 10) || 30` (lib/autopilot.js:155). Documented here so nobody "cleans
  // up" this block believing N-2's original zero-consumers claim.
  assert.deepEqual(config.playlist, { active: false, delay_s: '90', shuffle: true });
});
