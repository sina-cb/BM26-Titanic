// Tests for lib/view_mask_constants.js — MASK_* name sanitization,
// table building, and compile-time source injection — plus an
// end-to-end check that WasmHost.compile resolves injected names
// through the real MarsinScript compiler.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maskConstantName,
  buildMaskConstants,
  injectMaskConstants,
} from '../lib/view_mask_constants.js';
import { WasmHost } from '../lib/wasm_host.js';

// ── maskConstantName ──────────────────────────────────────────────

test('maskConstantName: camelCase boundaries split', () => {
  assert.equal(maskConstantName('RedwoodPARs'), 'MASK_REDWOOD_PARS');
  assert.equal(maskConstantName('VintageOnly'), 'MASK_VINTAGE_ONLY');
  assert.equal(maskConstantName('TriangleEdges'), 'MASK_TRIANGLE_EDGES');
});

test('maskConstantName: spaces and underscores collapse', () => {
  assert.equal(maskConstantName('DJ Lights'), 'MASK_DJ_LIGHTS');
  assert.equal(maskConstantName('Berg Alpha'), 'MASK_BERG_ALPHA');
  assert.equal(maskConstantName('Left_Front_Left'), 'MASK_LEFT_FRONT_LEFT');
  assert.equal(maskConstantName('Right Front Wall Generator'), 'MASK_RIGHT_FRONT_WALL_GENERATOR');
});

test('maskConstantName: digits survive', () => {
  assert.equal(maskConstantName('Redwoods1'), 'MASK_REDWOODS1');
});

test('maskConstantName: unsanitizable name throws', () => {
  assert.throws(() => maskConstantName('***'), /empty constant name/);
});

// ── buildMaskConstants ────────────────────────────────────────────

test('buildMaskConstants: merges groups and presets', () => {
  const constants = buildMaskConstants({
    groupBits: { 'TowerBars': 0x01, 'DJ Lights': 0x04 },
    viewMasks: [{ name: 'RedwoodPARs', bit: 0x40 }],
  });
  assert.deepEqual(constants, {
    MASK_TOWER_BARS: 0x01,
    MASK_DJ_LIGHTS: 0x04,
    MASK_REDWOOD_PARS: 0x40,
  });
});

test('buildMaskConstants: sanitized collision with different bits throws', () => {
  assert.throws(() => buildMaskConstants({
    groupBits: { 'DJ Lights': 0x01, 'DJ_Lights': 0x02 },
    viewMasks: [],
  }), /collision/);
});

test('buildMaskConstants: same sanitized name with same bit is not a collision', () => {
  const constants = buildMaskConstants({
    groupBits: { 'DJ Lights': 0x01, 'DJ_Lights': 0x01 },
    viewMasks: [],
  });
  assert.deepEqual(constants, { MASK_DJ_LIGHTS: 0x01 });
});

test('buildMaskConstants: all-caps runs do not split (DJLights ≠ DJ Lights)', () => {
  const constants = buildMaskConstants({
    groupBits: { 'DJLights': 0x02 },
    viewMasks: [],
  });
  assert.deepEqual(constants, { MASK_DJLIGHTS: 0x02 });
});

// ── injectMaskConstants ───────────────────────────────────────────

const CONSTANTS = { MASK_REDWOOD_PARS: 64, MASK_VINTAGE_ONLY: 128 };

test('injectMaskConstants: no MASK_* references → source unchanged', () => {
  const src = 'export function render(index) { rgb(1, 0, 0); }';
  assert.equal(injectMaskConstants(src, CONSTANTS), src);
});

test('injectMaskConstants: referenced constant gets prepended', () => {
  const src = 'export function render(index) { var on = (viewMask & MASK_REDWOOD_PARS) != 0; rgb(on, 0, 0); }';
  const out = injectMaskConstants(src, CONSTANTS);
  assert.match(out, /^var MASK_REDWOOD_PARS = 64;\n/);
  // Only the referenced constant is injected, not the whole table.
  assert.doesNotMatch(out, /MASK_VINTAGE_ONLY/);
});

test('injectMaskConstants: table names are injected even when the pattern declares them', () => {
  // Duplicate var declarations are legal in MarsinScript and the later
  // (pattern's own) declaration wins — see the e2e precedence test below.
  const src = 'var MASK_REDWOOD_PARS = 64;\nexport function render(index) { rgb(viewMask & MASK_REDWOOD_PARS, 0, 0); }';
  const out = injectMaskConstants(src, CONSTANTS);
  assert.match(out, /^var MASK_REDWOOD_PARS = 64;\n/);
  assert.equal(out.slice(out.indexOf('\n') + 1), src);
});

