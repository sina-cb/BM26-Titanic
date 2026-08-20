// baby_reveal_contract.test.js — the single-family contract for the Baby
// show's ANSWER patterns in patterns/baby_reveal/.
//
// The tease's contract (baby_color_contract.test.js) guards a set that must
// carry BOTH families at once. This file guards the opposite promise, and it is
// the more dangerous one:
//
//   1. THE ANSWER MUST NOT WAVER. A reveal runs in exactly ONE colour family —
//      whichever one the live palette carries. A single pixel of a different
//      hue on a photo hold is the wrong answer on the ship, in front of the
//      parents. Zero tolerance — literally `assert.equal(count, 0)`, under
//      every palette, on BOTH rigs.
//   2. THE COLOUR IS INJECTED, NOT HARD-CODED. Inverted from the retired
//      boy/girl set: every pattern here MUST export colorPalette1, because one
//      playlist now serves both answers and the show writes the family.
//      docs/73 §2.
//   3. ONE SLOT, NO HANDSHAKE (contract v2 — operator ruling). The patterns
//      read `colorPalette1` ONLY and DERIVE the second tone internally as that
//      same colour at `value x DARK_K`. `colorPalette2` is not exported and not
//      read. The v1 two-slot handshake was ruled out because it made these
//      looks render BLACK on the deck under any ordinary palette — the reveal
//      set was invisible outside an armed show. Under v2 any valid palette
//      lights the rig in that colour family, and the ONLY refusal is an
//      INVALID palette (a component outside [0, 1]).
//
//      "Nothing pushed" is NOT a detectable state, and that is a MEASURED
//      property of the VM rather than a design choice: the VM installs its own
//      hsvPicker default (h 0, s 1, v 1) and calls the exported colorPalette1
//      setter at program init whatever the declared `export var` values say. So
//      an unpushed pattern renders RED, not black, and refusal can only be
//      tested by PUSHING an invalid palette. See the authority block at the top
//      of any patterns/baby_reveal/*.js.
//   4. TWO TONES, NOT A GRADIENT. With one hue, the whole composition rests on
//      tonal territory. If the level histogram smears into one mode the pattern
//      has degenerated into brightness-only mush, which is exactly how the
//      retired set failed. docs/73 R1-R3.
//   5. ONE AUTHORITY, BYTE-IDENTICAL. Colour lives in one shared block. A
//      per-pattern trim or a stray colour constant is a drift the crowd reads
//      as one answer looking different from the other.
//   6. IT SHOWS UP ON THE DECK. The operator's complaint that produced v2: a
//      reveal keeper picked from the deck under the live colour must LIGHT, in
//      that colour, with no show armed. That is a gate here, not a hope.
//
// Everything runs on BOTH show models: the family uses no FIX_*/sectionId
// branching for its world path, and that portability is what lets it run on
// titanic as well as the bench.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const REVEAL_DIR = path.join(PATTERNS_DIR, 'baby_reveal');
const SCENES_DIR = path.resolve(ENGINE_DIR, '..', 'simulation', 'scenes');
const SCENES = ['titanic', 'test_bench'];
const MODELS = ['titanic', 'test_bench'];

// ── THE TWO FAMILIES, AS THE SHOW WRITES THEM ──────────────────────────────
//
// RGB triples are the Baby contract's, verbatim. The HSV values are what the
// reveal's `globals` action puts on the wire. Under contract v2 the patterns no
// longer match against them — the RGB triple is DERIVED from whatever HSV
// arrives — so these literals now serve two narrower jobs: proving the show
// YAML still writes a recognised Baby hue, and proving no pattern source has
// quietly re-acquired a hard-coded family colour.
const FAMILIES = {
  pink: { rgb: [1.000, 0.035, 0.360], h: 0.943869, s: 0.965 },
  blue: { rgb: [0.033, 0.450, 1.000], h: 0.594795, s: 0.967 },
};

// ── THE PALETTES THE GATES DRIVE ───────────────────────────────────────────
//
// The show's two answers, plus ONE ordinary hue that is neither. `green` is the
// load-bearing case of contract v2: it is not a Baby family, no pattern knows
// it exists, and it is exactly what the deck's colour wheel can be sitting on
// when the operator picks a reveal keeper out of the picker. Every colour gate
// below runs under it, because a family that only behaves under its own two
// hues has re-implemented the handshake by another name.
//
// Pure green (s = 1) is also the cleanest possible purity probe: its RGB is
// (0, 1, 0), so "single family" means the R and B lanes are literally zero.
const PALETTES = {
  pink: { h: FAMILIES.pink.h, s: FAMILIES.pink.s, v: 1.0 },
  blue: { h: FAMILIES.blue.h, s: FAMILIES.blue.s, v: 1.0 },
  green: { h: 0.333333, s: 1.0, v: 1.0 },
};
/** The non-Baby hue, named once so the deck gate and G5 cannot drift apart. */
const DECK_PALETTE = 'green';

