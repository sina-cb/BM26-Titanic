// specialty_white_uv.test.js — contract tests for the WHITE ONLY pattern
// family (60-64) and the UV spike (65), plus the specialty/themed playlists
// that carry them.
//
// These patterns make promises the normal pattern bars do not check, and every
// one of them is silently breakable by an ordinary-looking edit:
//
//   1. "Pure white" means UNTINTABLE. The engine's global palette / palette
//      autopilot writes `colorPalette1`/`colorPalette2` into whatever pattern
//      declares them — so the guarantee is exactly "this pattern declares
//      neither". Add a palette picker to a white pattern for convenience and
//      the whole family quietly becomes colourable.
//   2. "Pure white" means NEUTRAL RGB. Neutral RGB is what makes the RGB-only
//      TE Sign panels render white at all, and it is what makes white immune
//      to the per-channel hue stage (a desaturated pixel has no hue to
//      rotate). A stray tint would only show on the rig.
//   3. The W lane must be driven EXPLICITLY. Leaving it at 0 still "looks
//      white" in the sim because sacn_mapper host-synths W = min(R,G,B) for
//      DMX fixtures — so a regression here is invisible until the dedicated
//      white emitter goes dark on hardware.
//   4. `65_uv_only` must drive ONLY the violet lane at its defaults. That is
//      the entire point of the spike: the operator has to see what the rig
//      does with the U lane alone, unmixed with any RGB fill.
//   5. Project rule: slider declaration order is MFT knob order, and
//      `direction` is the SECOND local param.
//
// Everything runs on BOTH show models, because the family deliberately uses no
// FIX_*/sectionId branching and that portability is the thing that lets it run
// on titanic (where every pixel has sectionId 0).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath, pathToFileURL } from 'url';

import { WasmHost } from '../../lib/wasm_host.js';
import { buildFixtureTypeIds, fixtureTypeId } from '../../lib/fixture_type_constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES_DIR = path.resolve(ENGINE_DIR, '../simulation/scenes');

const WHITE_PATTERNS = [
  '60_white_wash',
  '61_white_breathe',
  '62_white_shimmer',
  '63_white_chase',
  '64_temple_warm_white',
];
// Wave _312: 20 night-visibility conversions live in their own directory and
// sit in the white_only review playlist after the 5 legacy entries. The later
// 21..25 drafts are daylight-duty-cycle content reviewed through white_day;
// do not silently pull those drafts into the established night review arc.
const WHITE_ONLY_WAVE = fs.readdirSync(path.join(PATTERNS_DIR, 'white_only'))
  .filter((f) => /^(?:0[1-9]|1\d|20)_[a-z0-9_]+\.js$/.test(f))
  .map((f) => `white_only/${f.slice(0, -3)}`);
const UV_PATTERN = '65_uv_only';
const ALL_NEW = [...WHITE_PATTERNS, UV_PATTERN];
const MODELS = ['test_bench', 'titanic'];
const FRAMES = 60;

// Fixtures whose channel map has no `u`, so a violet write is dropped by
// sacn_mapper. Used only to document intent in the UV assertions.
const SCENES = ['test_bench', 'titanic'];
const SPECIALTY_PLAYLISTS = ['white_only', 'uv_test', 'uv_only'];
// The seven themed playlists from report _13 (tutu_tuesday, white_wednesday,
// iceberg_ahead, first_class_1912, deep_sea, burn_night, temple_white) were
// deliberately retired in commit 691f9c3c ("feat: prepare BM readiness
// controls and show content") — deleted from BOTH scenes as show-content
// curation. Recover any of them with:
//   git show 691f9c3c^:simulation/scenes/<scene>/playlists/<name>.yaml
const THEMED_PLAYLISTS = [];

function readPattern(name) {
  return fs.readFileSync(path.join(PATTERNS_DIR, name + '.js'), 'utf8');
}

/**
 * Compile `name` against `modelName` exactly the way the live engine does
 * (real coords, real per-pixel meta incl. fixtureTypeId, FIX_* injection via
 * WasmHost.compile), apply the pattern's declared export-var defaults, render
 * `FRAMES` frames and return the raw 6-channel bytes per frame.
 */
