// baby_color_contract.test.js — the colour and structure contract for the
// Baby show's 45 patterns in patterns/baby/.
//
// The Baby show makes promises no ordinary pattern bar checks, and each one is
// silently breakable by a reasonable-looking edit:
//
//   1. THE TEASE MUST NOT ANSWER. `baby_tease` is the outcome-blind stage: every
//      frame carries BOTH families at once. A drift that lets one family win —
//      or that admits a third hue — leaks the answer before the operator's
//      button does, and the whole ceremony is the reveal being a surprise.
//   2. THE ANSWERS MUST NOT WAVER. `baby_girl` is pink and ONLY pink;
//      `baby_boy` is blue and ONLY blue. A single stray pixel of the other
//      family on a photo hold is the wrong answer on the ship.
//   3. THE COLOUR IS HARD-CODED, NOT PALETTED. The engine's palette autopilot
//      writes `colorPalette1`/`colorPalette2` into any pattern that declares
//      them. Declaring one here would hand the reveal's colour to the autopilot,
//      so the guarantee is exactly "these patterns declare neither".
//   4. RGB ONLY — W = A = U = 0. The Baby families are RGB mixes; lighting the
//      dedicated white/amber/UV emitters would desaturate pink and blue toward
//      white on hardware. This is invisible in the sim (sacn_mapper host-synths
//      W for DMX fixtures) and only shows up on the rig.
//   5. THE PAIRS ARE ONE CHOREOGRAPHY, TWO COLOURS. `16..30_boy_*` and
//      `31..45_girl_*` are the same 15 looks. If the two halves drift apart,
//      the reveal shows a different SHOW depending on the answer, which is a
//      fairness bug the crowd would read as favouritism.
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
const BABY_DIR = path.join(PATTERNS_DIR, 'baby');
const SCENES_DIR = path.resolve(ENGINE_DIR, '..', 'simulation', 'scenes');
const SCENES = ['titanic', 'test_bench'];
const MODELS = ['titanic', 'test_bench'];

// ── THE FILENAME IS THE CONTRACT ────────────────────────────────────────────
//
// Every Baby pattern is named `<NN>_<family>_<concept>.js`, and THAT is what
// files it — not a hardcoded range table. The set is meant to grow (the
// operator wants the tease well past 20 looks), and it grows in blocks: the
// first three families were 01-15 / 16-30 / 31-45, the next expansion added
// more tease and another paired block after it. A number-range table has to be
// edited for every one of those; a name does not.
//
// So the rules below are all DERIVED:
//   · which family a file belongs to → its name
//   · how big a family is            → how many files carry that name
//   · how many entries a playlist has→ that family's size
//   · which girl pattern twins which boy → the CONCEPT they share, not `+15`
//
// Dropping `baby/<NN>_tease_<concept>.js` in here, registering it in the
// manifest and adding it to both `baby_tease.yaml` copies is the WHOLE job —
// no edit to this file. What is NOT negotiable is the shape: the boy and girl
// halves stay equal and concept-for-concept paired, the tease stays
// outcome-blind, and no family may silently shrink below its floor.
//
// Full recipe: `marsin_engine/patterns/baby/README.md`.

const FAMILIES = ['tease', 'boy', 'girl'];
const BABY_NAME_RE = new RegExp(`^(\\d\\d+)_(${FAMILIES.join('|')})_([a-z0-9_]+)$`);

/** Floors, not targets — the set may grow freely, never silently shrink. */
const MIN_TEASE = 15;
const MIN_PAIRED = 15;

function babyIds() {
  return fs.readdirSync(BABY_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
}

/** `46_tease_checkerboard_morph` → { number: 46, family: 'tease', concept: '…' } */
function parseBabyId(id) {
  const m = BABY_NAME_RE.exec(id);
  if (!m) {
    throw new Error(
      `baby/${id}: a Baby pattern must be named <NN>_<${FAMILIES.join('|')}>_<concept>.js — ` +
      'the family in the name is what files it (see patterns/baby/README.md)');
  }
  return { number: Number.parseInt(m[1], 10), family: m[2], concept: m[3] };
}

function familyOf(id) {
  return parseBabyId(id).family;
}

function conceptOf(id) {
  return parseBabyId(id).concept;
}

const IDS = babyIds();
const BY_FAMILY = { tease: [], boy: [], girl: [] };
for (const id of IDS) BY_FAMILY[familyOf(id)].push(id);

function patternSource(id) {
  return fs.readFileSync(path.join(BABY_DIR, `${id}.js`), 'utf8');
}

// One model load per model, shared by every pattern in the sweep. Loading
// titanic per pattern would multiply the cost of this file by 45.
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
  assert.equal(result.ok, true, `baby/${id} on ${modelName}: ${result.error}`);
  const frame = new Uint8Array(loaded.pixels.length * 6);
  return {
    exports: host.getExports(result.handle),
    set(control, value) {
      const found = host.getExports(result.handle).find((entry) => entry.name === control);
      assert.ok(found, `baby/${id}: missing ${control}`);
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
// family rather than "warm-ish" and "cool-ish".
function classifyFrame(label, frame) {
  let pink = 0;
  let blue = 0;
  let dark = 0;
  for (let pixel = 0; pixel < frame.length / 6; pixel++) {
    const offset = pixel * 6;
    const [r, g, b, w, a, u] = frame.subarray(offset, offset + 6);
    assert.equal(w, 0, `${label} pixel ${pixel}: W lane must be zero`);
    assert.equal(a, 0, `${label} pixel ${pixel}: A lane must be zero`);
    assert.equal(u, 0, `${label} pixel ${pixel}: U lane must be zero`);
    if (Math.max(r, g, b) < 6) {
      dark++;
      continue;
    }
    const isPink = r > b * 1.55 && b > g * 2.5;
    const isBlue = b > g * 1.55 && g > r * 3.0;
    assert.ok(isPink || isBlue, `${label} pixel ${pixel}: forbidden RGB family ${r},${g},${b}`);
    if (isPink) pink++;
    if (isBlue) blue++;
  }
  return { pink, blue, dark };
}

function meanAbsoluteDifference(left, right) {
  assert.equal(left.length, right.length);
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

const SAMPLE_TIMES = [0, 0.5, 1.0, 2.5, 5.0];

// The SHAPE of the set, not its size. Growing the tease is a one-file job; the
// three things this pins are the ones a new file could quietly break.
test('the Baby set keeps its shape: a paired boy/girl answer and a growable tease', () => {
  assert.ok(BY_FAMILY.tease.length >= MIN_TEASE,
    `the tease has shrunk to ${BY_FAMILY.tease.length} (floor ${MIN_TEASE})`);
  assert.ok(BY_FAMILY.boy.length >= MIN_PAIRED,
    `the boy family has shrunk to ${BY_FAMILY.boy.length} (floor ${MIN_PAIRED})`);
  // The answers are TWINS. If one half grows and the other does not, the reveal
  // shows a different show depending on the answer.
  assert.equal(BY_FAMILY.boy.length, BY_FAMILY.girl.length,
    'the boy and girl families must stay the same size — they are one choreography');
  assert.equal(IDS.length, BY_FAMILY.tease.length + BY_FAMILY.boy.length + BY_FAMILY.girl.length,
    'every file in patterns/baby must be filed under exactly one family');

  // Every file parses as a Baby name — this is what makes the whole file
  // derivable rather than table-driven.
  for (const id of IDS) parseBabyId(id);

  // Every boy CONCEPT has a girl of the same concept, and vice versa. Matching
  // on the concept (not on `+15`) is what lets the set grow in blocks: the
  // pairing survives any numbering the authors choose.
  const concepts = (family) => BY_FAMILY[family].map(conceptOf).sort();
  assert.deepEqual(concepts('boy'), concepts('girl'),
    'the boy and girl families must be the SAME concepts — they are one choreography');
  for (const family of FAMILIES) {
    const seen = concepts(family);
    assert.equal(new Set(seen).size, seen.length,
      `${family} has two patterns with the same concept name: ${seen.join(', ')}`);
  }

  // No duplicate numbers — two files claiming 46 is an ordering coin-flip.
  const numbers = IDS.map((id) => Number.parseInt(id, 10));
  assert.equal(new Set(numbers).size, numbers.length,
    `two Baby patterns share a number: ${numbers.join(', ')}`);
});

// The single expensive sweep. Every per-pattern, per-model guarantee is checked
// inside ONE compile so the file stays affordable: 45 patterns x 2 models.
test('every Baby pattern compiles on both rigs, refuses the palette, and holds its family', async () => {
  for (const modelName of MODELS) {
    for (const id of IDS) {
      const family = familyOf(id);
      const source = patternSource(id);
      assert.doesNotMatch(source, /export\s+function\s+colorPalette[12]\s*\(/,
        `baby/${id}: global palette export is forbidden`);
      const pattern = await compilePattern(id, modelName);
      try {
        const names = pattern.exports.map((entry) => entry.name);
        assert.ok(!names.includes('colorPalette1'), `baby/${id}: colorPalette1 leaked`);
        assert.ok(!names.includes('colorPalette2'), `baby/${id}: colorPalette2 leaked`);
        for (const elapsed of SAMPLE_TIMES) {
          const label = `baby/${id} on ${modelName} at ${elapsed}s`;
          const census = classifyFrame(label, pattern.render(elapsed));
          if (family === 'tease') {
            // Outcome-blind: both families visible in the SAME frame.
            assert.ok(census.pink >= 40, `${label} needs visible pink: ${JSON.stringify(census)}`);
            assert.ok(census.blue >= 40, `${label} needs visible blue: ${JSON.stringify(census)}`);
          } else {
            const wanted = family === 'boy' ? 'blue' : 'pink';
            const forbidden = family === 'boy' ? 'pink' : 'blue';
            assert.ok(census[wanted] >= 100,
              `${label} needs visible ${wanted}: ${JSON.stringify(census)}`);
            assert.equal(census[forbidden], 0, `${label} leaked ${forbidden}`);
          }
        }
      } finally {
        pattern.close();
      }
    }
  }
});

// Source-level, so it is exact and free. The pair is allowed to differ ONLY in
// the six COLOR_* constants and the one prose word that names the colour; if a
// choreography edit lands on one half only, this is what catches it.
test('each boy pattern and its girl twin are one choreography with two colour constants', () => {
  const stripColour = (source) => source
    .split(/\r?\n/)
    .filter((line) => !/^var COLOR_[A-Z_]+ = -?[0-9.]+;\s*$/.test(line))
    .join('\n')
    .replace(/Baby-(blue|pink)/g, 'Baby-<colour>')
    .replace(/\s+$/, '');

  for (const boy of BY_FAMILY.boy) {
    // Paired by CONCEPT, not by `+15`: the families grow in blocks and the
    // offset between a boy and its twin is not a constant across them.
    const concept = conceptOf(boy);
    const girl = BY_FAMILY.girl.find((id) => conceptOf(id) === concept);
    assert.ok(girl, `baby/${boy} has no girl twin for concept '${concept}'`);
    assert.equal(stripColour(patternSource(boy)), stripColour(patternSource(girl)),
      `baby/${boy} and baby/${girl} differ by more than their colour constants`);
    // And the constants themselves must actually differ, or one half is the
    // wrong colour.
    const colours = (id) => patternSource(id).match(/^var COLOR_[A-Z_]+ = -?[0-9.]+;$/gm);
    assert.equal(colours(boy).length, 6, `baby/${boy}: expected 6 COLOR_* constants`);
    assert.notDeepEqual(colours(boy), colours(girl),
      `baby/${boy} and baby/${girl} share the same colour constants`);
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

// Measured floors across the set are peak 79 and mean 2.02; the thresholds sit
// at roughly half that, so a genuinely frozen pattern fails loudly while normal
// authoring variation does not.
test('every Baby pattern is actually animated', async () => {
  const swept = await sweep();
  for (const [id, { peak, mean }] of swept) {
    assert.ok(peak >= 40,
      `baby/${id}: no pixel ever moves materially (peak delta ${peak})`);
    assert.ok(mean >= 1.0,
      `baby/${id}: whole-frame motion is not visually material (mean delta ${mean.toFixed(2)})`);
  }
});

// Within a family the 15 looks must be 15 LOOKS, not one look renamed. The
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
          `${family}: baby/${ids[left]} and baby/${ids[right]} are near-duplicates (${difference.toFixed(2)})`);
      }
    }
  }
});

test('Crossing is a truthful spatial-position control on every crossing variant', async () => {
  for (const [id, control] of [
    ['02_tease_crossing_question', 'sliderCrossing'],
    ['17_boy_crossing_glow', 'sliderCrossingOffset'],
    ['32_girl_crossing_glow', 'sliderCrossingOffset'],
  ]) {
    const pattern = await compilePattern(id, 'titanic');
    try {
      for (let frame = 0; frame < 80; frame++) pattern.render(frame * 0.025);
      pattern.set(control, 0);
      const low = pattern.render(2.0);
      pattern.set(control, 1);
      const high = pattern.render(2.025);
      const difference = meanAbsoluteDifference(low, high);
      assert.ok(difference > 3.5, `baby/${id}: ${control} position is too weak: ${difference}`);
    } finally {
      pattern.close();
    }
  }
});

// ── The three canonical playlists ────────────────────────────────────────────
//
// `baby_reveal` is the SPECIAL EVENT (simulation/scenes/titanic/special_events/
// baby_reveal.yaml), never a playlist. The playlists are exactly these three,
// and the show refuses to ARM if one of them is missing — so a rename here is a
// dead show, not a cosmetic diff.
const PLAYLISTS = {
  baby_tease: BY_FAMILY.tease,
  baby_boy: BY_FAMILY.boy,
  baby_girl: BY_FAMILY.girl,
};

test('the three Baby playlists exist in both scenes and resolve to their curated whole family', () => {
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
      // big that family currently is. A new `baby/46_tease_*.js` that nobody
      // added to the playlist fails here, by name, instead of silently never
      // being seen on the ship.
      assert.equal(doc.entries.length, ids.length,
        `${scene}/${name}.yaml carries ${doc.entries.length} entries but the family on disk ` +
        `has ${ids.length} — every family member must be in its playlist`);
      const expectedPatterns = ids.map((id) => `baby/${id}`).sort();
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
        const declared = [...patternSource(entry.pattern.replace(/^baby\//, ''))
          .matchAll(/export\s+function\s+(slider[A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
        assert.deepEqual(Object.keys(entry.defaults), declared,
          `${scene}/${name}.yaml entry ${entry.id}: defaults do not match the pattern's sliders`);
      }
    }
  }
});

test('Boy and Girl playlists tell the same curated story in the same concept order', () => {
  for (const scene of SCENES) {
    const read = (name) => yaml.load(fs.readFileSync(
      path.join(SCENES_DIR, scene, 'playlists', `${name}.yaml`), 'utf8'));
    const boyConcepts = read('baby_boy').entries
      .map((entry) => conceptOf(entry.pattern.replace(/^baby\//, '')));
    const girlConcepts = read('baby_girl').entries
      .map((entry) => conceptOf(entry.pattern.replace(/^baby\//, '')));
    assert.deepEqual(girlConcepts, boyConcepts,
      `${scene}: Boy and Girl playlist arcs must use the same concept order`);
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

// The retired names, kept as an explicit tombstone. `baby_reveal` survives ONLY
// as the special-event file; if it ever comes back as a playlist the show has
// two meanings for one word and the operator's ARM picks the wrong one.
test('no retired Baby playlist file has come back', () => {
  for (const scene of SCENES) {
    for (const retired of ['baby_reveal', 'baby_pink', 'baby_blue', 'baby_reveal_celebration']) {
      const file = path.join(SCENES_DIR, scene, 'playlists', `${retired}.yaml`);
      assert.equal(fs.existsSync(file), false, `retired playlist is back: ${scene}/${retired}.yaml`);
    }
  }
  assert.equal(
    fs.existsSync(path.join(SCENES_DIR, 'titanic', 'special_events', 'baby_reveal.yaml')), true,
    'baby_reveal must survive as the special-event show file');
});

test('no retired root-level Baby pattern remains on disk or in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  const strays = fs.readdirSync(PATTERNS_DIR)
    .filter((name) => name.endsWith('.js') && /baby/i.test(name));
  assert.deepEqual(strays, [], 'Baby patterns live in patterns/baby/, not at the root');
  assert.deepEqual(manifest.filter((id) => /^\d+_baby/.test(id)), [],
    'the manifest still registers a retired root Baby id');
  // Derived, not a magic number: the manifest must register exactly what is on
  // disk. A new pattern that was never registered is invisible in the
  // operator's picker, which is how the last family went missing (_222 §2).
  assert.deepEqual(manifest.filter((id) => id.startsWith('baby/')), IDS.map((id) => `baby/${id}`),
    `the manifest does not register exactly the ${IDS.length} qualified Baby ids on disk`);
});