test('injectMaskConstants: reference inside a var initializer still injects', () => {
  const src = 'export function render(index) { var on = (viewMask & MASK_REDWOOD_PARS) != 0; rgb(on, 0, 0); }';
  assert.match(injectMaskConstants(src, CONSTANTS), /^var MASK_REDWOOD_PARS = 64;\n/);
});

test('injectMaskConstants: declared-but-unknown name is skipped silently', () => {
  // Not in the table, but the pattern declares it itself — self-sufficient.
  const src = 'var MASK_MY_LOCAL_THING = 32;\nexport function render(index) { rgb(viewMask & MASK_MY_LOCAL_THING, 0, 0); }';
  assert.equal(injectMaskConstants(src, CONSTANTS), src);
});

test('injectMaskConstants: unknown MASK_* reference throws with known names', () => {
  const src = 'export function render(index) { rgb(viewMask & MASK_TYPO_HERE, 0, 0); }';
  assert.throws(() => injectMaskConstants(src, CONSTANTS),
    /MASK_TYPO_HERE.*MASK_REDWOOD_PARS/s);
});

test('injectMaskConstants: commented-out references are ignored', () => {
  const src = '// uses MASK_NOT_IN_TABLE when enabled\n' +
    '/* and MASK_ALSO_UNKNOWN here */\n' +
    'export function render(index) { rgb(viewMask & MASK_REDWOOD_PARS, 0, 0); }';
  const out = injectMaskConstants(src, CONSTANTS);
  assert.match(out, /^var MASK_REDWOOD_PARS = 64;\n/);
  assert.doesNotMatch(out, /var MASK_NOT_IN_TABLE/);
});

test('injectMaskConstants: multi-var declaration of an unknown name is skipped silently', () => {
  const src = 'var speed = 1, MASK_MY_LOCAL_THING = 32;\n' +
    'export function render(index) { rgb(viewMask & MASK_MY_LOCAL_THING, 0, 0); }';
  assert.equal(injectMaskConstants(src, CONSTANTS), src);
});

test('injectMaskConstants: multiple references inject on a single line', () => {
  const src = 'export function render(index) {\n' +
    '  var a = (viewMask & MASK_REDWOOD_PARS) != 0;\n' +
    '  var b = (viewMask & MASK_VINTAGE_ONLY) != 0;\n' +
    '  rgb(a, b, 0);\n}';
  const out = injectMaskConstants(src, CONSTANTS);
  const [preamble] = out.split('\n', 1);
  assert.match(preamble, /var MASK_REDWOOD_PARS = 64;/);
  assert.match(preamble, /var MASK_VINTAGE_ONLY = 128;/);
  // Original source intact after the one preamble line.
  assert.equal(out.slice(preamble.length + 1), src);
});

// ── End-to-end through the real WASM compiler ─────────────────────

test('WasmHost.compile: injected MASK_* constant compiles and renders', async () => {
  const host = new WasmHost();
  await host.init(4);
  try {
    host.setMaskConstants({ MASK_BERG_ALPHA: 0x04000000 });
    const result = host.compile(
      'export function render(index) { var on = (viewMask & MASK_BERG_ALPHA) != 0; rgb(on, 0, 0); }');
    assert.equal(result.ok, true, result.error);
    host.destroy(result.handle);
  } finally {
    host.shutdown();
  }
});

test('WasmHost.compile: pattern-declared value overrides the injected table value', async () => {
  const host = new WasmHost();
  await host.init(1);
  try {
    host.setCoords([{ nx: 0, ny: 0, nz: 0 }]);
    // Table says 0.1-equivalent; pattern overrides with 0.9. The render
    // output proves the pattern's later declaration wins.
    host.setMaskConstants({ MASK_OVERRIDE_ME: 26 });
    const result = host.compile(
      'var MASK_OVERRIDE_ME = 230;\nexport function render(index) { rgb(MASK_OVERRIDE_ME / 255, 0, 0); }');
    assert.equal(result.ok, true, result.error);
    host.beginFrame(result.handle, 0.0);
    const buf = host.renderAll6ch(result.handle);
    assert.ok(buf[0] > 200, `expected pattern value (~230) to win, got red byte ${buf[0]}`);
    host.destroy(result.handle);
  } finally {
    host.shutdown();
  }
});

test('WasmHost.compile: unknown MASK_* reference is a loud compile failure', async () => {
  const host = new WasmHost();
  await host.init(4);
  try {
    host.setMaskConstants({ MASK_BERG_ALPHA: 0x04000000 });
    const result = host.compile(
      'export function render(index) { rgb(viewMask & MASK_NO_SUCH_GROUP, 0, 0); }');
    assert.equal(result.ok, false);
    assert.match(result.error, /MASK_NO_SUCH_GROUP/);
    assert.match(result.error, /MASK_BERG_ALPHA/);
  } finally {
    host.shutdown();
  }
});