async function renderOnModel(name, modelName, overrides = {}) {
  const model = await import(pathToFileURL(path.join(ENGINE_DIR, 'models', modelName + '.js')).href);
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

  const src = readPattern(name);
  const res = host.compile(src);
  assert.equal(res.ok, true, `${name} failed to compile on ${modelName}: ${res.error}`);
  const handle = res.handle;

  // Apply declared `export var X = N` defaults through the identity-slider
  // convention, same as the engine's pattern_defaults path.
  const defs = {};
  const re = /export\s+var\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(src))) defs[m[1]] = parseFloat(m[2]);
  const exports = host.getExports(handle) || [];
  for (const e of exports) {
    if (!e.name.startsWith('slider')) continue;
    const varName = e.name.slice(6, 7).toLowerCase() + e.name.slice(7);
    const v = Object.prototype.hasOwnProperty.call(overrides, e.name) ? overrides[e.name] : defs[varName];
    if (v != null) host.setControl(handle, e.id, v);
  }

  const frames = [];
  const buf = new Uint8Array(px.length * 6);
  for (let f = 0; f < FRAMES; f++) {
    host.beginFrame(handle, f * 0.025);
    frames.push(host.renderAll6ch(handle, buf).slice());
  }
  host.destroy(handle);
  host.shutdown();
  return { px, frames };
}

// ── 1. Registration ──────────────────────────────────────────────────────

test('every new specialty pattern has a file and a manifest entry', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  for (const name of ALL_NEW) {
    assert.ok(fs.existsSync(path.join(PATTERNS_DIR, name + '.js')), `missing patterns/${name}.js`);
    assert.ok(manifest.includes(name), `${name} is not in patterns/manifest.json`);
  }
});

// ── 2. Source-level contracts ────────────────────────────────────────────

for (const name of ALL_NEW) {
  test(`${name}: declares NO colorPalette export (the global palette cannot tint it)`, () => {
    const src = readPattern(name);
    assert.ok(!/export\s+function\s+colorPalette[12]\b/.test(src),
      `${name} declares a colorPalette picker — the CPC/palette autopilot would then re-colour it, ` +
      'which defeats the whole WHITE ONLY / UV ONLY premise.');
    assert.ok(!/export\s+var\s+cp[12][HSV]\b/.test(src),
      `${name} declares cp1/cp2 palette vars`);
  });

  test(`${name}: slider order is localSpeed first, direction second (MFT knob order)`, () => {
    const src = readPattern(name);
    const order = [...src.matchAll(/export\s+function\s+(slider\w+)\s*\(/g)].map(m => m[1]);
    assert.ok(order.length >= 2, `${name} declares fewer than 2 sliders`);
    assert.equal(order[0], 'sliderLocalSpeed', `${name}: first slider must be sliderLocalSpeed, got ${order[0]}`);
    assert.equal(order[1], 'sliderDirection', `${name}: second slider must be sliderDirection, got ${order[1]}`);
    // MFT bank 1 holds 12 blue local params.
    assert.ok(order.length <= 12, `${name} declares ${order.length} sliders; MFT bank 1 holds 12`);
  });

  test(`${name}: emits explicit 6-channel rgbwau (not rgb/hsv)`, () => {
    const src = readPattern(name);
    assert.ok(/\brgbwau\s*\(/.test(src), `${name} does not call rgbwau()`);
    assert.ok(!/^\s*(rgb|hsv)\s*\(/m.test(src),
      `${name} calls bare rgb()/hsv() — the W lane would fall back to the mapper's min(R,G,B) host-synth`);
  });
}

// ── 3. Rendered-output contracts, on BOTH show models ────────────────────

for (const modelName of MODELS) {
  for (const name of WHITE_PATTERNS) {
    test(`${name} on ${modelName}: neutral RGB + a driven W lane + zero violet`, async () => {
      const { frames } = await renderOnModel(name, modelName);
      let maxSpreadRatio = 0;
      let minBlueRatio = 1;
      let peakW = 0;
      let peakU = 0;
      let peakRGB = 0;
      for (const buf of frames) {
        for (let o = 0; o < buf.length; o += 6) {
          const mx = Math.max(buf[o], buf[o + 1], buf[o + 2]);
          const mn = Math.min(buf[o], buf[o + 1], buf[o + 2]);
          if (mx > peakRGB) peakRGB = mx;
          if (buf[o + 3] > peakW) peakW = buf[o + 3];
          if (buf[o + 5] > peakU) peakU = buf[o + 5];
          // Only judge neutrality where there is light to judge.
          if (mx >= 24) {
            const ratio = (mx - mn) / mx;
            if (ratio > maxSpreadRatio) maxSpreadRatio = ratio;
          }
          // Blue must never collapse — that is the line between a warm WHITE
          // and an amber/orange COLOUR.
          if (buf[o] >= 64) {
            const blueRatio = buf[o + 2] / buf[o];
            if (blueRatio < minBlueRatio) minBlueRatio = blueRatio;
          }
          // R must lead or equal: the warmth tint only ever pulls G and B DOWN.
          assert.ok(buf[o] >= buf[o + 1] && buf[o + 1] >= buf[o + 2],
            `${name}/${modelName}: RGB is not a warm-neutral ramp (R>=G>=B), got ` +
            `${buf[o]}/${buf[o + 1]}/${buf[o + 2]}`);
        }
      }
      // The warmth knob's own extreme is the budget: at warmth = 1 the deepest
      // member (64_temple_warm_white) sits at R:1.00 G:0.68 B:0.32, a spread of
      // 0.68 — a candle-temperature WHITE. Past ~0.70 the pattern would be
      // emitting a hue, which no member of this family may do.
      assert.ok(maxSpreadRatio <= 0.70,
        `${name}/${modelName}: RGB spread ${maxSpreadRatio.toFixed(2)} exceeds the warm-white budget — this is a tint, not white`);
      assert.ok(minBlueRatio >= 0.25,
        `${name}/${modelName}: blue collapses to ${minBlueRatio.toFixed(2)} of red — that is amber, not warm white`);
      assert.ok(peakW > 0,
        `${name}/${modelName}: the dedicated W emitter is never driven. It would still LOOK white in the ` +
        'sim (sacn_mapper host-synths W = min(R,G,B) for DMX fixtures) but the white emitter stays dark on the rig.');
      assert.equal(peakU, 0, `${name}/${modelName}: a WHITE pattern must never write the violet/UV lane`);
      assert.ok(peakRGB >= 24, `${name}/${modelName}: renders essentially black`);
    });

    test(`${name} on ${modelName}: silence-safe and never fully dark`, async () => {
      const { frames } = await renderOnModel(name, modelName);
      for (let f = 0; f < frames.length; f++) {
        let sum = 0;
        for (const v of frames[f]) sum += v;
        assert.ok(sum > 0, `${name}/${modelName}: frame ${f} is entirely black (mission-critical visibility)`);
        assert.ok(Number.isFinite(sum), `${name}/${modelName}: frame ${f} produced non-finite output`);
      }
    });
  }

  test(`${UV_PATTERN} on ${modelName}: at defaults ONLY the violet lane is written`, async () => {
    const { frames } = await renderOnModel(UV_PATTERN, modelName);
    let peakU = 0;
    for (const buf of frames) {
      for (let o = 0; o < buf.length; o += 6) {
        assert.equal(buf[o], 0, `${UV_PATTERN}/${modelName}: R written at defaults (rgbViolet must default to 0)`);
        assert.equal(buf[o + 1], 0, `${UV_PATTERN}/${modelName}: G written at defaults`);
        assert.equal(buf[o + 2], 0, `${UV_PATTERN}/${modelName}: B written at defaults`);
        assert.equal(buf[o + 3], 0, `${UV_PATTERN}/${modelName}: W written at defaults`);
        assert.equal(buf[o + 4], 0, `${UV_PATTERN}/${modelName}: A written at defaults`);
        if (buf[o + 5] > peakU) peakU = buf[o + 5];
      }
    }
    assert.ok(peakU >= 128, `${UV_PATTERN}/${modelName}: violet lane peaks at only ${peakU}`);
  });

  test(`${UV_PATTERN} on ${modelName}: sliderRgbViolet opts the RGB-only fixtures in`, async () => {
    const { frames } = await renderOnModel(UV_PATTERN, modelName, { sliderRgbViolet: 1.0 });
    let peakR = 0, peakG = 0, peakB = 0;
    for (const buf of frames) {
      for (let o = 0; o < buf.length; o += 6) {
        if (buf[o] > peakR) peakR = buf[o];
        if (buf[o + 1] > peakG) peakG = buf[o + 1];
        if (buf[o + 2] > peakB) peakB = buf[o + 2];
      }
    }
    assert.ok(peakB > 0 && peakR > 0, 'rgbViolet=1 must fill a deep-violet RGB approximation');
    assert.equal(peakG, 0, 'the violet approximation must keep GREEN at zero or it is not violet');
    assert.ok(peakB > peakR, 'the violet approximation must be blue-dominant');
  });
}

// ── 4. Playlists ─────────────────────────────────────────────────────────

test('specialty + themed playlists exist in BOTH scenes and reference real patterns', () => {
  const manifest = new Set(JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8')));
  for (const scene of SCENES) {
    for (const list of [...SPECIALTY_PLAYLISTS, ...THEMED_PLAYLISTS]) {
      const file = path.join(SCENES_DIR, scene, 'playlists', list + '.yaml');
      assert.ok(fs.existsSync(file), `missing playlist ${scene}/${list}.yaml`);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      assert.equal(doc.name, list, `${scene}/${list}.yaml: name field mismatch`);
      assert.equal(doc.schemaVersion, 1);
      assert.ok(Array.isArray(doc.entries) && doc.entries.length > 0, `${scene}/${list}.yaml has no entries`);
      const seen = new Set();
      for (const e of doc.entries) {
        assert.equal(typeof e.pattern, 'string', `${scene}/${list}.yaml: non-string pattern ${JSON.stringify(e.pattern)}`);
        assert.ok(manifest.has(e.pattern), `${scene}/${list}.yaml references unknown pattern "${e.pattern}"`);
        assert.ok(!seen.has(e.pattern), `${scene}/${list}.yaml lists "${e.pattern}" twice`);
        seen.add(e.pattern);
        assert.ok(e.defaults && typeof e.defaults === 'object', `${scene}/${list}.yaml: entry missing defaults object`);
        assert.ok(Array.isArray(e.modulations) && Array.isArray(e.midiMappings),
          `${scene}/${list}.yaml: entry missing modulations/midiMappings arrays`);
      }
    }
  }
});

test('both scenes carry byte-identical copies of every specialty/themed playlist', () => {
  for (const list of [...SPECIALTY_PLAYLISTS, ...THEMED_PLAYLISTS]) {
    const a = fs.readFileSync(path.join(SCENES_DIR, 'test_bench', 'playlists', list + '.yaml'), 'utf8');
    const b = fs.readFileSync(path.join(SCENES_DIR, 'titanic', 'playlists', list + '.yaml'), 'utf8');
    assert.equal(a, b, `${list}.yaml differs between test_bench and titanic`);
  }
});

test('white_only holds exactly the WHITE family; uv_test holds ONLY the UV spike', () => {
  for (const scene of SCENES) {
    const white = yaml.load(fs.readFileSync(path.join(SCENES_DIR, scene, 'playlists', 'white_only.yaml'), 'utf8'));
    assert.deepEqual(white.entries.map(e => e.pattern).sort(), [...WHITE_PATTERNS, ...WHITE_ONLY_WAVE].sort(),
      `${scene}/white_only.yaml must hold exactly the white family (legacy 5 + wave _312)`);

    const uv = yaml.load(fs.readFileSync(path.join(SCENES_DIR, scene, 'playlists', 'uv_test.yaml'), 'utf8'));
    assert.deepEqual(uv.entries.map(e => e.pattern), [UV_PATTERN],
      `${scene}/uv_test.yaml must hold only ${UV_PATTERN}`);
  }
});

test('the UV spike lives ONLY in uv_test and the uv_only program (wave _313)', () => {
  // 2026-08-17: the operator ordered a full UV ONLY program (wave _313), which
  // promotes the spike into the dedicated `uv_only` playlist alongside the 19
  // new patterns/uv_only/* looks. It must still stay out of every OTHER
  // program (ambient, party, themed) — UV remains a deliberate operator pick.
  for (const scene of SCENES) {
    const dir = path.join(SCENES_DIR, scene, 'playlists');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      if (f === 'uv_test.yaml' || f === 'uv_only.yaml') continue;
      const doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
      const hit = (doc.entries || []).some(e => e && e.pattern === UV_PATTERN);
      assert.equal(hit, false,
        `${scene}/${f} contains ${UV_PATTERN} — the UV family belongs only to uv_test/uv_only ` +
        'until the operator promotes it into a themed program.');
    }
  }
});
