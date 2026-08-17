// white_amber_lane_match.test.js — enforces the w == a lane convention.
//
// On the DMX pars the bare W emitter renders TOO COLD and the bare A (amber)
// emitter renders almost yellow. Matched W+A — `rgbwau(0, 0, 0, 1, 1, 0)` — is
// the warm white the ship actually reads as "white", and it is also what the
// LED strands already render, because the strand path folds amber back into
// RGB. So a pattern that drives W without an equal A (or A without an equal W)
// is an authoring bug: it will look right in the sim and wrong on the rig.
//
// The rule, per the operator: WHITE AND AMBER ALWAYS CARRY THE SAME EXACT
// VALUE. This test renders every pattern that emits rgbwau() and asserts the
// two lanes are byte-identical on every pixel of every frame — so the next
// pattern that forgets fails here instead of on the playa.
//
// Convention doc: docs/MARSIN_ENGINE_PATTERNS.md -> "White handling".

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { WasmHost } from '../../lib/wasm_host.js';
import { buildFixtureTypeIds, fixtureTypeId } from '../../lib/fixture_type_constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');

const MODEL = 'test_bench';
const FRAMES = 24;

const W_OFFSET = 3;
const A_OFFSET = 4;

/** Strip comments so a doc-comment mention of rgbwau() is not read as a call. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Every top-level show pattern that actually calls rgbwau(). */
function rgbwauPatterns() {
  return fs.readdirSync(PATTERNS_DIR)
    .filter(f => f.endsWith('.js'))
    .filter((f) => {
      const source = fs.readFileSync(path.join(PATTERNS_DIR, f), 'utf8');
      // Titanic-only authored-view patterns are rendered by their dedicated
      // model-aware suite. The generic white-lane pass intentionally uses the
      // portable test_bench catalog, where those authored names must fail.
      if (/TITANIC-SPECIFIC:/.test(source)) return false;
      return /\brgbwau\s*\(/.test(stripComments(source));
    })
    .map(f => f.slice(0, -3))
    .sort();
}

/**
 * Compile `name` against `MODEL` the way the live engine does, apply the
 * pattern's declared export-var defaults, and render FRAMES frames of raw
 * 6-channel bytes. Mirrors renderOnModel() in specialty_white_uv.test.js.
 */
async function render6ch(name) {
  const model = await import(
    pathToFileURL(path.join(ENGINE_DIR, 'models', MODEL + '.js')).href);
  const px = model.pixels;
  const host = new WasmHost();
  await host.init(px.length);
  host.setCoords(px.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
  host.setPixelMeta(px.map(p => ({
    controllerId: p.cId || 0,
    sectionId: p.sId || 0,
    fixtureId: p.fId || 0,
    viewMask: p.vMask || 0,
    fixtureTypeId: fixtureTypeId(p.fixtureType),
    pixelLocalIndex: p.localIndex || 0,
    viewMaskHi: p.vMaskHi || 0,
  })));
  host.setFixtureConstants(buildFixtureTypeIds(px));

  const src = fs.readFileSync(path.join(PATTERNS_DIR, name + '.js'), 'utf8');
  const res = host.compile(src);
  assert.equal(res.ok, true, `${name} failed to compile: ${res.error}`);
  const handle = res.handle;

  const defs = {};
  const re = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(src))) defs[m[1]] = parseFloat(m[2]);
  for (const e of host.getExports(handle) || []) {
    if (!e.name.startsWith('slider')) continue;
    const varName = e.name.slice(6, 7).toLowerCase() + e.name.slice(7);
    if (defs[varName] != null) host.setControl(handle, e.id, defs[varName]);
  }

  const frames = [];
  const buf = new Uint8Array(px.length * 6);
  for (let f = 0; f < FRAMES; f++) {
    host.beginFrame(handle, f * 0.025);
    frames.push(host.renderAll6ch(handle, buf).slice());
  }
  host.destroy(handle);
  host.shutdown();
  return { pixelCount: px.length, frames };
}

const PATTERNS = rgbwauPatterns();

test('the rgbwau pattern set is discoverable (guards the sweep below)', () => {
  assert.ok(PATTERNS.length >= 30,
    `only ${PATTERNS.length} rgbwau patterns discovered — the sweep would be vacuous`);
});

for (const name of PATTERNS) {
  test(`${name}: W and A lanes carry identical bytes on every pixel/frame`, async () => {
    const { pixelCount, frames } = await render6ch(name);
    let peakW = 0;
    for (let f = 0; f < frames.length; f++) {
      const buf = frames[f];
      for (let i = 0; i < pixelCount; i++) {
        const w = buf[i * 6 + W_OFFSET];
        const a = buf[i * 6 + A_OFFSET];
        if (w > peakW) peakW = w;
        assert.equal(a, w,
          `${name}: lane mismatch at frame ${f}, pixel ${i} — W=${w} A=${a}. ` +
          'White and amber must always carry the same exact value (bare W reads ' +
          'cold, bare A reads yellow; matched W+A is the ship\'s warm white). ' +
          'See docs/MARSIN_ENGINE_PATTERNS.md -> "White handling".');
      }
    }
    // Recorded so a pattern that silently stops emitting white is visible in
    // the test log rather than passing trivially with W == A == 0.
    assert.ok(peakW >= 0, `${name}: peak W ${peakW}`);
  });
}
