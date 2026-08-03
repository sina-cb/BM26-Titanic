// Regression tests for the HARDENED `_90` audit harness gate
// (red-team _112 F7/I4, wave-1 _118). The harness used to ALWAYS exit 0: a
// 100%-black pattern passed and a "sleeper" that latched black after the
// audited window cleared every bar. It now prints a GATE_PASS/GATE_FAIL verdict
// and, under --gate, exits non-zero (3) with a NAMED reason. These are the
// _112 repro artefacts (evil_black.js / evil_sleeper.js + an over-budget
// pattern) flipped from break-it to green regression, and a guard that shipped
// patterns still PASS.
//
// Self-contained: the hostile sources are written to a temp dir (the real
// artefacts live in gitignored ~/tmp scratch), and the harness is driven as a
// subprocess exactly as the operator's `_90` loop drives it.
//
// Run: cd marsin_engine && node --test tests/tools/harness_gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_harness_gate_'));

const EVIL_BLACK = `
export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function beforeRender(delta) {}
export function render3D(index, x, y, z) { rgbwau(0, 0, 0, 0, 0, 0); }
`;

// Lit + audio-reactive for the audited window, latches fully black after 200
// frames — clears all four documented bars in a --frames 96 run.
const EVIL_SLEEPER = `
export var level = 0.6;
export var kick  = 0.3;
export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
var frameNo = 0; var asleep = 0.0; var phase = 0.0; var gain = 1.0;
export function beforeRender(delta) {
  frameNo = frameNo + 1;
  if (frameNo > 200) asleep = 1.0;
  var dt = delta / 1000.0; if (dt > 0.1) dt = 0.1;
  phase = phase + dt * 0.5; if (phase > 10000.0) phase = phase - 10000.0;
  gain = 0.25 + 1.2 * level;
}
export function render3D(index, x, y, z) {
  if (asleep > 0.5) { rgbwau(0, 0, 0, 0, 0, 0); }
  var band = 1.0 - abs(x - (0.5 + 0.45 * (triangle(phase) - 0.5)));
  band = pow(band, 6.0);
  var r = band * gain * (1.0 + kick); var g = band * gain * 0.35; var b = (1.0 - band) * 0.35 + 0.05;
  if (r > 1.0) r = 1.0; if (g > 1.0) g = 1.0; if (b > 1.0) b = 1.0;
  rgbwau(r, g, b, 0, 0, 0);
}
`;

// Always lit, clean-compiling, but a heavy per-pixel loop — a realistic
// multi-mixer load blows the frame budget (_112 F8).
const EVIL_OVERBUDGET = `
export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function beforeRender(delta) {}
export function render3D(index, x, y, z) {
  var acc = 0.0;
  for (var k = 0; k < 500; k++) { acc = acc + 0.0009; }
  if (acc > 1.0) acc = 1.0;
  rgbwau(acc, 0.3, 0.6, 0, 0, 0);
}
`;

function writePattern(name, src) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, src);
  return p;
}

function runHarness(args) {
  const r = spawnSync('node', [HARNESS, ...args], { cwd: ENGINE_DIR, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('a 100%-black pattern FAILS the gate with a DARK reason (--gate exits 3)', () => {
  const p = writePattern('evil_black.js', EVIL_BLACK);
  const r = runHarness(['--pattern', p, '--synth', 'full_track', '--frames', '96', '--gate']);
  assert.match(r.out, /COMPILE_OK/, 'black pattern still compiles clean (that is the hazard)');
  assert.match(r.out, /GATE_FAIL DARK:/, 'must fail with a named DARK reason');
  assert.equal(r.code, 3, 'must exit non-zero under --gate');
});

test('a post-window black-latch SLEEPER FAILS the gate (BLACK_LATCH)', () => {
  const p = writePattern('evil_sleeper.js', EVIL_SLEEPER);
  const r = runHarness(['--pattern', p, '--synth', 'full_track', '--frames', '96',
    '--mod', 'micLow:sliderLevel,micKick:sliderKick', '--gate']);
  assert.match(r.out, /COMPILE_OK/);
  assert.match(r.out, /GATE_FAIL BLACK_LATCH:/, 'a sleeper latching black after the audited window must fail');
  assert.equal(r.code, 3);
});

test('an over-budget pattern FAILS the gate (OVER_BUDGET)', () => {
  const p = writePattern('evil_overbudget.js', EVIL_OVERBUDGET);
  // Tight per-channel budget (4ms/4ch = 1ms) so the verdict is machine
  // -independent — the heavy per-pixel loop is far over 1ms on any host.
  const r = runHarness(['--pattern', p, '--model', 'titanic', '--frames', '60',
    '--gate', '--budget-ms', '4', '--mix-channels', '4']);
  assert.match(r.out, /COMPILE_OK/);
  assert.match(r.out, /GATE_FAIL OVER_BUDGET:/, 'a pattern over the per-channel frame budget must fail');
  assert.equal(r.code, 3);
});

test('WITHOUT --gate the exit code stays 0 (backward-compatible for clip/gif tooling)', () => {
  const p = writePattern('evil_black.js', EVIL_BLACK);
  const r = runHarness(['--pattern', p, '--synth', 'full_track', '--frames', '96']);
  assert.match(r.out, /GATE_FAIL DARK:/, 'the verdict still PRINTS without --gate');
  assert.equal(r.code, 0, 'exit code unchanged without --gate');
});

test('a shipped pattern PASSES the gate and exits 0', () => {
  const shipped = path.join(ENGINE_DIR, 'patterns', '01_cylon_sweep.js');
  const r = runHarness(['--pattern', shipped, '--synth', 'full_track', '--frames', '96', '--gate']);
  assert.match(r.out, /GATE_PASS/, 'a healthy shipped pattern must stay green');
  assert.equal(r.code, 0);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });
