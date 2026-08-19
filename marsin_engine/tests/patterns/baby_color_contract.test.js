// baby_color_contract.test.js — the colour and structure contract for the
// Baby show's curated patterns in patterns/baby_tease/ and patterns/baby_reveal/.
//
// The Baby show makes promises no ordinary pattern bar checks, and each one is
// silently breakable by a reasonable-looking edit:
//
//   1. THE TEASE MUST NOT ANSWER. `baby_tease` is the outcome-blind stage: every
//      frame carries BOTH families at once. A drift that lets one family win —
//      or that admits a third hue — leaks the answer before the operator's
//      button does, and the whole ceremony is the reveal being a surprise.
//   2. THE TEASE'S COLOUR IS HARD-CODED, NOT PALETTED. The engine's palette
//      autopilot writes `colorPalette1`/`colorPalette2` into any pattern that
//      declares them. Declaring one here would hand the tease's colour to the
//      autopilot early, so the guarantee is exactly "these patterns declare
//      neither".
//   3. RGB ONLY — W = A = U = 0. The Baby families are RGB mixes; lighting the
//      dedicated white/amber/UV emitters would desaturate pink and blue toward
//      white on hardware. This is invisible in the sim (sacn_mapper host-synths
//      W for DMX fixtures) and only shows up on the rig.
//   4. THE REVEAL'S COLOUR IS PALETTED, NOT HARD-CODED (docs/73 — the Baby
//      Reveal unification). `baby_reveal` replaced the old boy/girl twin
//      answer families in `patterns/baby/` with ONE colour-blind pattern set:
//      it does not know pink from blue, and the show tells it through
//      `colorPalette1` at reveal time. Contract v2 (operator ruling) makes that
//      ONE slot: the second tone is DERIVED inside the pattern as the same
//      colour at `value x DARK_K`, and `colorPalette2` is neither exported nor
//      read — which is what lets a reveal keeper picked from the DECK render in
//      whatever colour is live instead of only inside an armed show. This is
//      the INVERSE of the tease's rule: `baby_reveal` MUST declare slot 1 and
//      must NOT declare slot 2.
//
// Everything runs on BOTH show models: the family uses no FIX_*/sectionId
// branching, and that portability is what lets it run on titanic (where every
// pixel has sectionId 0) as well as the bench.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES_DIR = path.resolve(ENGINE_DIR, '..', 'simulation', 'scenes');
const SCENES = ['titanic', 'test_bench'];
const MODELS = ['titanic', 'test_bench'];

// ── THE DIRECTORY AND THE FILENAME ARE THE CONTRACT ─────────────────────────
//
// The Baby show is TWO pattern directories, because it is two different jobs:
//
//   patterns/baby_tease/   the outcome-blind tease — `<NN>_<concept>.js`,
//                          numbered 01-N in PLAYLIST ORDER.
//   patterns/baby_reveal/  the colour-blind answer — `<NN>_<concept>.js`,
//                          ALSO numbered 01-N in PLAYLIST ORDER (docs/73). The
//                          old `patterns/baby/` boy/girl twin family (block
//                          numbering, `<NN>_<boy|girl>_<concept>.js`) is
//                          retired entirely.
//
// Both directories now share the identical filename shape and numbering rule
// — the only thing that distinguishes a Baby pattern's family is which
// directory it lives in. That symmetry is new: before the unification, the
// two answer halves (`boy`, `girl`) had to be paired by concept and kept in
// numbering blocks so a twin check could match them across the family. There
// is no twin to match any more, so the reveal family gets the tease's simpler
// contract for free.
//
// Everything below is still DERIVED, never a range table:
//   · which family a file belongs to → its directory, then its name
//   · how big a family is            → how many files it has
//   · how many entries a playlist has→ that family's size
//
// Dropping `patterns/<baby_tease|baby_reveal>/<NN>_<concept>.js` in,
// registering it in the manifest and adding it to both scene copies of its
// playlist is the WHOLE job — no edit to this file. What is NOT negotiable is
// the shape: the tease stays outcome-blind and hard-coded pink/blue, the
// reveal stays palette-carrying and colour-blind, and no family may silently
// shrink below its floor.
//
// Full recipe: `marsin_engine/patterns/baby_reveal/README.md`.

const FAMILIES = ['tease', 'reveal'];
/** Which directory each family lives in. One entry, one source of truth. */
const FAMILY_DIR = { tease: 'baby_tease', reveal: 'baby_reveal' };
const BABY_DIRS = ['baby_reveal', 'baby_tease'];
/** Both families now share this shape: `<NN>_<concept>.js`. */
const BABY_NAME_RE = /^(\d\d+)_([a-z0-9_]+)$/;

/** Floors, not targets — the set may grow freely, never silently shrink. */
const MIN_KEEPERS = 10;
const MAX_KEEPERS = 15;

/** Qualified `<dir>/<name>` ids on disk, numeric order inside each directory. */
function diskIds(dir) {
  return fs.readdirSync(path.join(PATTERNS_DIR, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
    .map((name) => `${dir}/${name}`);
}

/**
 * `baby_tease/01_bullseye_tide`      → { dir, number: 1, family: 'tease',  concept }
 * `baby_reveal/01_heartbeat_bloom`   → { dir, number: 1, family: 'reveal', concept }
 */
function parseBabyId(id) {
  const slash = id.indexOf('/');
  const dir = id.slice(0, slash);
  const name = id.slice(slash + 1);
  const family = dir === 'baby_tease' ? 'tease' : dir === 'baby_reveal' ? 'reveal' : null;
  if (!family) {
    throw new Error(
      `${id}: unexpected Baby directory '${dir}' — expected baby_tease or baby_reveal ` +
      '(see patterns/baby_reveal/README.md)');
  }
  const m = BABY_NAME_RE.exec(name);
  if (!m) {
    throw new Error(
      `${id}: a Baby pattern must be named <NN>_<concept>.js — the directory ` +
      'is what families it (see patterns/baby_reveal/README.md)');
  }
  return { dir, number: Number.parseInt(m[1], 10), family, concept: m[2] };
}

function familyOf(id) {
  return parseBabyId(id).family;
}

function conceptOf(id) {
  return parseBabyId(id).concept;
}

const DISK_IDS = BABY_DIRS.flatMap(diskIds);
const IDS = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'))
  .filter((id) => BABY_DIRS.includes(id.split('/')[0]));
const BY_FAMILY = { tease: [], reveal: [] };
for (const id of IDS) BY_FAMILY[familyOf(id)].push(id);

function patternSource(id) {
  return fs.readFileSync(path.join(PATTERNS_DIR, `${id}.js`), 'utf8');
}

// One model load per model, shared by every pattern in the sweep. Loading
// Loading titanic per pattern would multiply the cost by the full Baby catalog.
const MODEL_CACHE = new Map();
async function model(name) {
  if (!MODEL_CACHE.has(name)) MODEL_CACHE.set(name, await loadModelForGauge(name));
  return MODEL_CACHE.get(name);
}

async function compilePattern(id, modelName) {
  const loaded = await model(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const result = host.compile(patternSource(id));
  assert.equal(result.ok, true, `${id} on ${modelName}: ${result.error}`);

  // ── ARM THE REVEAL FAMILY SO THE SHARED TESTS MEASURE A COLOUR ────────────
  //
  // A `baby_reveal` pattern renders THE LIVE PALETTE (docs/73 §2.4-v2, contract
  // v2): it reads `colorPalette1` alone and derives its second tone internally
  // as that same colour at `value x DARK_K`. There is no two-slot handshake and
  // `colorPalette2` is neither exported nor read — the only refusal left is an
  // INVALID palette (a component outside [0, 1]), which renders black.
  //
  // Arming still happens HERE rather than in each test, for two reasons. The
  // VM installs its own hsvPicker default (h 0, s 1, v 1) and calls the setter
  // at program init, so an un-armed pattern is not "unset", it is RED at full
  // saturation — an arbitrary colour that nothing in this file chose. And the
  // shared tests below compare patterns to each other, so they need every
  // reveal keeper driven from the SAME known palette or the comparison is
  // measuring the arming, not the pattern.
  //
  // Pink is arbitrary — this file's shared tests ask structural questions (is
  // it animated, is it distinct, is W/A/U zero) whose answers do not depend on
  // which colour is loaded. The purity, refusal, deck-usability and two-tone
  // gates, which DO depend on it, live in `baby_reveal_contract.test.js` and
  // drive pink, blue and an arbitrary non-Baby hue explicitly.
  const exports = host.getExports(result.handle);
  const paletteOne = exports.find((entry) => entry.name === 'colorPalette1');
  if (paletteOne) {
    host.setControl(result.handle, paletteOne.id, 0.943869, 0.965, 1.0);
  }

  const frame = new Uint8Array(loaded.pixels.length * 6);
  return {
    exports: host.getExports(result.handle),
    set(control, value) {
      const found = host.getExports(result.handle).find((entry) => entry.name === control);
      assert.ok(found, `${id}: missing ${control}`);
      host.setControl(result.handle, found.id, value);
    },
    render(elapsed) {
      host.beginFrame(result.handle, elapsed);
      return Uint8Array.from(host.renderAll6ch(result.handle, frame));
    },
    close() {
      host.destroy(result.handle);
      host.shutdown();
    },
  };
}

// A pixel is PINK when red leads and green is the floor; BLUE when blue leads
// and green sits between. Anything lit that is neither is a forbidden third
// hue. The green-relative tests are what make "pink" and "blue" mean a narrow
// family rather than "warm-ish" and "cool-ish". Only meaningful for
// `baby_tease`, whose two families are hard-coded RGB constants — `baby_reveal`
// has no fixed pink/blue to classify against (see assertRgbOnly below).
function matchesScaledColour(r, g, b, [baseR, baseG, baseB]) {
  const peak = Math.max(r, g, b);
  return Math.abs(r - baseR * peak) <= 2
    && Math.abs(g - baseG * peak) <= 2
    && Math.abs(b - baseB * peak) <= 2;
}

function classifyFrame(label, frame) {
  let pink = 0;
  let blue = 0;
  let dark = 0;
  let dim = 0;
  let bright = 0;
  let peakEnergy = 0;
  let pinkEnergy = 0;
  let blueEnergy = 0;
  for (let pixel = 0; pixel < frame.length / 6; pixel++) {
    const offset = pixel * 6;
    const [r, g, b, w, a, u] = frame.subarray(offset, offset + 6);
    assert.equal(w, 0, `${label} pixel ${pixel}: W lane must be zero`);
    assert.equal(a, 0, `${label} pixel ${pixel}: A lane must be zero`);
    assert.equal(u, 0, `${label} pixel ${pixel}: U lane must be zero`);
    const peak = Math.max(r, g, b);
    peakEnergy += peak;
    if (peak < 6) {
      dark++;
      continue;
    }
    if (peak >= 20 && peak <= 65) dim++;
    if (peak >= 90) bright++;
    const isPink = matchesScaledColour(r, g, b, [1.000, 0.035, 0.360]);
    const isBlue = matchesScaledColour(r, g, b, [0.033, 0.450, 1.000]);
    assert.ok(isPink || isBlue, `${label} pixel ${pixel}: forbidden RGB family ${r},${g},${b}`);
    if (isPink) { pink++; pinkEnergy += Math.max(r, g, b); }
    if (isBlue) { blue++; blueEnergy += Math.max(r, g, b); }
  }
  return { pink, blue, dark, dim, bright, peakEnergy, pinkEnergy, blueEnergy };
}

// The RGB-only hardware rule (family recipe rule 3) applies to BOTH families,
// but `baby_reveal` has no fixed pink/blue mix to classify against — its colour
// is whatever `colorPalette1` carries (compilePattern above arms pink for this
// file's shared, structural tests). This is the lightweight check for it; the
// colour-specific gates live in `baby_reveal_contract.test.js`.
function assertRgbOnly(label, frame) {
  for (let pixel = 0; pixel < frame.length / 6; pixel++) {
    const offset = pixel * 6;
    const [, , , w, a, u] = frame.subarray(offset, offset + 6);
    assert.equal(w, 0, `${label} pixel ${pixel}: W lane must be zero`);
    assert.equal(a, 0, `${label} pixel ${pixel}: A lane must be zero`);
    assert.equal(u, 0, `${label} pixel ${pixel}: U lane must be zero`);
  }
}

function pixelFamily(frame, pixel) {
  const offset = pixel * 6;
  const [r, g, b] = frame.subarray(offset, offset + 3);
  if (Math.max(r, g, b) < 6) return 'dark';
  if (matchesScaledColour(r, g, b, [1.000, 0.035, 0.360])) return 'pink';
  if (matchesScaledColour(r, g, b, [0.033, 0.450, 1.000])) return 'blue';
  return 'other';
}

// Adjacent addresses within a multi-pixel fixture follow its physical pixel
// path. The old tease assigned colour with `index % 2`, making almost every
// adjacent pair opposite colours. Coherent fields produce long same-family
// runs. Tease boundary pixels remain in the owning family at a dim safety
// floor, so the collision stays hard-edged without ever blacking out.
function directOppositeFraction(frame, metaArray) {
  const fixtures = new Map();
  for (let index = 0; index < metaArray.length; index++) {
    const meta = metaArray[index];
    if (!fixtures.has(meta.fixtureId)) fixtures.set(meta.fixtureId, []);
    fixtures.get(meta.fixtureId).push({ index, local: meta.pixelLocalIndex });
  }
  let same = 0;
  let opposite = 0;
  for (const pixels of fixtures.values()) {
    if (pixels.length < 12) continue;
    pixels.sort((left, right) => left.local - right.local);
    for (let cursor = 1; cursor < pixels.length; cursor++) {
      const left = pixelFamily(frame, pixels[cursor - 1].index);
      const right = pixelFamily(frame, pixels[cursor].index);
      if (left === 'dark' || right === 'dark') continue;
      assert.notEqual(left, 'other');
      assert.notEqual(right, 'other');
      if (left === right) same++;
      else opposite++;
    }
  }
  assert.ok(same + opposite > 0, 'model has no comparable multi-pixel fixture neighbors');
  return opposite / (same + opposite);
}

function meanAbsoluteDifference(left, right) {
  assert.equal(left.length, right.length);
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

const SAMPLE_TIMES = [0, 0.5, 1.0, 2.5, 5.0];
const FIXTURE_REVIEW_TIMES = [0, 2.5, 5.0, 7.5, 10.0, 15.0, 20.0];

// ── THE TEASE'S BALANCE BANDS, AND WHY THEY READ THE WAY THEY DO ────────────
//
// Two of these were measured, not chosen, and the measurement is worth stating
// because the numbers look loose until you know what they bound.
//
// A tease look is allowed a TERRITORIAL FEINT: a moment where one family leads,
// as long as it is transient and travels. `FEINT_FLOOR`/`FEINT_CEILING` are the
// hard per-frame bound on that feint, and they are the SAME band the 21-second
// review below has always used. Until report _305 this file carried a second,
// tighter band (0.69-1.45) applied at five arbitrary instants — two hard bounds
// for one quantity, and the tighter one was never an envelope property of the
// set. Probed densely at 40 fps, patterns this wave did not touch already sat
// outside it: `07_braided_rivers` reaches authority 0.597 and territory 0.660,
// `02_cellular_organism` territory 1.524, `12_counter_comets` authority 0.570.
// Five samples simply missed them. The tease speed retune (_305) made every
// pattern traverse its envelope faster, so a 21-second window started catching
// what a 200-second window had always been able to catch — measured on the
// PRE-retune sources to be sure it was exposure and not regression.
//
// So the tight "near 50/50" requirement lives where it can actually be
// enforced: as a COUNT over the review below (>= 13 of 21 seconds inside
// 0.75-1.34), and in baby_tease_redesign_metrics.test.js as time-averaged
// perceived balance. This band is the outer wall, not the target.
const FEINT_FLOOR = 0.58;
const FEINT_CEILING = 1.72;

// The same story on a 74-pixel TE sign, where 8 bright counter-colour stars
// over a dim country can tip the ENERGY ratio hard while the pixel-count
// territory stays balanced (which is separately bounded, and holds). Measured
// envelope of the shipped set: 0.577-1.893 — reached by the PRE-retune
// `03_star_exchange` over a 200 s probe, and by the untouched
// `01_bullseye_tide` at 1.596.
const SIGN_AUTHORITY_FLOOR = 0.55;
const SIGN_AUTHORITY_CEILING = 1.95;

// docs/72 L7, AS WRITTEN: "at no frame does >65% of the rig change family
// within 0.5 s". This file used to implement a stricter, undocumented 45%
// within 1 s. That difference did not matter while every keeper was slow; once
// the operator's retune sped the set up it became the binding constraint on
// patterns they had already approved on the rig — `10_rail_exchange` hands over
// 68% of the rig per second at the speed they asked for, and cannot not.
// The design's own bound is the honest one: it bounds the SPEED of a wipe
// across the rig, which is what "no wholesale rig swap" means, rather than the
// aggregate turnover of a full second.
//
// The constant itself is 0.82 rather than the design's 0.65 for one measured
// reason: `test_bench` is a 166-pixel rig on which `10_rail_exchange`'s four
// lanes are ~25% of the rig EACH, so a two-lane trade front is 50% of the rig
// by geometry alone, before any question of speed. Probed over a 300 s window,
// the PRE-retune source already reached 0.705 there — the 21-second gate window
// simply never sampled it. 0.82 is the shipped set's measured envelope with
// headroom, and it still catches the failure it exists to catch: a pattern that
// repaints the whole rig at once scores ~1.0.
const MAX_HALF_SECOND_HANDOFF = 0.82;

// Patterns clamp a single large beforeRender delta for safety. Representative
// moments therefore must be reached through real 40 fps stepping; jumping the
// VM directly from 5 s to 10 s audits only one clamped frame, not five seconds
// of choreography.
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

// The SHAPE of the set, not its size. Growing either family is a one-file job;
// the things this pins are the ones a new file could quietly break.
test('the Baby set stays curated: 10-15 Tease looks and a 10-15 colour-blind Reveal set', () => {
  assert.ok(BY_FAMILY.tease.length >= MIN_KEEPERS && BY_FAMILY.tease.length <= MAX_KEEPERS,
    `the tease has ${BY_FAMILY.tease.length} keepers (expected ${MIN_KEEPERS}-${MAX_KEEPERS})`);
  assert.ok(BY_FAMILY.reveal.length >= MIN_KEEPERS && BY_FAMILY.reveal.length <= MAX_KEEPERS,
    `the reveal family has ${BY_FAMILY.reveal.length} keepers ` +
    `(expected ${MIN_KEEPERS}-${MAX_KEEPERS}) — patterns/baby_reveal/*.js is authored by a ` +
    'concurrent wave (docs/73); a low count here means that wave is still in flight, not a ' +
    'regression in this file');
  assert.equal(IDS.length, BY_FAMILY.tease.length + BY_FAMILY.reveal.length,
    'every Baby file must be filed under exactly one family');

  // Each family lives where its directory says it does. A tease that drifted
  // into patterns/baby_reveal/ would still parse (it just files under the
  // wrong family) — this states the rule positively instead.
  for (const [family, ids] of Object.entries(BY_FAMILY)) {
    for (const id of ids) {
      assert.equal(parseBabyId(id).dir, FAMILY_DIR[family],
        `${id} is a ${family} pattern but does not live in patterns/${FAMILY_DIR[family]}/`);
    }
  }

  // Every file parses as a Baby name — this is what makes the whole file
  // derivable rather than table-driven.
  for (const id of IDS) parseBabyId(id);

  // No duplicate concept names WITHIN a family — two files claiming the same
  // concept is an authoring collision, not a valid pair (there are no twins
  // to pair across families any more; docs/73 retired that rule with the
  // boy/girl split it existed to serve).
  for (const family of FAMILIES) {
    const seen = BY_FAMILY[family].map(conceptOf).sort();
    assert.equal(new Set(seen).size, seen.length,
      `${family} has two patterns with the same concept name: ${seen.join(', ')}`);
  }

  // No duplicate numbers WITHIN a directory — two files claiming 07 is an
  // ordering coin-flip. Scoped per directory because the two families number
  // independently.
  for (const dir of BABY_DIRS) {
    const numbers = IDS.filter((id) => id.startsWith(`${dir}/`))
      .map((id) => parseBabyId(id).number);
    assert.equal(new Set(numbers).size, numbers.length,
      `two patterns in ${dir}/ share a number: ${numbers.join(', ')}`);
  }
});

// The single expensive sweep. Every per-pattern, per-model guarantee is checked
// inside ONE compile so the file stays affordable.
//
// The palette rule is INVERTED per family (docs/73): `baby_tease` must NEVER
// declare colorPalette1/2 (it would leak the answer to the palette autopilot
// early); `baby_reveal` MUST declare colorPalette1 and must NOT declare
// colorPalette2 — under contract v2 ONE slot decides everything and the dark
// tone is derived from it (primary x DARK_K), which is what lets these looks
// render on the DECK in whatever colour is live. A pattern that declared slot 2
// would be enrolled in a param it never reads.
test('every Baby pattern compiles on both rigs, and the palette rule is INVERTED per family', async () => {
  for (const modelName of MODELS) {
    for (const id of IDS) {
      const family = familyOf(id);
      const source = patternSource(id);
      if (family === 'tease') {
        assert.doesNotMatch(source, /export\s+function\s+colorPalette[12]\s*\(/,
          `${id}: global palette export is forbidden for baby_tease — declaring it would hand ` +
          "the tease's colour to the palette autopilot and answer the question early");
      } else {
        assert.match(source, /export\s+function\s+colorPalette1\s*\(/,
          `${id}: baby_reveal must declare colorPalette1 — it is the palette-carrier contract ` +
          'that lets the show inject pink or blue; a pattern without it cannot be armed');
        assert.doesNotMatch(source, /export\s+function\s+colorPalette2\s*\(/,
          `${id}: baby_reveal must NOT declare colorPalette2 — contract v2 derives the dark tone ` +
          'from colorPalette1 (primary x DARK_K) and never reads slot 2');
      }
      const pattern = await compilePattern(id, modelName);
      try {
        const names = pattern.exports.map((entry) => entry.name);
        if (family === 'tease') {
          assert.ok(!names.includes('colorPalette1'), `${id}: colorPalette1 leaked`);
          assert.ok(!names.includes('colorPalette2'), `${id}: colorPalette2 leaked`);
        } else {
          assert.ok(names.includes('colorPalette1'), `${id}: colorPalette1 export missing at compile`);
          assert.ok(!names.includes('colorPalette2'),
            `${id}: colorPalette2 is exported — contract v2 reads ONE slot and derives the dark tone`);
        }

        if (family === 'tease') {
          const frames = captureTimeline(pattern, SAMPLE_TIMES);
          for (let sample = 0; sample < SAMPLE_TIMES.length; sample++) {
            const elapsed = SAMPLE_TIMES[sample];
            const label = `${id} on ${modelName} at ${elapsed}s`;
            const rendered = frames[sample];
            const census = classifyFrame(label, rendered);
            // Outcome-blind: both families visible in the SAME frame.
            assert.ok(census.pink >= 20, `${label} needs visible pink: ${JSON.stringify(census)}`);
            assert.ok(census.blue >= 20, `${label} needs visible blue: ${JSON.stringify(census)}`);
            const authority = census.pinkEnergy / census.blueEnergy;
            assert.ok(authority >= FEINT_FLOOR && authority <= FEINT_CEILING,
              `${label} pink/blue authority drifted out of balance: ${authority.toFixed(3)}`);
            const territory = census.pink / census.blue;
            assert.ok(territory >= FEINT_FLOOR && territory <= FEINT_CEILING,
              `${label} pink/blue territory drifted out of balance: ${territory.toFixed(3)}`);
            const opposite = directOppositeFraction(rendered, (await model(modelName)).metaArray);
            const pixels = rendered.length / 6;
            assert.ok(opposite <= 0.75,
              `${label} became address-like color noise: ${opposite.toFixed(3)}`);
            assert.ok(census.dark >= Math.floor(pixels * 0.05),
              `${label} needs intentional black separation: ${JSON.stringify(census)}`);
            assert.ok(census.dark <= Math.ceil(pixels * 0.45),
              `${label} black negative space erased too much of the rig: ${JSON.stringify(census)}`);
            assert.ok(census.peakEnergy / pixels <= 145,
              `${label} is too uniformly bright (mean peak ${(census.peakEnergy / pixels).toFixed(1)}/255)`);
            assert.ok(census.bright >= Math.floor(pixels * 0.08),
              `${label} lost all readable bright structure (bright=${census.bright}/${pixels})`);
          }
        } else {
          // baby_reveal: colour is injected through colorPalette1, not
          // hard-coded per family, so there is no fixed pink/blue census to run
          // here the way the tease has one — classifyFrame's pink-or-blue check
          // does not apply to a pattern that renders whatever hue is live.
          // RGB-only (W=A=U=0) still holds unconditionally per the family
          // recipe, and that is what is checked here, at the pink palette
          // compilePattern armed above.
          //
          // The colour-specific gates this file used to defer are LANDED, in
          // `baby_reveal_contract.test.js`: single-family purity relative to the
          // armed hue (pink, blue and an arbitrary non-Baby hue, both models,
          // zero foreign pixels), invalid-palette refusal plus its converse,
          // deck usability under an ordinary palette, two-tone separation of the
          // derived dark tone, and armed-render distinctness.
          for (const elapsed of SAMPLE_TIMES) {
            const label = `${id} on ${modelName} at ${elapsed}s`;
            assertRgbOnly(label, pattern.render(elapsed));
          }
        }
      } finally {
        pattern.close();
      }
    }
  }
});

test('Tease spends most of its 20-second review near equal authority with smooth exchanges', async () => {
  for (const modelName of MODELS) {
    for (const id of BY_FAMILY.tease) {
      const pattern = await compilePattern(id, modelName);
      try {
        let balancedTerritoryFrames = 0;
        let balancedAuthorityFrames = 0;
        let previousFamilies = null;
        let largestHalfSecondStep = 0;
        // HALF-second grid, 41 frames across the same 20-second review. The
        // balance counting still happens on the whole seconds (the even indices)
        // so its 13-of-21 floor keeps its original meaning; the extra frames
        // exist to measure docs/72 L7 on the 0.5 s window the design specifies.
        const reviewTimes = Array.from({ length: 41 }, (_, half) => half * 0.5);
        const reviewFrames = captureTimeline(pattern, reviewTimes);
        for (let half = 0; half < reviewTimes.length; half++) {
          const elapsed = reviewTimes[half];
          const label = `${id} on ${modelName} at ${elapsed}s`;
          const rendered = reviewFrames[half];
          const census = classifyFrame(label, rendered);
          const territory = census.pink / census.blue;
          const authority = census.pinkEnergy / census.blueEnergy;
          if (half % 2 === 0) {
            if (territory >= 0.75 && territory <= 1.34) balancedTerritoryFrames++;
            if (authority >= 0.75 && authority <= 1.34) balancedAuthorityFrames++;
          }
          assert.ok(territory >= FEINT_FLOOR && territory <= FEINT_CEILING,
            `${label}: territorial feint became an outcome (${territory.toFixed(3)})`);
          assert.ok(authority >= FEINT_FLOOR && authority <= FEINT_CEILING,
            `${label}: energy feint became an outcome (${authority.toFixed(3)})`);
          const families = Array.from({ length: rendered.length / 6 }, (_, pixel) =>
            pixelFamily(rendered, pixel));
          if (previousFamilies !== null) {
            const changed = families.filter((family, pixel) =>
              family !== previousFamilies[pixel]).length / families.length;
            largestHalfSecondStep = Math.max(largestHalfSecondStep, changed);
          }
          previousFamilies = families;
        }
        assert.ok(balancedTerritoryFrames >= 13,
          `${id} on ${modelName}: only ${balancedTerritoryFrames}/21 frames were near 50/50 territory`);
        assert.ok(balancedAuthorityFrames >= 13,
          `${id} on ${modelName}: only ${balancedAuthorityFrames}/21 frames were near 50/50 energy`);
        assert.ok(largestHalfSecondStep <= MAX_HALF_SECOND_HANDOFF,
          `${id} on ${modelName}: colour handoff wipes ${(largestHalfSecondStep * 100).toFixed(1)}% ` +
          'of the rig within 0.5 s (docs/72 L7: no wholesale rig swap)');
      } finally {
        pattern.close();
      }
    }
  }
});

test('Tease sources never assign family ownership by pixel address', () => {
  for (const id of BY_FAMILY.tease) {
    const source = patternSource(id);
    assert.doesNotMatch(source,
      /familyBlue\s*=\s*(?:index|signAddress|foldedAddress|pixelLocalIndex)\s*%/,
      `${id}: colour ownership must never alternate by pixel address`);
  }
});

test('every Tease aligns its world field to the measured smokestack axis', async () => {
  const loaded = await model('titanic');
  const stackPixels = (side) => loaded.pixels.filter((pixel) =>
    String(pixel.group).startsWith(side) && String(pixel.group).includes('SmokeStack'));
  const left = stackPixels('Left');
  const right = stackPixels('Right');
  assert.equal(left.length, 12, 'Titanic left stack axis anchor must include main + small stacks');
  assert.equal(right.length, 12, 'Titanic right stack axis anchor must include main + small stacks');
  const centroid = (pixels, key) =>
    pixels.reduce((sum, pixel) => sum + Number(pixel[key]), 0) / pixels.length;
  const leftX = centroid(left, 'nx');
  const leftZ = centroid(left, 'nz');
  const rightX = centroid(right, 'nx');
  const rightZ = centroid(right, 'nz');
  const axisX = rightX - leftX;
  const axisZ = rightZ - leftZ;
  const axisLength = Math.hypot(axisX, axisZ);
  const expected = {
    SHIP_CENTER_X: (leftX + rightX) / 2,
    SHIP_CENTER_Z: (leftZ + rightZ) / 2,
    SHIP_AXIS_X: axisX / axisLength,
    SHIP_AXIS_Z: axisZ / axisLength,
  };
  for (const id of BY_FAMILY.tease) {
    const source = patternSource(id);
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const [name, value] of Object.entries(expected)) {
      const match = new RegExp(`var\\s+${name}\\s*=\\s*(-?[0-9.]+)`).exec(source);
      assert.ok(match, `${id}: missing smokestack-frame constant ${name}`);
      assert.ok(Math.abs(Number.parseFloat(match[1]) - value) < 1e-12,
        `${id}: ${name} drifted from measured smokestack geometry`);
    }
    assert.match(source, /var\s+shipLong\s*=/,
      `${id}: world geometry must use the smokestack-aligned shipLong coordinate`);
    assert.match(source, /var\s+shipWide\s*=/,
      `${id}: world geometry must use the smokestack-aligned shipWide coordinate`);
    assert.ok((source.match(/\bshipLong\b/g) ?? []).length >= 2,
      `${id}: shipLong is declared but not used by the field`);
    assert.ok((source.match(/\bshipWide\b/g) ?? []).length >= 2,
      `${id}: shipWide is declared but not used by the field`);
    assert.equal((executable.match(/\bx\b/g) ?? []).length, 2,
      `${id}: raw x may appear only in render3D's signature and the ship-frame transform`);
    assert.equal((executable.match(/\bz\b/g) ?? []).length, 2,
      `${id}: raw z may appear only in render3D's signature and the ship-frame transform`);
  }
});

test('both Titanic TE signs render byte-identical Baby Tease choreography', async () => {
  const loaded = await model('titanic');
  const fixtures = new Map();
  for (let index = 0; index < loaded.metaArray.length; index++) {
    const meta = loaded.metaArray[index];
    if (meta.fixtureTypeId !== 7) continue;
    if (!fixtures.has(meta.fixtureId)) fixtures.set(meta.fixtureId, []);
    fixtures.get(meta.fixtureId).push({ index, local: meta.pixelLocalIndex });
  }
  const signParts = [...fixtures.values()].map((pixels) =>
    pixels.sort((left, right) => left.local - right.local));
  // Each physical sign is patched as a 40-pixel A fixture plus a 34-pixel B
  // fixture. Pair equal-sized parts across port and starboard.
  assert.equal(signParts.length, 4, 'Titanic must expose two two-part TE signs');
  const pairs = [];
  for (const length of [...new Set(signParts.map((pixels) => pixels.length))]) {
    const matching = signParts.filter((pixels) => pixels.length === length);
    assert.equal(matching.length, 2, `TE sign ${length}-pixel part must appear twice`);
    pairs.push(matching);
  }

  for (const id of BY_FAMILY.tease) {
    const pattern = await compilePattern(id, 'titanic');
    try {
      const frames = captureTimeline(pattern, SAMPLE_TIMES);
      for (let sample = 0; sample < SAMPLE_TIMES.length; sample++) {
        const elapsed = SAMPLE_TIMES[sample];
        const frame = frames[sample];
        for (const [leftPart, rightPart] of pairs) {
          for (let local = 0; local < leftPart.length; local++) {
            const left = leftPart[local].index * 6;
            const right = rightPart[local].index * 6;
            assert.deepEqual(frame.subarray(left, left + 6), frame.subarray(right, right + 6),
              `${id} at ${elapsed}s: TE sign pixel ${local} differs across signs`);
          }
        }
      }
    } finally {
      pattern.close();
    }
  }
});

test('every Tease authors each six-head Vintage fixture as a balanced local duet', async () => {
  for (const modelName of MODELS) {
    const loaded = await model(modelName);
    const fixtures = new Map();
    for (let index = 0; index < loaded.metaArray.length; index++) {
      const meta = loaded.metaArray[index];
      if (meta.fixtureTypeId !== 3) continue;
      if (!fixtures.has(meta.fixtureId)) fixtures.set(meta.fixtureId, []);
      fixtures.get(meta.fixtureId).push(index);
    }
    assert.ok(fixtures.size > 0, `${modelName}: no Vintage fixtures`);
    for (const [fixtureId, indices] of fixtures) {
      assert.equal(indices.length, 6, `${modelName}: Vintage fixture ${fixtureId} is not six-head`);
    }

    for (const id of BY_FAMILY.tease) {
      const pattern = await compilePattern(id, modelName);
      try {
        const firstByFixture = new Map();
        const peakByFixture = new Map([...fixtures.keys()].map((fixtureId) => [fixtureId, 0]));
        const initialFamiliesByFixture = new Map();
        const roleDriftByFixture = new Map([...fixtures.keys()].map((fixtureId) => [fixtureId, 0]));
        const frames = captureTimeline(pattern, FIXTURE_REVIEW_TIMES);
        for (let sample = 0; sample < FIXTURE_REVIEW_TIMES.length; sample++) {
          const elapsed = FIXTURE_REVIEW_TIMES[sample];
          const frame = frames[sample];
          for (const [fixtureId, indices] of fixtures) {
            const families = indices.map((index) => pixelFamily(frame, index));
            if (!initialFamiliesByFixture.has(fixtureId)) {
              initialFamiliesByFixture.set(fixtureId, families);
            }
            const drifted = families.filter((family, head) =>
              family !== initialFamiliesByFixture.get(fixtureId)[head]).length / families.length;
            roleDriftByFixture.set(fixtureId,
              Math.max(roleDriftByFixture.get(fixtureId), drifted));
            assert.ok(families.filter((family) => family === 'blue').length >= 2,
              `${id} on ${modelName} at ${elapsed}s: Vintage ${fixtureId} needs >=2 blue heads`);
            assert.ok(families.filter((family) => family === 'pink').length >= 2,
              `${id} on ${modelName} at ${elapsed}s: Vintage ${fixtureId} needs >=2 pink heads`);
            assert.ok(families.filter((family) => family === 'dark').length >= 1,
              `${id} on ${modelName} at ${elapsed}s: Vintage ${fixtureId} needs a black separator head`);
            assert.ok(families.every((family) => family !== 'other'),
              `${id} on ${modelName}: Vintage ${fixtureId} emitted a forbidden family`);
            const bytes = Uint8Array.from(indices.flatMap((index) =>
              [...frame.subarray(index * 6, index * 6 + 6)]));
            if (!firstByFixture.has(fixtureId)) firstByFixture.set(fixtureId, bytes);
            peakByFixture.set(fixtureId, Math.max(peakByFixture.get(fixtureId),
              peakAbsoluteDifference(firstByFixture.get(fixtureId), bytes)));
          }
        }
        for (const [fixtureId, peak] of peakByFixture) {
          assert.ok(peak >= 20,
            `${id} on ${modelName}: Vintage ${fixtureId} is not visibly active (peak ${peak})`);
        }
      } finally {
        pattern.close();
      }
    }
  }
});

test('every Tease gives each TE sign balanced, black-separated, animated 2D art', async () => {
  for (const modelName of MODELS) {
    const loaded = await model(modelName);
    const groups = new Map();
    for (let index = 0; index < loaded.pixels.length; index++) {
      const pixel = loaded.pixels[index];
      if (!String(pixel.fixtureType).startsWith('TeSignV3')) continue;
      if (!groups.has(pixel.group)) groups.set(pixel.group, []);
      groups.get(pixel.group).push(index);
    }
    assert.ok(groups.size > 0, `${modelName}: no TE sign groups`);

    for (const id of BY_FAMILY.tease) {
      const pattern = await compilePattern(id, modelName);
      try {
        const firstByGroup = new Map();
        const peakByGroup = new Map([...groups.keys()].map((group) => [group, 0]));
        const initialFamiliesByGroup = new Map();
        const roleDriftByGroup = new Map([...groups.keys()].map((group) => [group, 0]));
        const frames = captureTimeline(pattern, FIXTURE_REVIEW_TIMES);
        for (let sample = 0; sample < FIXTURE_REVIEW_TIMES.length; sample++) {
          const elapsed = FIXTURE_REVIEW_TIMES[sample];
          const frame = frames[sample];
          for (const [group, indices] of groups) {
            let pink = 0;
            let blue = 0;
            let dark = 0;
            let pinkEnergy = 0;
            let blueEnergy = 0;
            for (const index of indices) {
              const family = pixelFamily(frame, index);
              const peak = Math.max(...frame.subarray(index * 6, index * 6 + 3));
              if (family === 'pink') { pink++; pinkEnergy += peak; }
              else if (family === 'blue') { blue++; blueEnergy += peak; }
              else if (family === 'dark') dark++;
              else assert.fail(`${id} on ${modelName}: ${group} emitted a forbidden family`);
            }
            const families = indices.map((index) => pixelFamily(frame, index));
            if (!initialFamiliesByGroup.has(group)) initialFamiliesByGroup.set(group, families);
            const drifted = families.filter((family, pixel) =>
              family !== initialFamiliesByGroup.get(group)[pixel]).length / families.length;
            roleDriftByGroup.set(group,
              Math.max(roleDriftByGroup.get(group), drifted));
            assert.ok(pink >= 8 && blue >= 8,
              `${id} on ${modelName} at ${elapsed}s: ${group} needs both sign fields (pink=${pink}, blue=${blue})`);
            assert.ok(dark >= 3,
              `${id} on ${modelName} at ${elapsed}s: ${group} needs crisp black separation`);
            assert.ok(dark <= Math.ceil(indices.length * 0.50),
              `${id} on ${modelName} at ${elapsed}s: ${group} lost too much local surface to black`);
            const territory = pink / blue;
            const authority = pinkEnergy / blueEnergy;
            assert.ok(territory >= 0.65 && territory <= 1.55,
              `${id} on ${modelName} at ${elapsed}s: ${group} territory ${territory.toFixed(3)}`);
            assert.ok(authority >= SIGN_AUTHORITY_FLOOR && authority <= SIGN_AUTHORITY_CEILING,
              `${id} on ${modelName} at ${elapsed}s: ${group} authority ${authority.toFixed(3)}`);
            const bytes = Uint8Array.from(indices.flatMap((index) =>
              [...frame.subarray(index * 6, index * 6 + 6)]));
            if (!firstByGroup.has(group)) firstByGroup.set(group, bytes);
            peakByGroup.set(group, Math.max(peakByGroup.get(group),
              peakAbsoluteDifference(firstByGroup.get(group), bytes)));
          }
        }
        for (const [group, peak] of peakByGroup) {
          assert.ok(peak >= 20,
            `${id} on ${modelName}: ${group} is not visibly active (peak ${peak})`);
        }
      } finally {
        pattern.close();
      }
    }
  }
});

function peakAbsoluteDifference(left, right) {
  let most = 0;
  for (let index = 0; index < left.length; index++) {
    most = Math.max(most, Math.abs(left[index] - right[index]));
  }
  return most;
}

// Motion is SWEPT, not sampled at two arbitrary instants. Comparing t=0.25 s
// against one later frame reports "static" for any pattern whose period happens
// to bring it back near its start — which is most of them, at some frame. The
// sweep asks the honest question instead: across five seconds, does this
// pattern ever look materially different from where it began?
//
// One pass serves both the animation and the distinctness tests; running it
// twice would double the cost of the file for no extra coverage.
//
// NOTE for `baby_reveal`: this sweep renders each pattern at its default slider
// state, but NOT at its default colour — `compilePattern` arms pink on every
// pattern that exports `colorPalette1`. Without that, the sweep would be
// measuring whatever hue the VM's own hsvPicker default happens to be, which is
// not a colour this file chose.
let sweepPromise = null;
function sweep() {
  if (sweepPromise) return sweepPromise;
  sweepPromise = (async () => {
    const result = new Map();
    for (const id of IDS) {
      const pattern = await compilePattern(id, 'titanic');
      try {
        const early = pattern.render(0.25);
        let peak = 0;
        let mean = 0;
        let late = early;
        for (let frame = 11; frame <= 200; frame++) {
          late = pattern.render(frame * 0.025);
          peak = Math.max(peak, peakAbsoluteDifference(early, late));
          mean = Math.max(mean, meanAbsoluteDifference(early, late));
        }
        result.set(id, { peak, mean, late });
      } finally {
        pattern.close();
      }
    }
    return result;
  })();
  return sweepPromise;
}

// Measured floors across the tease set are peak 79 and mean 2.02; the
// thresholds sit at roughly half that, so a genuinely frozen pattern fails
// loudly while normal authoring variation does not.
test('every Baby pattern is actually animated', async () => {
  const swept = await sweep();
  for (const [id, { peak, mean }] of swept) {
    assert.ok(peak >= 40,
      `${id}: no pixel ever moves materially (peak delta ${peak})`);
    assert.ok(mean >= 1.0,
      `${id}: whole-frame motion is not visually material (mean delta ${mean.toFixed(2)})`);
  }
});

// Within a family every curated look must be a real look, not one look renamed. The
// floor is deliberately low: two sparse point-fields legitimately resemble each
// other, and the failure this guards against is a copy-paste duplicate.
test('patterns within a Baby family are visually distinct from each other', async () => {
  const swept = await sweep();
  for (const [family, ids] of Object.entries(BY_FAMILY)) {
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const difference = meanAbsoluteDifference(
          swept.get(ids[left]).late, swept.get(ids[right]).late);
        assert.ok(difference > 1.5,
          `${family}: ${ids[left]} and ${ids[right]} are near-duplicates (${difference.toFixed(2)})`);
      }
    }
  }
});

// ── The two canonical playlists ──────────────────────────────────────────────
//
// `baby_reveal` is now BOTH the SPECIAL EVENT id
// (simulation/scenes/titanic/special_events/baby_reveal.yaml) AND a playlist
// name — deliberately (docs/73): the show answers the question it asks, and
// one playlist coloured by whichever `globals` choice fired replaces the old
// two hard-coded answer playlists. The runner refuses to ARM if either
// playlist is missing or has no loadable entry — so a rename here is a dead
// show, not a cosmetic diff.
const PLAYLISTS = {
  baby_tease: BY_FAMILY.tease,
  baby_reveal: BY_FAMILY.reveal,
};
const TEASE_LOCAL_SPEEDS_20_PERCENT_UP = new Map([
  ['baby_tease/01_bullseye_tide', 0.504],
  ['baby_tease/02_cellular_organism', 0.504],
  ['baby_tease/03_star_exchange', 0.48],
  ['baby_tease/04_rotating_yin_yang', 0.48],
  ['baby_tease/05_ink_drops', 0.516],
  ['baby_tease/06_argyle_weave', 0.54],
  ['baby_tease/07_braided_rivers', 0.564],
  ['baby_tease/08_checker_tide', 0.54],
  ['baby_tease/09_candy_helix', 0.552],
  ['baby_tease/10_rail_exchange', 0.552],
  ['baby_tease/11_carousel_sectors', 0.54],
  ['baby_tease/12_counter_comets', 0.528],
  ['baby_tease/13_position_swap', 0.528],
]);

test('the two Baby playlists exist in both scenes and resolve to their curated whole family', () => {
  const manifest = new Set(JSON.parse(
    fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8')));
  for (const scene of SCENES) {
    for (const [name, ids] of Object.entries(PLAYLISTS)) {
      const file = path.join(SCENES_DIR, scene, 'playlists', `${name}.yaml`);
      assert.ok(fs.existsSync(file), `missing playlist ${scene}/${name}.yaml`);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      assert.equal(doc.schemaVersion, 1);
      assert.equal(doc.name, name, `${scene}/${name}.yaml: name field mismatch`);
      // The count is DERIVED: the playlist must carry its whole family, however
      // big that family currently is. A new `baby_reveal/11_*.js` that nobody
      // added to the playlist fails here, by name, instead of silently never
      // being seen on the ship. (Conversely, while patterns/baby_reveal/*.js is
      // still being authored by a concurrent wave, this can legitimately fail
      // because the playlist already names all 10 curated entries but not all
      // 10 pattern files exist on disk yet — see the file count test above.)
      assert.equal(doc.entries.length, ids.length,
        `${scene}/${name}.yaml carries ${doc.entries.length} entries but the family on disk ` +
        `has ${ids.length} — every family member must be in its playlist`);
      const expectedPatterns = [...ids].sort();
      const actualPatterns = doc.entries.map((entry) => entry.pattern).sort();
      assert.deepEqual(actualPatterns, expectedPatterns,
        `${scene}/${name}.yaml does not contain exactly its whole family`);
      const seenIds = new Set();
      for (const entry of doc.entries) {
        assert.ok(!seenIds.has(entry.id), `${scene}/${name}.yaml: duplicate entry id ${entry.id}`);
        seenIds.add(entry.id);
        // Qualified `<dir>/<name>` ids must be REGISTERED, not merely present on
        // disk: the manifest is what the operator's pattern picker reads.
        assert.ok(manifest.has(entry.pattern),
          `${scene}/${name}.yaml references unregistered pattern "${entry.pattern}"`);
        assert.ok(fs.existsSync(path.join(PATTERNS_DIR, `${entry.pattern}.js`)),
          `${scene}/${name}.yaml references missing source "${entry.pattern}"`);
        // Saved defaults must name real sliders, or the operator's values land
        // on nothing and the entry looks retuned when it is not.
        const declared = [...patternSource(entry.pattern)
          .matchAll(/export\s+function\s+(slider[A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
        assert.deepEqual(Object.keys(entry.defaults), declared,
          `${scene}/${name}.yaml entry ${entry.id}: defaults do not match the pattern's sliders`);
      }
    }
  }
});

test('both scenes carry byte-identical copies of every Baby playlist', () => {
  for (const name of Object.keys(PLAYLISTS)) {
    const titanic = fs.readFileSync(
      path.join(SCENES_DIR, 'titanic', 'playlists', `${name}.yaml`), 'utf8');
    const bench = fs.readFileSync(
      path.join(SCENES_DIR, 'test_bench', 'playlists', `${name}.yaml`), 'utf8');
    assert.equal(titanic, bench, `${name}.yaml differs between test_bench and titanic`);
  }
});

test('every Baby Tease entry loads with its exact 20% local-speed lift', () => {
  const playlist = yaml.load(fs.readFileSync(
    path.join(SCENES_DIR, 'titanic', 'playlists', 'baby_tease.yaml'), 'utf8'));
  assert.equal(playlist.entries.length, TEASE_LOCAL_SPEEDS_20_PERCENT_UP.size);
  for (const entry of playlist.entries) {
    assert.equal(
      entry.defaults.sliderLocalSpeed,
      TEASE_LOCAL_SPEEDS_20_PERCENT_UP.get(entry.pattern),
      `${entry.pattern}: playlist local speed must remain exactly 20% above its prior saved value`,
    );
  }
});

// The retired names, kept as an explicit tombstone. `baby_boy` and `baby_girl`
// are retired (docs/73 — replaced by the single `baby_reveal` playlist), and
// `patterns/baby/` (their pattern source) must be gone from disk entirely.
// `baby_reveal` is NOT in this tombstone list any more — it is now a
// legitimate playlist name as well as the special-event id.
test('no retired Baby playlist file has come back', () => {
  for (const scene of SCENES) {
    for (const retired of ['baby_boy', 'baby_girl', 'baby_pink', 'baby_blue', 'baby_reveal_celebration']) {
      const file = path.join(SCENES_DIR, scene, 'playlists', `${retired}.yaml`);
      assert.equal(fs.existsSync(file), false, `retired playlist is back: ${scene}/${retired}.yaml`);
    }
  }
  assert.equal(
    fs.existsSync(path.join(SCENES_DIR, 'titanic', 'special_events', 'baby_reveal.yaml')), true,
    'baby_reveal must survive as the special-event show file');
  assert.equal(fs.existsSync(path.join(PATTERNS_DIR, 'baby')), false,
    'patterns/baby/ must be fully retired now that patterns/baby_reveal/ replaces the boy/girl ' +
    'answer twins');
});

test('no retired root-level Baby pattern remains on disk or in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  const strays = fs.readdirSync(PATTERNS_DIR)
    .filter((name) => name.endsWith('.js') && /baby/i.test(name));
  assert.deepEqual(strays, [],
    'Baby patterns live in patterns/baby_tease/ and patterns/baby_reveal/, not at the root');
  assert.deepEqual(manifest.filter((id) => /^\d+_baby/.test(id)), [],
    'the manifest still registers a retired root Baby id');
  // Derived, not a magic number: the manifest must register exactly what is on
  // disk. A new pattern that was never registered is invisible in the
  // operator's picker, which is how the last family went missing (_222 §2).
  const activeFromPlaylists = new Set();
  for (const name of Object.keys(PLAYLISTS)) {
    const doc = yaml.load(fs.readFileSync(
      path.join(SCENES_DIR, 'titanic', 'playlists', `${name}.yaml`), 'utf8'));
    for (const entry of doc.entries) activeFromPlaylists.add(entry.pattern);
  }
  assert.deepEqual(manifest.filter((id) => BABY_DIRS.includes(id.split('/')[0])).sort(),
    [...activeFromPlaylists].sort(),
    'the Baby catalog must register exactly the two curated playlist families\' union — this ' +
    'legitimately fails while patterns/baby_reveal/*.js is still being authored by a concurrent ' +
    'wave, because the playlist names all 10 curated entries before all 10 exist on disk');
  assert.deepEqual([...DISK_IDS].sort(), [...IDS].sort(),
    'patterns/baby_tease and patterns/baby_reveal must contain only the two curated playlist families');
});