const REVEAL_NAME_RE = /^(\d\d+)_([a-z0-9_]+)$/;
const MIN_KEEPERS = 8;
const MAX_KEEPERS = 12;

function revealIds() {
  assert.ok(fs.existsSync(REVEAL_DIR), 'patterns/baby_reveal/ must exist');
  return fs.readdirSync(REVEAL_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
}

const IDS = revealIds();
const SOURCE = new Map(IDS.map((id) => [id, fs.readFileSync(path.join(REVEAL_DIR, `${id}.js`), 'utf8')]));

/** The operator's SAVED operating point, by pattern id. The gates that claim to
 *  measure "what the ship shows" have to load where the playlist loads. */
const PLAYLIST_DEFAULTS = new Map(
  yaml.load(fs.readFileSync(path.join(SCENES_DIR, 'titanic', 'playlists', 'baby_reveal.yaml'), 'utf8'))
    .entries.map((entry) => [entry.pattern.replace('baby_reveal/', ''), entry.defaults]));

const modelCache = new Map();
async function model(name) {
  if (!modelCache.has(name)) modelCache.set(name, await loadModelForGauge(name));
  return modelCache.get(name);
}

/**
 * HSV -> RGB, in JS, INDEPENDENTLY of the pattern sources.
 *
 * This is deliberately a second implementation rather than a value read out of
 * the authority block: under contract v2 the emitted colour IS this conversion,
 * so a gate that borrowed the pattern's own arithmetic would agree with any bug
 * it contained. Same six-sector formula, written from the definition.
 */
function hsvToRgb(h, s, v) {
  const hue = h - Math.floor(h);
  const sector = Math.floor(hue * 6) % 6;
  const f = hue * 6 - Math.floor(hue * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  if (sector === 0) return [v, t, p];
  if (sector === 1) return [q, v, p];
  if (sector === 2) return [p, v, t];
  if (sector === 3) return [p, q, v];
  if (sector === 4) return [t, p, v];
  return [v, p, q];
}

/** The armed palette's triple, normalised so its largest component is 1 — the
 *  form `isScalarMultiple` compares a byte-domain pixel against. */
function primaryTriple(palette) {
  const rgb = hsvToRgb(palette.h, palette.s, palette.v);
  const peak = Math.max(...rgb);
  assert.ok(peak > 0, 'a gate palette must have a non-zero primary triple');
  return rgb.map((channel) => channel / peak);
}

// Compile one pattern and hand back a driver. `setHsv` is the reason this
// helper is not shared with the tease suite: an hsv control takes three floats,
// and driving it is the entire point of this family.
async function compilePattern(id, modelName) {
  const loaded = await model(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const result = host.compile(SOURCE.get(id));
  assert.equal(result.ok, true, `${id} on ${modelName}: ${result.error}`);
  const exports = host.getExports(result.handle);
  const frame = new Uint8Array(loaded.pixels.length * 6);
  const idOf = (name) => {
    const found = exports.find((entry) => entry.name === name);
    assert.ok(found, `${id}: missing export ${name}`);
    return found.id;
  };
  return {
    exports,
    pixels: loaded.pixels,
    set(control, value) { host.setControl(result.handle, idOf(control), value); },
    setHsv(control, h, s, v) { host.setControl(result.handle, idOf(control), h, s, v); },
    /**
     * Arm the pattern the way the show's `globals` action arms it — and the way
     * the DECK arms it, which under contract v2 is the same single write.
     * Accepts a name from PALETTES or any `{h, s, v}`; ONE slot, no handshake.
     * Returns the normalised RGB triple every lit pixel must now be a multiple
     * of, so a caller cannot arm one colour and measure another.
     */
    arm(palette) {
      const spec = typeof palette === 'string' ? PALETTES[palette] : palette;
      assert.ok(spec, `unknown gate palette ${palette}`);
      this.setHsv('colorPalette1', spec.h, spec.s, spec.v);
      return primaryTriple(spec);
    },
    /** Load the operator's saved operating point for this entry. */
    loadSavedDefaults() {
      const defaults = PLAYLIST_DEFAULTS.get(id);
      assert.ok(defaults, `${id}: no baby_reveal.yaml entry to take saved defaults from`);
      for (const [slider, value] of Object.entries(defaults)) this.set(slider, value);
    },
    render(elapsed) {
      host.beginFrame(result.handle, elapsed);
      return Uint8Array.from(host.renderAll6ch(result.handle, frame));
    },
    close() { host.destroy(result.handle); host.shutdown(); },
  };
}

/** `var DARK_K = 0.28;` → 0.28. The one constant shared with the show YAML. */
function darkK(source) {
  const m = /var\s+DARK_K\s*=\s*([\d.]+)\s*;/.exec(source);
  assert.ok(m, 'every baby_reveal source must declare `var DARK_K = <number>;`');
  return Number.parseFloat(m[1]);
}

/**
 * Every lit pixel must be an EXACT scalar multiple of the triple the ARMED
 * palette resolves to. This is a ratio identity rather than a tolerance: the
 * authority block emits `primaryTriple * k` and nothing else — the dark tone is
 * the SAME triple at `k * DARK_K` — so the only slack allowed is the one byte
 * lost to quantisation on each channel.
 */
function isScalarMultiple(r, g, b, [baseR, baseG, baseB]) {
  const peak = Math.max(r, g, b);
  return Math.abs(r - baseR * peak) <= 1.5
    && Math.abs(g - baseG * peak) <= 1.5
    && Math.abs(b - baseB * peak) <= 1.5;
}

function captureTimeline(pattern, times, step = 0.025) {
  const ticks = times.map((time) => Math.round(time / step));
  const wanted = new Set(ticks);
  const captured = new Map();
  const last = Math.max(...ticks);
  for (let tick = 0; tick <= last; tick++) {
    const frame = pattern.render(tick * step);
    if (wanted.has(tick)) captured.set(tick, frame);
  }
  return ticks.map((tick) => captured.get(tick));
}

// A DENSE grid, on purpose. Both metrics below (single-family purity and the
// two-tone histogram) are time-averages over the whole rig, and report `_305`
// §7.2(d) is the standing lesson here: a time average taken from a handful of
// instants reports its own truncation, not the pattern's envelope. A ten-sample
// version of this grid passed `09_lighthouse_fans` at 25.4% primary mass while a
// dense 60-frame probe of the same source measured 24.6% — i.e. the sparse grid
// was hiding a real marginal. 31 samples across 30 s covers several whole cycles
// of every keeper's slowest clock at the reference operating point.
const REVIEW_TIMES = Array.from({ length: 31 }, (_, i) => i);

/**
 * The tonal histogram of one review, shared by the two-tone gate and the deck
 * gate so both report the same numbers for the same run.
 */
function toneHistogram(peaks) {
  assert.ok(peaks.length > 0, 'nothing lit — no histogram to build');
  const sorted = [...peaks].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.10)];
  const hi = sorted[Math.floor(sorted.length * 0.90)];
  const mid = (lo + hi) / 2;
  const band = (hi - lo) * 0.18;
  const dark = sorted.filter((p) => p < mid - band).length / sorted.length;
  const bright = sorted.filter((p) => p > mid + band).length / sorted.length;
  return { lo, hi, dark, bright, valley: 1 - dark - bright, ratio: hi / Math.max(lo, 1) };
}

// ── the shape of the set ───────────────────────────────────────────────────

test('the Reveal set is curated and named by its directory', () => {
  assert.ok(IDS.length >= MIN_KEEPERS && IDS.length <= MAX_KEEPERS,
    `baby_reveal holds ${IDS.length} looks; the curated range is ${MIN_KEEPERS}-${MAX_KEEPERS}`);
  const numbers = new Set();
  for (const id of IDS) {
    const m = REVEAL_NAME_RE.exec(id);
    assert.ok(m, `${id}: a Reveal pattern must be named <NN>_<concept>.js — the `
      + 'directory is what files it (see patterns/baby_reveal/README.md)');
    const n = Number.parseInt(m[1], 10);
    assert.ok(!numbers.has(n), `${id}: number ${m[1]} is used twice in baby_reveal/`);
    numbers.add(n);
  }
  // Numbering IS playlist order for this family, so it must be a dense 1..N.
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.deepEqual(sorted, sorted.map((_, i) => i + 1),
    'baby_reveal numbering is the playlist order and must run 01..N with no gaps');
});

test('the retired boy/girl world is gone', () => {
  assert.equal(fs.existsSync(path.join(PATTERNS_DIR, 'baby')), false,
    'patterns/baby/ is retired — the answers now live in patterns/baby_reveal/');
  for (const scene of SCENES) {
    for (const retired of ['baby_boy', 'baby_girl']) {
      assert.equal(
        fs.existsSync(path.join(SCENES_DIR, scene, 'playlists', `${retired}.yaml`)), false,
        `${scene}/playlists/${retired}.yaml is retired — one baby_reveal playlist serves both answers`);
    }
  }
});

// ── the colour authority ───────────────────────────────────────────────────

test('every Reveal pattern reads ONE palette slot, and no pattern hard-codes a colour', () => {
  for (const id of IDS) {
    const src = SOURCE.get(id);
    // INVERTED from the retired baby/ rule, deliberately: one playlist serves
    // both answers, so the show must be able to write the family in.
    assert.match(src, /export\s+function\s+colorPalette1\s*\(/,
      `${id}: must export colorPalette1 — the show (and the deck) injects the colour (docs/73 §2)`);
    // Contract v2: slot 2 is not merely unused, it is UNDECLARED. Exporting it
    // would re-enrol the pattern in a slot it does not read, which is how the
    // v1 handshake got built — and the engine's palette autopilot would keep
    // writing a value nothing consumes.
    assert.doesNotMatch(src, /export\s+function\s+colorPalette2\s*\(/,
      `${id}: must NOT export colorPalette2 — under contract v2 the dark tone is DERIVED from `
      + 'colorPalette1 (primary x DARK_K). A pattern may not declare a slot it does not read.');
    // The two family triples may appear NOWHERE. Under v1 they lived inside
    // resolveFamily(); v2 derives the triple from HSV, so a pink or blue RGB
    // literal anywhere in the file is a pattern that has re-learned its colour.
    // Matched on the two components that identify the family (the third is 1.0,
    // which every source legitimately contains), and conjunctively, so an
    // innocent shaping constant that happens to equal one of them cannot fail
    // the gate on its own.
    for (const [name, f] of Object.entries(FAMILIES)) {
      const marks = f.rgb.filter((channel) => channel !== 1.0).map(String);
      assert.equal(marks.every((mark) => src.includes(mark)), false,
        `${id}: the ${name} triple (${marks.join(', ')}) appears in the source — under contract v2 `
        + 'colour is DERIVED from the live palette and no family colour is written down (docs/73 R8)');
    }
    assert.equal(/COLOR_[RGB]_(DARK|LIGHT)/.test(src), false,
      `${id}: carries a retired per-pattern COLOR_* constant — that is the defect this family replaced`);
  }
});

test('the authority block is byte-identical across the whole family', () => {
  const digests = new Set();
  const constants = { DARK_K: new Set(), FLOOR_I: new Set(), FAMILY_TRIM: new Set(), FAMILY_BAR_TRIM: new Set() };
  for (const id of IDS) {
    const src = SOURCE.get(id);
    const start = src.indexOf('export var cp1H');
    const end = src.indexOf('function emitPrimary');
    assert.ok(start >= 0 && end > start, `${id}: the docs/73 §3 authority block is missing or reordered`);
    const block = src.slice(start, end).replace(/\s+/g, '');
    digests.add(crypto.createHash('md5').update(block).digest('hex'));
    for (const key of Object.keys(constants)) {
      const all = [...src.matchAll(new RegExp(`var\\s+${key}\\s*=\\s*([\\d.]+)`, 'g'))];
      assert.equal(all.length, 1, `${id}: ${key} must be declared exactly once`);
      constants[key].add(all[0][1]);
    }
  }
  assert.equal(digests.size, 1,
    `the authority block differs across the family (${digests.size} distinct versions) — `
    + 'it is the single place colour is decided and must be copied verbatim');
  for (const [key, values] of Object.entries(constants)) {
    assert.equal(values.size, 1, `${key} has ${values.size} distinct values across the family`);
  }
});

test('DARK_K agrees between every pattern and the dark tone both show files publish', () => {
  // WHAT THIS MEANS UNDER CONTRACT v2. `colorPalette2` is no longer a handshake
  // the patterns validate — they never read it. The show still writes it,
  // because the slot is an engine-global other consumers see, and what it
  // writes MIRRORS the tone the patterns derive for themselves (same hue, same
  // saturation, value x DARK_K). So this is no longer "the arming contract"; it
  // is a drift check between two places that both describe the same dark tone.
  // It still catches the retune footgun docs/73 §2.6 was written for: someone
  // changes DARK_K in the family and leaves the show publishing the old tone.
  const fromPatterns = new Set(IDS.map((id) => darkK(SOURCE.get(id))));
  assert.equal(fromPatterns.size, 1, `patterns disagree on DARK_K: ${[...fromPatterns].join(', ')}`);
  const k = [...fromPatterns][0];
  for (const scene of SCENES) {
    const showPath = path.join(SCENES_DIR, scene, 'special_events', 'baby_reveal.yaml');
    const show = yaml.load(fs.readFileSync(showPath, 'utf8'));
    const stage = show.stages.find((s) => s.id === 'reveal');
    assert.ok(stage && Array.isArray(stage.choices), `${scene}: baby_reveal.yaml has no reveal stage`);
    for (const choice of stage.choices) {
      const globals = (choice.actions || []).filter((a) => a.type === 'globals');
      assert.equal(globals.length, 1,
        `${scene}/${choice.id}: the reveal choice must carry exactly one globals action (the palette write)`);
      const set = globals[0].set;
      assert.equal(set.colorTransitionMs, 0,
        `${scene}/${choice.id}: colorTransitionMs must be pinned to 0 so the palette SNAPS — `
        + 'a slewed palette would walk the reveal through intermediate hues on the way to the answer');
      assert.equal(set.colorPalette2.v, k,
        `${scene}/${choice.id}: colorPalette2.v (${set.colorPalette2.v}) must equal the patterns' `
        + `DARK_K (${k}). The patterns DERIVE their dark tone from slot 1 and never read slot 2, so `
        + 'this is a mirror, not a handshake — but a mirror that has drifted is documentation that lies');
      assert.equal(set.colorPalette1.h, set.colorPalette2.h,
        `${scene}/${choice.id}: both slots must carry the same hue`);
      const known = Object.values(FAMILIES).some((f) => Math.abs(f.h - set.colorPalette1.h) < 1e-6);
      assert.ok(known, `${scene}/${choice.id}: colorPalette1.h ${set.colorPalette1.h} is not a Baby family hue`);
    }
  }
});

// ── the promises that run on the rig ───────────────────────────────────────

test('an INVALID palette renders BLACK, and any ordinary palette lights the rig', async () => {
  // CONTRACT v2, BOTH HALVES.
  //
  // The refusal is now narrow on purpose: the only thing a pattern refuses is a
  // palette that is not a colour at all — a component outside [0, 1], which is
  // what a corrupted or half-written CPC value looks like. It is NOT a refusal
  // to be on an unexpected hue; that was v1, and it is what put the reveal set
  // black on the deck.
  //
  // Note what is NOT testable here, and why. The VM installs its own hsvPicker
  // default (h 0, s 1, v 1) and calls colorPalette1 at program init regardless
  // of the declared `export var` values, so "never pushed" is indistinguishable
  // from "pushed the engine default" — an unarmed pattern renders RED, not
  // black. Refusal is therefore probed by PUSHING an invalid triple.
  const REFUSALS = [
    ['all components negative', [-1, -1, -1]],
    ['saturation above 1', [0.5, 1.5, 1.0]],
    ['negative value', [0.5, 1.0, -0.2]],
    ['hue above 1', [1.4, 1.0, 1.0]],
  ];
  for (const id of IDS) {
    for (const modelName of MODELS) {
      const pattern = await compilePattern(id, modelName);
      try {
        for (const [label, slot1] of REFUSALS) {
          pattern.setHsv('colorPalette1', ...slot1);
          for (const frame of captureTimeline(pattern, [0, 2.0, 6.0])) {
            const lit = [...frame].some((byte) => byte >= 6);
            assert.equal(lit, false,
              `${id} on ${modelName}: an invalid palette (${label}: ${slot1.join(', ')}) must render `
              + 'BLACK. The family never substitutes a colour of its own (docs/73 §2.4-v2)');
          }
        }
        // ...and the CONVERSE, which under v2 is the load-bearing half: any
        // ordinary palette must LIGHT. Including one that is neither Baby
        // family — that case is the whole point of the ruling.
        for (const name of Object.keys(PALETTES)) {
          pattern.arm(name);
          const armed = captureTimeline(pattern, [0, 2.0, 6.0]);
          assert.ok(armed.some((frame) => [...frame].some((byte) => byte >= 40)),
            `${id} on ${modelName}: the ${name} palette is valid and must light the rig. A reveal `
            + 'keeper that only lights under its own two hues is the v1 defect the operator ruled out');
        }
      } finally { pattern.close(); }
    }
  }
});

test('a Reveal run is ONE family — every lit pixel a multiple of the ARMED colour', async () => {
  // G1, relative to the primary hue. The expected triple is computed HERE from
  // the armed HSV (hsvToRgb above), never read out of the pattern, so a pattern
  // that resolved the palette wrongly cannot define its own pass condition.
  for (const id of IDS) {
    for (const modelName of MODELS) {
      for (const name of Object.keys(PALETTES)) {
        const pattern = await compilePattern(id, modelName);
        try {
          const base = pattern.arm(name);
          const others = Object.entries(PALETTES)
            .filter(([other]) => other !== name)
            .map(([other, spec]) => [other, primaryTriple(spec)]);
          let foreign = 0;
          let lit = 0;
          for (const frame of captureTimeline(pattern, REVIEW_TIMES)) {
            for (let pixel = 0; pixel < frame.length / 6; pixel++) {
              const offset = pixel * 6;
              const [r, g, b, w, a, u] = frame.subarray(offset, offset + 6);
              assert.equal(w, 0, `${id}/${name}/${modelName} pixel ${pixel}: W lane must be zero`);
              assert.equal(a, 0, `${id}/${name}/${modelName} pixel ${pixel}: A lane must be zero`);
              assert.equal(u, 0, `${id}/${name}/${modelName} pixel ${pixel}: U lane must be zero`);
              if (Math.max(r, g, b) < 6) continue;
              lit++;
              if (isScalarMultiple(r, g, b, base)) continue;
              foreign++;
              for (const [other, triple] of others) {
                assert.ok(!isScalarMultiple(r, g, b, triple),
                  `${id} on ${modelName}: armed ${name} but pixel ${pixel} rendered ${other} `
                  + `(${r},${g},${b}). This is the show-breaking defect — the reveal would announce `
                  + 'a colour nobody asked for.');
              }
              assert.fail(`${id} on ${modelName} armed ${name}: pixel ${pixel} is a forbidden third `
                + `hue (${r},${g},${b}) — every lit pixel must be a scalar multiple of the armed triple`);
            }
          }
          assert.equal(foreign, 0);
          assert.ok(lit > 0, `${id} on ${modelName} armed ${name}: nothing lit across the review`);
        } finally { pattern.close(); }
      }
    }
  }
});

test('a Reveal keeper picked from the DECK lights, in the live colour', async () => {
  // THE GATE THE OPERATOR'S RULING EXISTS FOR (docs/73 §2.4-v2).
  //
  // No show armed, no handshake, an ordinary non-Baby palette on the wheel, the
  // entry loaded at its SAVED defaults — exactly what happens when the operator
  // scrolls the picker onto a reveal keeper during an ordinary set. Under
  // contract v1 every one of these rendered black. The two things that must
  // hold are that it LIGHTS (a real fraction of the rig, not a stray pixel) and
  // that it lights in ONE family — the live one.
  //
  // Pure green makes the second half unambiguous: its triple is (0, 1, 0), so
  // "single family" is literally "the R and B lanes are zero". No tolerance, no
  // ratio arithmetic to hide behind.
  //
  // 5% is a floor with real headroom, not a target: the sparsest keeper in the
  // family (08_comet_lullaby, four bodies over black) measures 11.1% on titanic
  // and 16.1% on the bench. A pattern that dropped to a handful of pixels — the
  // failure shape this guards — scores near zero.
  const MIN_LIT_FRACTION = 0.05;
  //
  // The precondition is asserted rather than assumed, in the byte domain the
  // rig actually emits: a pure hue's two off-channels can be a float hair above
  // zero (green's R resolves to 2e-6 through the sector arithmetic), so what
  // has to hold is that neither can ever reach half a byte at FULL drive. Once
  // that is true, a non-zero R or B byte is unambiguously off-family.
  const green = primaryTriple(PALETTES[DECK_PALETTE]);
  assert.ok(green[0] * 255 < 0.5, `${DECK_PALETTE} probe: R must quantise to byte 0 at full drive`);
  assert.ok(green[2] * 255 < 0.5, `${DECK_PALETTE} probe: B must quantise to byte 0 at full drive`);
  for (const id of IDS) {
    for (const modelName of MODELS) {
      const pattern = await compilePattern(id, modelName);
      try {
        pattern.arm(DECK_PALETTE);
        pattern.loadSavedDefaults();
        let lit = 0;
        let sampled = 0;
        let offFamily = 0;
        for (const frame of captureTimeline(pattern, REVIEW_TIMES)) {
          for (let pixel = 0; pixel < frame.length / 6; pixel++) {
            const offset = pixel * 6;
            const [r, g, b] = frame.subarray(offset, offset + 3);
            sampled++;
            if (Math.max(r, g, b) < 6) continue;
            lit++;
            if (r !== 0 || b !== 0) offFamily++;
          }
        }
        assert.equal(offFamily, 0,
          `${id} on ${modelName}: ${offFamily} pixels carried a channel outside the live ${DECK_PALETTE} `
          + 'palette. On the deck the reveal set must be the colour the operator has loaded, exactly');
        const fraction = lit / sampled;
        assert.ok(fraction >= MIN_LIT_FRACTION,
          `${id} on ${modelName}: only ${(fraction * 100).toFixed(1)}% of the rig lit under an ordinary `
          + `${DECK_PALETTE} palette at saved defaults (need ${MIN_LIT_FRACTION * 100}%). A reveal keeper `
          + 'must be usable from the deck, not only inside an armed show (docs/73 §2.4-v2)');
      } finally { pattern.close(); }
    }
  }
});

test('the two tones stay separated — the composition is territory, not a gradient', async () => {
  // docs/73 R2. With one hue the whole fifty-foot read rests on the tonal step:
  // primary against DARK_K x primary. If the level histogram collapses into one
  // mode the pattern has degenerated into brightness-only mush — which is
  // precisely how the retired boy/girl set failed (docs/73 §1).
  //
  // Measured on the prototype (docs/73 D3): a healthy two-tone composition puts
  // ZERO percent of its lit mass in the valley between the tones, while the
  // primary-plus-black control smeared 27% into it.
  //
  // Run under an ORDINARY hue as well as pink, because under contract v2 the
  // dark tone is DERIVED (primary x DARK_K) rather than handed over in slot 2.
  // Deriving it correctly for pink and wrongly for everything else is a real
  // failure mode — and it would be invisible to a pink-only histogram.
  const k = darkK(SOURCE.get(IDS[0]));
  for (const id of IDS) {
    for (const name of ['pink', DECK_PALETTE]) {
      const pattern = await compilePattern(id, 'titanic');
      try {
        pattern.arm(name);
        pattern.loadSavedDefaults();
        const peaks = [];
        for (const frame of captureTimeline(pattern, REVIEW_TIMES)) {
          for (let pixel = 0; pixel < frame.length / 6; pixel++) {
            const offset = pixel * 6;
            const peak = Math.max(frame[offset], frame[offset + 1], frame[offset + 2]);
            if (peak >= 6) peaks.push(peak);
          }
        }
        assert.ok(peaks.length > 0, `${id} under ${name}: nothing lit`);
        const { bright, dark, valley, ratio } = toneHistogram(peaks);
        assert.ok(ratio >= 2.0,
          `${id} under ${name}: tonal ratio ${ratio.toFixed(2)}:1 is too flat — the dark tone must `
          + `read as a second territory, not as a slightly dimmer primary (DARK_K=${k})`);
        assert.ok(bright >= 0.25,
          `${id} under ${name}: only ${(bright * 100).toFixed(1)}% of lit mass is primary tone (need 25%)`);
        assert.ok(dark >= 0.20,
          `${id} under ${name}: only ${(dark * 100).toFixed(1)}% of lit mass is dark tone (need 20%)`);
        assert.ok(valley <= 0.20,
          `${id} under ${name}: ${(valley * 100).toFixed(1)}% of lit mass sits BETWEEN the two tones `
          + '(max 20%) — the tones are smearing into a gradient (docs/73 R2/R3: thresholds, not ramps)');
      } finally { pattern.close(); }
    }
  }
});

test('every keeper is animated and distinct from its siblings', async () => {
  const signatures = new Map();
  for (const id of IDS) {
    const pattern = await compilePattern(id, 'titanic');
    try {
      pattern.arm('pink');
      const frames = captureTimeline(pattern, [0, 1.0, 2.5, 5.0]);
      let peakDelta = 0;
      let meanDelta = 0;
      for (let i = 1; i < frames.length; i++) {
        let total = 0;
        for (let b = 0; b < frames[i].length; b++) {
          const d = Math.abs(frames[i][b] - frames[i - 1][b]);
          if (d > peakDelta) peakDelta = d;
          total += d;
        }
        meanDelta = Math.max(meanDelta, total / frames[i].length);
      }
      assert.ok(peakDelta >= 40, `${id}: peak per-pixel delta ${peakDelta} < 40 — not animated`);
      assert.ok(meanDelta >= 1.0, `${id}: mean frame delta ${meanDelta.toFixed(2)} < 1.0 — not animated`);
      signatures.set(id, frames[3]);
    } finally { pattern.close(); }
  }
  for (const [a, left] of signatures) {
    for (const [b, right] of signatures) {
      if (a >= b) continue;
      let total = 0;
      for (let i = 0; i < left.length; i++) total += Math.abs(left[i] - right[i]);
      const delta = total / left.length;
      // With one colour, distinctness is a test of GEOMETRY — colour can no
      // longer carry the difference between two looks.
      assert.ok(delta > 1.5,
        `${a} and ${b} render near-identically (mean delta ${delta.toFixed(2)}). With a single family `
        + 'the geometry is the only thing telling two keepers apart.');
    }
  }
});

test('no keeper is autonomous-in-name-only: every clock free-runs in silence', () => {
  for (const id of IDS) {
    const src = SOURCE.get(id);
    assert.equal(src.includes('AUDIO_MODULATION_V1'), false,
      `${id}: the Reveal family is fully autonomous — silence and music must look identical`);
  }
});

// ── the playlist ───────────────────────────────────────────────────────────

test('the baby_reveal playlist is byte-identical across scenes and matches the family on disk', () => {
  const copies = SCENES.map((scene) => {
    const file = path.join(SCENES_DIR, scene, 'playlists', 'baby_reveal.yaml');
    assert.ok(fs.existsSync(file), `${scene}/playlists/baby_reveal.yaml is missing`);
    return fs.readFileSync(file);
  });
  assert.ok(copies[0].equals(copies[1]),
    'both scenes must carry byte-identical copies of baby_reveal.yaml — the answer must not depend '
    + 'on which rig is driving');
  const playlist = yaml.load(copies[0].toString('utf8'));
  const referenced = playlist.entries.map((entry) => entry.pattern);
  assert.deepEqual(referenced, IDS.map((id) => `baby_reveal/${id}`),
    'the playlist must carry the whole family, in file-number order (numbering IS playlist order)');
  const seen = new Set();
  for (const entry of playlist.entries) {
    assert.ok(!seen.has(entry.id), `duplicate playlist entry id ${entry.id}`);
    seen.add(entry.id);
  }
});

test('every playlist entry names exactly the sliders its pattern exports', async () => {
  const playlist = yaml.load(
    fs.readFileSync(path.join(SCENES_DIR, 'titanic', 'playlists', 'baby_reveal.yaml'), 'utf8'));
  for (const entry of playlist.entries) {
    const id = entry.pattern.replace('baby_reveal/', '');
    const pattern = await compilePattern(id, 'titanic');
    try {
      const sliders = pattern.exports.map((e) => e.name).filter((n) => n.startsWith('slider')).sort();
      const named = Object.keys(entry.defaults || {}).sort();
      assert.deepEqual(named, sliders,
        `${entry.id}: defaults name [${named.join(', ')}] but the pattern exports [${sliders.join(', ')}]. `
        + 'A default naming a slider that does not exist lands on nothing and looks like a retune.');
      // docs/73 §4.3: declaration order IS MFT knob order.
      const declared = pattern.exports.map((e) => e.name).filter((n) => n.startsWith('slider'));
      assert.equal(declared[0], 'sliderLocalSpeed', `${id}: sliderLocalSpeed must be the FIRST slider`);
      if (declared.includes('sliderDirection')) {
        assert.equal(declared[1], 'sliderDirection', `${id}: sliderDirection must be the SECOND slider`);
      }
      // The Baby show carries a 30% lift over its prior 0.36 operating point,
      // and every Reveal entry must load at the same 0.468 value.
      assert.equal(entry.defaults.sliderLocalSpeed, 0.468,
        `${entry.id}: every Reveal pattern must load with the latest local-speed lift`);
    } finally { pattern.close(); }
  }
});
